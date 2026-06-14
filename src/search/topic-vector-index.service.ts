import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMS } from './embedding.constants';
import { qdrantPointIdFromBigint } from './qdrant-point-id';

export const QDRANT_COLLECTION_TOPICS =
  process.env.QDRANT_COLLECTION_TOPICS?.trim() || 'ranking_topics';

@Injectable()
export class TopicVectorIndexService {
  private readonly logger = new Logger(TopicVectorIndexService.name);
  private readonly url = process.env.QDRANT_URL?.trim() ?? '';

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return this.url.length > 0;
  }

  private base(): string {
    return this.url.replace(/\/$/, '');
  }

  async ensureCollection(): Promise<void> {
    if (!this.isEnabled()) return;
    const res = await fetch(`${this.base()}/collections/${QDRANT_COLLECTION_TOPICS}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      await fetch(`${this.base()}/collections/${QDRANT_COLLECTION_TOPICS}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: { size: EMBEDDING_DIMS, distance: 'Cosine' },
        }),
        signal: AbortSignal.timeout(10000),
      });
    }
  }

  /** 批量将 PG TopicEmbedding 同步至 Qdrant（更大规模 ANN 检索） */
  async syncFromPostgres(opts?: { batchSize?: number; maxTopics?: number }) {
    if (!this.isEnabled()) {
      return { ok: false, reason: 'QDRANT_URL not set' };
    }

    await this.ensureCollection();

    const batchSize = Math.min(Math.max(opts?.batchSize ?? 128, 16), 512);
    const maxTopics = Math.min(Math.max(opts?.maxTopics ?? 5000, 1), 50_000);

    const rows = await this.prisma.topicEmbedding.findMany({
      take: maxTopics,
      include: { topic: { select: { id: true, slug: true, title: true } } },
      orderBy: { topicId: 'asc' },
    });

    let upserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const points = chunk
        .map((row) => {
          if (!Array.isArray(row.vector)) return null;
          const vector = row.vector.filter((x): x is number => typeof x === 'number');
          if (vector.length !== EMBEDDING_DIMS) return null;
          return {
            id: qdrantPointIdFromBigint(row.topicId),
            vector,
            payload: {
              topicId: row.topicId.toString(),
              slug: row.topic.slug,
              title: row.topic.title,
              model: row.model ?? DEFAULT_EMBEDDING_MODEL,
            },
          };
        })
        .filter(Boolean);

      if (points.length === 0) continue;

      const res = await fetch(
        `${this.base()}/collections/${QDRANT_COLLECTION_TOPICS}/points?wait=true`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Qdrant upsert HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      upserted += points.length;
    }

    this.logger.log(`Topic vectors synced to Qdrant: ${upserted}/${rows.length}`);
    return {
      ok: true,
      collection: QDRANT_COLLECTION_TOPICS,
      totalEmbeddings: rows.length,
      upserted,
    };
  }

  async knnSimilarTopics(
    vector: number[],
    excludeTopicId: bigint,
    limit: number,
  ): Promise<Array<{ topicId: string; score: number; slug?: string; title?: string }>> {
    if (!this.isEnabled()) return [];

    const res = await fetch(
      `${this.base()}/collections/${QDRANT_COLLECTION_TOPICS}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vector,
          limit: limit + 5,
          with_payload: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return [];

    const data = (await res.json()) as {
      result?: Array<{
        id: number | string;
        score: number;
        payload?: { topicId?: string; slug?: string; title?: string };
      }>;
    };

    return (data.result ?? [])
      .filter((h) => String(h.payload?.topicId ?? h.id) !== excludeTopicId.toString())
      .slice(0, limit)
      .map((h) => ({
        topicId: String(h.payload?.topicId ?? h.id),
        score: h.score,
        slug: h.payload?.slug,
        title: h.payload?.title,
      }));
  }
}
