import { Injectable } from '@nestjs/common';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantBenchmarkService } from './qdrant-benchmark.service';
import {
  evaluateScaleValidationSuite,
  scaleValidationThresholdsFromEnv,
} from './scale-validation-result';

@Injectable()
export class ScaleValidationService {
  constructor(
    private readonly elastic: ElasticService,
    private readonly qdrantBench: QdrantBenchmarkService,
    private readonly clickhouse: ClickhouseService,
  ) {}

  async runSuite(options?: {
    esQuery?: string;
    esIterations?: number;
    qdrantIterations?: number;
  }): Promise<Record<string, unknown>> {
    const [esPing, esIlm, esStats, esBench, qdrantBench, chMv, chPing] =
      await Promise.all([
        this.elastic.ping(),
        this.elastic.getIlmStatus(),
        this.elastic.getIndexStats(),
        this.elastic.benchmarkEntitySearch(
          options?.esQuery ?? 'rank',
          options?.esIterations ?? 15,
        ),
        this.qdrantBench.run({ iterations: options?.qdrantIterations ?? 20 }),
        this.clickhouse.queryMvHealth(),
        this.clickhouse.ping(),
      ]);

    const thresholds = scaleValidationThresholdsFromEnv();
    const evaluation = evaluateScaleValidationSuite(
      {
        elasticsearch: { ping: esPing, benchmark: esBench },
        qdrant: qdrantBench,
        clickhouse: { ping: chPing, mv: chMv },
      },
      thresholds,
    );

    return {
      ok: evaluation.status === 'ok',
      status: evaluation.status,
      checks: evaluation.checks,
      thresholds,
      generatedAt: new Date().toISOString(),
      elasticsearch: {
        ping: esPing,
        ilm: esIlm,
        stats: esStats,
        benchmark: esBench,
        scaleHints: this.elastic.scaleHints(),
      },
      qdrant: qdrantBench,
      clickhouse: {
        ping: chPing,
        mv: chMv,
      },
    };
  }
}
