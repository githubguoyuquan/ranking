export type ScaleCheckSeverity = 'ok' | 'warn' | 'critical';

export type ScaleCheckItem = {
  code: string;
  severity: ScaleCheckSeverity;
  message: string;
  hint?: string;
};

export type ScaleValidationThresholds = {
  esP95Ms: number;
  qdrantP95Ms: number;
  requireElasticsearch: boolean;
  requireClickhouse: boolean;
  requireQdrant: boolean;
};

export function scaleValidationThresholdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ScaleValidationThresholds {
  const wiring = env.PRODUCTION_WIRING_REQUIRED === 'true';
  return {
    esP95Ms: numEnv(env.SCALE_VALIDATE_ES_P95_MS, 500),
    qdrantP95Ms: numEnv(env.SCALE_VALIDATE_QDRANT_P95_MS, 300),
    requireElasticsearch:
      env.SCALE_VALIDATE_REQUIRE_ES === 'true' ||
      (wiring && env.SCALE_VALIDATE_REQUIRE_ES !== 'false'),
    requireClickhouse:
      env.SCALE_VALIDATE_REQUIRE_CH === 'true' ||
      (wiring && env.SCALE_VALIDATE_REQUIRE_CH !== 'false'),
    requireQdrant:
      env.SCALE_VALIDATE_REQUIRE_QDRANT === 'true' ||
      (wiring && env.SCALE_VALIDATE_REQUIRE_QDRANT !== 'false'),
  };
}

export function worstScaleStatus(checks: ScaleCheckItem[]): ScaleCheckSeverity {
  if (checks.some((c) => c.severity === 'critical')) return 'critical';
  if (checks.some((c) => c.severity === 'warn')) return 'warn';
  return 'ok';
}

type SuiteInput = {
  elasticsearch: {
    ping: { ok?: boolean; detail?: string };
    benchmark: { ok?: boolean; latencyMs?: { p95?: number }; detail?: string };
  };
  qdrant: {
    ok?: boolean;
    lexical?: { latencyMs?: { p95?: number }; skipped?: string };
    vector?: { latencyMs?: { p95?: number }; skipped?: string };
    detail?: string;
  };
  clickhouse: {
    ping: { ok?: boolean; detail?: string };
    mv: { ok?: boolean; detail?: string };
  };
};

export function evaluateScaleValidationSuite(
  suite: SuiteInput,
  thresholds: ScaleValidationThresholds,
): { status: ScaleCheckSeverity; checks: ScaleCheckItem[] } {
  const checks: ScaleCheckItem[] = [];

  if (!suite.elasticsearch.ping.ok) {
    checks.push({
      code: 'scale_es_ping',
      severity: thresholds.requireElasticsearch ? 'critical' : 'warn',
      message: suite.elasticsearch.ping.detail ?? 'Elasticsearch ping failed',
      hint: 'Set ELASTICSEARCH_NODE to managed OpenSearch / Elastic Cloud endpoint',
    });
  } else {
    checks.push({
      code: 'scale_es_ping',
      severity: 'ok',
      message: 'Elasticsearch reachable',
    });
  }

  const esP95 = suite.elasticsearch.benchmark.latencyMs?.p95 ?? 0;
  if (suite.elasticsearch.benchmark.ok && esP95 > thresholds.esP95Ms) {
    checks.push({
      code: 'scale_es_p95',
      severity: 'warn',
      message: `Elasticsearch p95 ${esP95}ms exceeds ${thresholds.esP95Ms}ms`,
      hint: 'Tune index shards, ILM, or query load',
    });
  } else if (suite.elasticsearch.benchmark.ok) {
    checks.push({
      code: 'scale_es_p95',
      severity: 'ok',
      message: `Elasticsearch p95 ${esP95}ms within SLO`,
    });
  }

  if (!suite.qdrant.ok) {
    checks.push({
      code: 'scale_qdrant_benchmark',
      severity: thresholds.requireQdrant ? 'critical' : 'warn',
      message: suite.qdrant.detail ?? 'Qdrant benchmark failed',
      hint: 'Set QDRANT_URL to Qdrant Cloud or in-cluster service',
    });
  } else {
    const qP95 = Math.max(
      suite.qdrant.lexical?.latencyMs?.p95 ?? 0,
      suite.qdrant.vector?.latencyMs?.p95 ?? 0,
    );
    if (qP95 > thresholds.qdrantP95Ms) {
      checks.push({
        code: 'scale_qdrant_p95',
        severity: 'warn',
        message: `Qdrant p95 ${qP95}ms exceeds ${thresholds.qdrantP95Ms}ms`,
      });
    } else {
      checks.push({
        code: 'scale_qdrant_benchmark',
        severity: 'ok',
        message: 'Qdrant benchmark within SLO',
      });
    }
  }

  if (!suite.clickhouse.ping.ok) {
    checks.push({
      code: 'scale_ch_ping',
      severity: thresholds.requireClickhouse ? 'critical' : 'warn',
      message: suite.clickhouse.ping.detail ?? 'ClickHouse ping failed',
      hint: 'Set CLICKHOUSE_URL to ClickHouse Cloud or managed cluster',
    });
  } else {
    checks.push({
      code: 'scale_ch_ping',
      severity: 'ok',
      message: 'ClickHouse reachable',
    });
  }

  if (suite.clickhouse.ping.ok && !suite.clickhouse.mv.ok) {
    checks.push({
      code: 'scale_ch_mv',
      severity: 'warn',
      message: suite.clickhouse.mv.detail ?? 'ClickHouse MV health check failed',
      hint: 'Ensure metric_daily_topic MV exists and is populated',
    });
  } else if (suite.clickhouse.ping.ok) {
    checks.push({
      code: 'scale_ch_mv',
      severity: 'ok',
      message: 'ClickHouse MV healthy',
    });
  }

  return { status: worstScaleStatus(checks), checks };
}

function numEnv(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
