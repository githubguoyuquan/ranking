import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'crypto';
import type { TimeWindow } from '@prisma/client';

export type MetricTimeseriesRow = {
  ts: string;
  topic_id: number;
  entity_id: number;
  metric_key: string;
  value: number;
  source_tier: number;
  ingested_at: string;
  evidence_id: string;
  snapshot_id: number;
  time_window: string;
};

function chDateTime64(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class ClickhouseService implements OnModuleDestroy {
  private readonly logger = new Logger(ClickhouseService.name);
  private client: ClickHouseClient | null = null;

  constructor() {
    const url = process.env.CLICKHOUSE_URL?.trim();
    if (!url) {
      this.logger.warn('CLICKHOUSE_URL not set — analytics warehouse disabled');
      return;
    }
    this.client = createClient({
      url,
      database: process.env.CLICKHOUSE_DATABASE ?? 'ranking',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      request_timeout: 30_000,
    });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.client) return { ok: false, detail: 'CLICKHOUSE_URL not set' };
    try {
      const rs = await this.client.query({
        query: 'SELECT 1 AS n',
        format: 'JSONEachRow',
      });
      const rows = (await rs.json()) as { n: number }[];
      return { ok: rows[0]?.n === 1, detail: 'SELECT 1' };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async insertMetricTimeseries(rows: MetricTimeseriesRow[]): Promise<void> {
    if (!this.client || rows.length === 0) return;
    await this.client.insert({
      table: 'metric_timeseries',
      values: rows,
      format: 'JSONEachRow',
    });
  }

  /**
   * 将快照中的榜单得分写入 OLAP，便于时间序列/同比（需表已创建）。
   */
  async ingestRankingSnapshot(params: {
    snapshotId: bigint;
    topicId: bigint;
    snapshotTime: Date;
    timeWindow: TimeWindow;
    items: Array<{
      entityId: bigint;
      popularityScore: number;
      rank: number;
    }>;
  }): Promise<void> {
    if (!this.client || params.items.length === 0) return;

    const ingestedAt = chDateTime64(new Date());
    const ts = chDateTime64(params.snapshotTime);
    const tid = Number(params.topicId);
    const sid = Number(params.snapshotId);
    const tw = params.timeWindow;

    const rows: MetricTimeseriesRow[] = [];
    for (const it of params.items) {
      const eid = Number(it.entityId);
      rows.push({
        ts,
        topic_id: tid,
        entity_id: eid,
        metric_key: 'ranking.popularity_score',
        value: it.popularityScore,
        source_tier: 1,
        ingested_at: ingestedAt,
        evidence_id: randomUUID(),
        snapshot_id: sid,
        time_window: tw,
      });
      rows.push({
        ts,
        topic_id: tid,
        entity_id: eid,
        metric_key: 'ranking.rank',
        value: it.rank,
        source_tier: 1,
        ingested_at: ingestedAt,
        evidence_id: randomUUID(),
        snapshot_id: sid,
        time_window: tw,
      });
    }

    await this.insertMetricTimeseries(rows);
    this.logger.log(
      `ClickHouse: wrote ${rows.length} metric rows for snapshot ${params.snapshotId}`,
    );
  }
}
