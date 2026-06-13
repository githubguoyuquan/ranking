import type { SignalObservation } from './scoring';
import type { SignalRow } from './topic-kind-policy';
import { entityHasRequiredSignals, signalCoverage } from './topic-kind-policy';

export type MetricLike = {
  entityId: bigint;
  metricKey: string;
  value: number;
  sourceTier: number;
  observedAt: Date;
};

/** 按 metricKey 取 asOf 之前最新一条观测 */
export function pickLatestMetricsByKey(
  metrics: MetricLike[],
  asOf: Date,
): Map<string, MetricLike> {
  const latestByKey = new Map<string, MetricLike>();
  for (const row of metrics) {
    if (row.observedAt > asOf) continue;
    const cur = latestByKey.get(row.metricKey);
    if (!cur || row.observedAt > cur.observedAt) latestByKey.set(row.metricKey, row);
  }
  return latestByKey;
}

export function metricsToSignalObservations(
  latestByKey: Map<string, MetricLike>,
): SignalObservation[] {
  return [...latestByKey.entries()].map(([key, row]) => ({
    key,
    raw: row.value,
    observedAt: row.observedAt,
    tier: row.sourceTier,
  }));
}

export function groupMetricsByEntity(metrics: MetricLike[]): Map<string, MetricLike[]> {
  const byEntity = new Map<string, MetricLike[]>();
  for (const m of metrics) {
    const k = m.entityId.toString();
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(m);
  }
  return byEntity;
}

export type EntitySignalIndex = {
  entityId: bigint;
  latestByKey: Map<string, MetricLike>;
  signalRows: SignalRow[];
  signals: SignalObservation[];
  presentKeys: string[];
};

export function indexEntitySignals(
  metrics: MetricLike[],
  entityIds: bigint[],
  asOf: Date,
): EntitySignalIndex[] {
  const byEntity = groupMetricsByEntity(metrics);
  return entityIds.map((entityId) => {
    const list = byEntity.get(entityId.toString()) ?? [];
    const latestByKey = pickLatestMetricsByKey(list, asOf);
    const signalRows: SignalRow[] = [...latestByKey.values()].map((m) => ({
      metricKey: m.metricKey,
      observedAt: m.observedAt,
    }));
    return {
      entityId,
      latestByKey,
      signalRows,
      signals: metricsToSignalObservations(latestByKey),
      presentKeys: [...latestByKey.keys()],
    };
  });
}

export { entityHasRequiredSignals, signalCoverage };
