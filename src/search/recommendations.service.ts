import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND } from '../ai-audit/ai-audit.constants';
import { cosineSimilarity } from '../lib/vector-cosine';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMS } from './embedding.constants';
import { ElasticService, type EntitySearchHit } from './elastic.service';
import { EmbeddingService } from './embedding.service';
import { QdrantSearchService } from './qdrant-search.service';
import { resolveSearchPrimary } from './search-primary';
import { TopicVectorIndexService } from './topic-vector-index.service';
import { resolveTopicVectorPrimary } from './topic-vector-primary';
import { CollaborativeFilteringService } from './collaborative-filtering.service';

export type SimilarTopicHit = {
  topicId: string;
  title: string;
  slug: string;
  score: number;
};

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
    private readonly embedding: EmbeddingService,
    private readonly topicVectors: TopicVectorIndexService,
    private readonly collaborative: CollaborativeFilteringService,
  ) {}

  private vectorFromJson(json: unknown): number[] | null {
    if (!Array.isArray(json)) return null;
    const nums = json.filter((x): x is number => typeof x === 'number');
    if (nums.length !== EMBEDDING_DIMS) return null;
    return nums;
  }

  /** 批量补全缺失的 TopicEmbedding（首次相似推荐可能较慢） */
  private async hydrateMissingTopicEmbeddings(): Promise<void> {
    const rows = await this.prisma.topic.findMany({
      select: { id: true, title: true, slug: true },
    });
    const embedded = await this.prisma.topicEmbedding.findMany({
      where: { model: DEFAULT_EMBEDDING_MODEL },
      select: { topicId: true },
    });
    const have = new Set(embedded.map((e) => e.topicId.toString()));
    const missing = rows.filter((t) => !have.has(t.id.toString()));
    if (missing.length === 0) return;

    const chunk = 64;
    for (let i = 0; i < missing.length; i += chunk) {
      const part = missing.slice(i, i + chunk);
      const texts = part.map((t) => `${t.title}\n${t.slug}`);
      const vecs = await this.embedding.embedMany(texts, {
        source: AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND,
        operation: 'topic_embedding_hydrate_batch',
      });
      await this.prisma.$transaction(part.map((topic, index) =>
        this.prisma.topicEmbedding.upsert({
          where: { topicId: topic.id },
          create: {
            topicId: topic.id,
            model: DEFAULT_EMBEDDING_MODEL,
            dims: vecs[index].length,
            vector: vecs[index],
          },
          update: {
            model: DEFAULT_EMBEDDING_MODEL,
            dims: vecs[index].length,
            vector: vecs[index],
          },
        }),
      ));
    }
  }

  private async ensureAnchorTopicVector(topicId: bigint): Promise<number[]> {
    const row = await this.prisma.topicEmbedding.findUnique({
      where: { topicId },
    });
    if (row?.model === DEFAULT_EMBEDDING_MODEL) {
      const v = this.vectorFromJson(row.vector);
      if (v) return v;
    }
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, title: true, slug: true },
    });
    if (!topic) throw new NotFoundException('topic not found');
    const v = await this.embedding.embedText(`${topic.title}\n${topic.slug}`, {
      source: AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND,
      operation: 'topic_anchor',
    });
    await this.prisma.topicEmbedding.upsert({
      where: { topicId },
      create: {
        topicId,
        model: DEFAULT_EMBEDDING_MODEL,
        dims: v.length,
        vector: v,
      },
      update: {
        model: DEFAULT_EMBEDDING_MODEL,
        dims: v.length,
        vector: v,
      },
    });
    const simhash = createHash('sha256')
      .update(`${topic.title}\n${topic.slug}`)
      .digest('hex')
      .slice(0, 64);
    await this.prisma.topicFingerprint.upsert({
      where: { topicId },
      create: {
        topicId,
        simhash,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
      },
      update: { simhash, embeddingModel: DEFAULT_EMBEDDING_MODEL },
    });
    return v;
  }

  async similarTopics(topicId: bigint, limit: number): Promise<SimilarTopicHit[]> {
    if (!this.embedding.isConfigured()) {
      throw new ServiceUnavailableException(
        'local embedding service is unavailable for similar-topics',
      );
    }
    const exists = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('topic not found');

    await this.hydrateMissingTopicEmbeddings();
    const anchor = await this.ensureAnchorTopicVector(topicId);

    const cap = Math.min(Math.max(limit, 1), 50);
    const primary = resolveTopicVectorPrimary(this.topicVectors);

    if (primary === 'qdrant') {
      await this.topicVectors.ensureCollection();
      const knn = await this.topicVectors.knnSimilarTopics(anchor, topicId, cap);
      const missingIds = knn.filter((h) => !h.title || !h.slug).map((h) => BigInt(h.topicId));
      const meta =
        missingIds.length > 0
          ? await this.prisma.topic.findMany({
              where: { id: { in: missingIds } },
              select: { id: true, title: true, slug: true },
            })
          : [];
      const metaById = new Map(meta.map((t) => [t.id.toString(), t]));

      return knn.map((h) => {
        const m = metaById.get(h.topicId);
        return {
          topicId: h.topicId,
          title: h.title ?? m?.title ?? '',
          slug: h.slug ?? m?.slug ?? '',
          score: h.score,
        };
      });
    }

    const others = await this.prisma.topicEmbedding.findMany({
      where: { NOT: { topicId }, model: DEFAULT_EMBEDDING_MODEL },
      include: { topic: { select: { id: true, title: true, slug: true } } },
    });

    return others
      .map((row) => {
        const v = this.vectorFromJson(row.vector);
        if (!v) return null;
        return {
          topicId: row.topicId.toString(),
          title: row.topic.title,
          slug: row.topic.slug,
          score: cosineSimilarity(anchor, v),
        };
      })
      .filter((x): x is SimilarTopicHit => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, cap);
  }

  async similarEntities(entityId: bigint, limit: number): Promise<EntitySearchHit[]> {
    const primary = resolveSearchPrimary(this.qdrant, this.elastic);
    if (primary === 'postgresql') {
      throw new ServiceUnavailableException(
        'similar-entities requires Qdrant or Elasticsearch',
      );
    }
    if (!this.embedding.isConfigured()) {
      throw new ServiceUnavailableException(
        'local embedding service is unavailable for similar-entities',
      );
    }
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) throw new NotFoundException('entity not found');

    const vec = await this.embedding.embedForEntity(entity.canonicalName, entity.aliases, {
      source: AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND,
      operation: 'similar_entity_anchor',
    });

    if (primary === 'qdrant') {
      if (!this.qdrant.isEnabled()) {
        throw new ServiceUnavailableException('QDRANT_URL required for similar-entities');
      }
      await this.qdrant.upsertEntityFromRow(entity);
      const cap = Math.min(Math.max(limit, 1), 50);
      return this.qdrant.knnSimilarEntities(vec, entityId, cap);
    }

    if (!this.elastic.isEnabled()) {
      throw new ServiceUnavailableException(
        'Elasticsearch required for similar-entities (kNN)',
      );
    }
    await this.elastic.upsertEntityFromRow(entity);
    const cap = Math.min(Math.max(limit, 1), 50);
    return this.elastic.knnSimilarEntities(vec, entityId, cap);
  }

  collaborativeEntities(params: {
    entityId: bigint;
    topicSlug?: string;
    topN?: number;
    limit?: number;
  }) {
    return this.collaborative.recommendEntities(params);
  }

  syncTopicVectorsToQdrant(opts?: { batchSize?: number; maxTopics?: number }) {
    return this.topicVectors.syncFromPostgres(opts);
  }
}
