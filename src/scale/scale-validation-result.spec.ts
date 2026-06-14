import { describe, expect, it } from 'vitest';
import {
  evaluateScaleValidationSuite,
  scaleValidationThresholdsFromEnv,
  worstScaleStatus,
} from './scale-validation-result';

describe('scale-validation-result', () => {
  it('returns ok when all components pass SLO', () => {
    const thresholds = scaleValidationThresholdsFromEnv({
      SCALE_VALIDATE_ES_P95_MS: '500',
      SCALE_VALIDATE_QDRANT_P95_MS: '300',
      PRODUCTION_WIRING_REQUIRED: 'false',
    });
    const { status, checks } = evaluateScaleValidationSuite(
      {
        elasticsearch: {
          ping: { ok: true },
          benchmark: { ok: true, latencyMs: { p95: 120 } },
        },
        qdrant: {
          ok: true,
          lexical: { latencyMs: { p95: 50 } },
          vector: { latencyMs: { p95: 80 } },
        },
        clickhouse: {
          ping: { ok: true },
          mv: { ok: true },
        },
      },
      thresholds,
    );
    expect(status).toBe('ok');
    expect(checks.every((c) => c.severity === 'ok')).toBe(true);
  });

  it('flags critical when ES required but unreachable', () => {
    const thresholds = scaleValidationThresholdsFromEnv({
      PRODUCTION_WIRING_REQUIRED: 'true',
      SCALE_VALIDATE_REQUIRE_ES: 'true',
    });
    const { status } = evaluateScaleValidationSuite(
      {
        elasticsearch: {
          ping: { ok: false, detail: 'ELASTICSEARCH_NODE not set' },
          benchmark: { ok: false },
        },
        qdrant: { ok: false },
        clickhouse: { ping: { ok: false }, mv: { ok: false } },
      },
      thresholds,
    );
    expect(status).toBe('critical');
    expect(worstScaleStatus([{ code: 'x', severity: 'warn', message: 'w' }])).toBe('warn');
  });

  it('warns on ES p95 SLO breach', () => {
    const thresholds = scaleValidationThresholdsFromEnv({
      SCALE_VALIDATE_ES_P95_MS: '200',
    });
    const { status, checks } = evaluateScaleValidationSuite(
      {
        elasticsearch: {
          ping: { ok: true },
          benchmark: { ok: true, latencyMs: { p95: 450 } },
        },
        qdrant: { ok: true, lexical: { latencyMs: { p95: 10 } }, vector: { latencyMs: { p95: 10 } } },
        clickhouse: { ping: { ok: true }, mv: { ok: true } },
      },
      thresholds,
    );
    expect(status).toBe('warn');
    expect(checks.some((c) => c.code === 'scale_es_p95' && c.severity === 'warn')).toBe(true);
  });
});
