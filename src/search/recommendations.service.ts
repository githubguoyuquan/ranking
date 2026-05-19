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
    private readonly embedding: EmbeddingService,
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
      await this.prisma.topicEmbedding.createMany({
        data: part.map((t, j) => ({
          topicId: t.id,
          model: DEFAULT_EMBEDDING_MODEL,
          dims: vecs[j].length,
          vector: vecs[j],
        })),
        skipDuplicates: true,
      });
    }
  }

  private async ensureAnchorTopicVector(topicId: bigint): Promise<number[]> {
    const row = await this.prisma.topicEmbedding.findUnique({
      where: { topicId },
    });
    if (row) {
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
        'OPENAI_API_KEY required for similar-topics (embeddings)',
      );
    }
    const exists = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('topic not found');

    await this.hydrateMissingTopicEmbeddings();
    const anchor = await this.ensureAnchorTopicVector(topicId);

    const others = await this.prisma.topicEmbedding.findMany({
      where: { NOT: { topicId } },
      include: { topic: { select: { id: true, title: true, slug: true } } },
    });

    const cap = Math.min(Math.max(limit, 1), 50);
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
    if (!this.elastic.isEnabled()) {
      throw new ServiceUnavailableException(
        'Elasticsearch required for similar-entities (kNN)',
      );
    }
    if (!this.embedding.isConfigured()) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY required for similar-entities (embeddings)',
      );
    }
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) throw new NotFoundException('entity not found');

    let vec = await this.elastic.fetchEntityEmbeddingFromIndex(entityId);
    if (!vec) {
      vec = await this.embedding.embedForEntity(entity.canonicalName, entity.aliases, {
        source: AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND,
        operation: 'similar_entity_anchor',
      });
      await this.elastic.upsertEntityFromRow(entity);
      vec = await this.elastic.fetchEntityEmbeddingFromIndex(entityId);
    }
    if (!vec) {
      throw new ServiceUnavailableException('could not read entity vector from index');
    }

    const cap = Math.min(Math.max(limit, 1), 50);
    return this.elastic.knnSimilarEntities(vec, entityId, cap);
  }
}
