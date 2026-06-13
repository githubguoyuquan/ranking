import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const OPENAPI_DIR = join(__dirname, '../../docs/openapi');

/** Fragment → minimum path keys that must exist (contract smoke). */
const REQUIRED_PATHS: Record<string, string[]> = {
  'admin-ops.yaml': [
    '/admin/ops/dr/readiness',
    '/admin/ops/k8s/probes',
    '/admin/ops/dr/outbox-replay-plan',
  ],
  'entity-metrics.yaml': [
    '/v1/entities/{id}/metrics',
    '/admin/entities/{id}/metrics',
    '/v1/topic-versions/{topicVersionId}/signal-preview',
  ],
  'trends.yaml': [
    '/v1/trends/hot',
    '/v1/trends/anomalies',
    '/admin/trends/alerts',
  ],
  'ops-analytics.yaml': [
    '/v1/entities/{id}/timeline',
    '/v1/topic-versions/compare',
  ],
  'v1-hot-boards.yaml': ['/v1/hot-boards'],
  'admin-observability.yaml': [
    '/admin/observability/summary',
    '/admin/observability/alerts/routing',
    '/admin/observability/alerts/runbook',
  ],
};

describe('docs/openapi', () => {
  const files = readdirSync(OPENAPI_DIR).filter((f) => f.endsWith('.yaml'));

  it('contains at least one OpenAPI fragment', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('includes ops, entity-metrics, and trends fragments', () => {
    expect(files).toEqual(expect.arrayContaining([
      'admin-ops.yaml',
      'entity-metrics.yaml',
      'trends.yaml',
      'ops-analytics.yaml',
      'v1-hot-boards.yaml',
    ]));
  });

  it.each(files)('%s: parses as YAML and declares OpenAPI 3 paths', (name) => {
    const raw = readFileSync(join(OPENAPI_DIR, name), 'utf8');
    const doc = parse(raw) as Record<string, unknown>;
    expect(String(doc.openapi)).toMatch(/^3\./);
    const paths = doc.paths as Record<string, unknown> | undefined;
    expect(paths).toBeTruthy();
    expect(Object.keys(paths!).length).toBeGreaterThan(0);
    for (const pathItem of Object.values(paths!)) {
      expect(pathItem).toBeTruthy();
    }
  });

  it.each(Object.entries(REQUIRED_PATHS))(
    '%s: declares expected path keys',
    (name, expectedPaths) => {
      const raw = readFileSync(join(OPENAPI_DIR, name), 'utf8');
      const doc = parse(raw) as { paths?: Record<string, unknown> };
      for (const p of expectedPaths) {
        expect(doc.paths).toHaveProperty(p);
      }
    },
  );
});
