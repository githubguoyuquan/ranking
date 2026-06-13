import { describe, expect, it } from 'vitest';
import {
  indexEntitySignals,
  pickLatestMetricsByKey,
  signalCoverage,
} from './entity-signals';

describe('entity-signals', () => {
  const asOf = new Date('2026-05-17T12:00:00.000Z');

  it('pickLatestMetricsByKey ignores future observations', () => {
    const latest = pickLatestMetricsByKey(
      [
        {
          entityId: 1n,
          metricKey: 'streams',
          value: 10,
          sourceTier: 2,
          observedAt: new Date('2026-05-16T00:00:00.000Z'),
        },
        {
          entityId: 1n,
          metricKey: 'streams',
          value: 99,
          sourceTier: 2,
          observedAt: new Date('2026-05-18T00:00:00.000Z'),
        },
      ],
      asOf,
    );
    expect(latest.get('streams')?.value).toBe(10);
  });

  it('indexEntitySignals builds per-entity present keys', () => {
    const rows = indexEntitySignals(
      [
        {
          entityId: 1n,
          metricKey: 'streams',
          value: 1,
          sourceTier: 1,
          observedAt: new Date('2026-05-10T00:00:00.000Z'),
        },
        {
          entityId: 2n,
          metricKey: 'mentions',
          value: 2,
          sourceTier: 3,
          observedAt: new Date('2026-05-11T00:00:00.000Z'),
        },
      ],
      [1n, 2n],
      asOf,
    );
    expect(rows[0]?.presentKeys).toEqual(['streams']);
    expect(rows[1]?.presentKeys).toEqual(['mentions']);
  });

  it('signalCoverage counts required hits', () => {
    expect(signalCoverage(['streams', 'social'], ['streams', 'mentions'])).toBe(0.5);
  });
});
