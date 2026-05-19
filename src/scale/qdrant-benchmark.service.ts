import { Injectable } from '@nestjs/common';
import { EMBEDDING_DIMS } from '../search/embedding.constants';
import { QDRANT_COLLECTION_ENTITIES } from '../search/qdrant.constants';
import { QdrantSearchService } from '../search/qdrant-search.service';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

function latencyStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    avg: sum / (samples.length || 1),
  };
}

export type QdrantBenchmarkResult = {
  ok: boolean;
  collection: string;
  pointsCount?: number;
  lexical: {
    iterations: number;
    hitsPerQuery: number;
    latencyMs: ReturnType<typeof latencyStats>;
    qps: number;
  };
  vector: {
    iterations: number;
    hitsPerQuery: number;
    latencyMs: ReturnType<typeof latencyStats>;
    qps: number;
    skipped?: string;
  };
  detail?: string;
};

@Injectable()
export class QdrantBenchmarkService {
  constructor(private readonly qdrant: QdrantSearchService) {}

  private randomUnitVector(): number[] {
    const v = Array.from({ length: EMBEDDING_DIMS }, () => Math.random() - 0.5);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }

  async run(params?: {
    query?: string;
    iterations?: number;
    limit?: number;
  }): Promise<QdrantBenchmarkResult> {
    if (!this.qdrant.isEnabled()) {
      return {
        ok: false,
        collection: QDRANT_COLLECTION_ENTITIES,
        lexical: {
          iterations: 0,
          hitsPerQuery: 0,
          latencyMs: latencyStats([]),
          qps: 0,
        },
        vector: {
          iterations: 0,
          hitsPerQuery: 0,
          latencyMs: latencyStats([]),
          qps: 0,
          skipped: 'QDRANT_URL not set',
        },
        detail: 'QDRANT_URL not set',
      };
    }

    const iterations = Math.min(Math.max(params?.iterations ?? 30, 1), 200);
    const limit = Math.min(Math.max(params?.limit ?? 10, 1), 50);
    const query = params?.query?.trim() || 'rank';

    let pointsCount: number | undefined;
    try {
      const ping = await this.qdrant.ping();
      if (!ping.ok) {
        return {
          ok: false,
          collection: QDRANT_COLLECTION_ENTITIES,
          lexical: {
            iterations: 0,
            hitsPerQuery: 0,
            latencyMs: latencyStats([]),
            qps: 0,
          },
          vector: {
            iterations: 0,
            hitsPerQuery: 0,
            latencyMs: latencyStats([]),
            qps: 0,
          },
          detail: ping.detail,
        };
      }
    } catch (e) {
      return {
        ok: false,
        collection: QDRANT_COLLECTION_ENTITIES,
        lexical: {
          iterations: 0,
          hitsPerQuery: 0,
          latencyMs: latencyStats([]),
          qps: 0,
        },
        vector: {
          iterations: 0,
          hitsPerQuery: 0,
          latencyMs: latencyStats([]),
          qps: 0,
        },
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    const lexicalSamples: number[] = [];
    let lexicalHits = 0;
    const lexStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const hits = await this.qdrant.searchEntities(query, limit);
      lexicalSamples.push(performance.now() - t0);
      lexicalHits = hits.length;
    }
    const lexElapsed = performance.now() - lexStart;

    const vectorSamples: number[] = [];
    let vectorHits = 0;
    const vec = this.randomUnitVector();
    const vecStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const hits = await this.qdrant.searchEntitiesByVector(vec, limit);
      vectorSamples.push(performance.now() - t0);
      vectorHits = hits.length;
    }
    const vecElapsed = performance.now() - vecStart;

    return {
      ok: true,
      collection: QDRANT_COLLECTION_ENTITIES,
      pointsCount,
      lexical: {
        iterations,
        hitsPerQuery: lexicalHits,
        latencyMs: latencyStats(lexicalSamples),
        qps: iterations / (lexElapsed / 1000 || 1),
      },
      vector: {
        iterations,
        hitsPerQuery: vectorHits,
        latencyMs: latencyStats(vectorSamples),
        qps: iterations / (vecElapsed / 1000 || 1),
      },
    };
  }
}
