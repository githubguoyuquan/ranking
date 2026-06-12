import { Injectable, NotFoundException } from '@nestjs/common';
import { ClickhouseService } from '../../analytics/clickhouse.service';
import { AI_AUDIT_SOURCE_RANKING_FOLLOWUP } from '../../ai-audit/ai-audit.constants';
import {
  AI_AGENT_TIME_SERIES_V1,
  resolveAiAnalysisAgentKind,
} from '../../agent/ai-agent.constants';
import { optionalAgentLlm } from '../../agent/agent-llm.helper';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TimeSeriesAgent {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService,
  ) {}

  async run(input: {
    snapshotId: string;
    chainContext?: string;
  }): Promise<{
    snapshotId: string;
    aiAnalysisId: string;
    summary: string;
    clickhouseRowCount: number;
  }> {
    const snapshotId = BigInt(input.snapshotId.trim());
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        snapshotTime: true,
        confidenceScore: true,
        topicRanking: {
          select: {
            timeWindow: true,
            topicVersion: {
              select: {
                topic: { select: { slug: true, title: true, kind: true } },
              },
            },
          },
        },
      },
    });
    if (!snap) throw new NotFoundException('snapshot not found');

    const sidStr = snapshotId.toString();
    const ch = await this.clickhouse.querySnapshotMetrics(snapshotId);
    const rows = ch.rows;

    const byEntity = new Map<number, Map<string, number[]>>();
    for (const r of rows) {
      const ent = byEntity.get(r.entity_id) ?? new Map<string, number[]>();
      const vals = ent.get(r.metric_key) ?? [];
      vals.push(r.value);
      ent.set(r.metric_key, vals);
      byEntity.set(r.entity_id, ent);
    }

    const entityCount = byEntity.size;
    const metricKeys = new Set(rows.map((r) => r.metric_key));
    let maxVal = 0;
    let minVal = Infinity;
    for (const r of rows) {
      if (r.value > maxVal) maxVal = r.value;
      if (r.value < minVal) minVal = r.value;
    }
    if (rows.length === 0) minVal = 0;

    const topic = snap.topicRanking.topicVersion.topic;
    const fallback =
      ch.ok && rows.length > 0
        ? `快照 #${sidStr}（${topic.slug}）OLAP：${rows.length} 条时序点，${entityCount} 实体，${metricKeys.size} 指标键；值域 ${minVal.toFixed(2)}～${maxVal.toFixed(2)}。PG 置信 ${snap.confidenceScore?.toFixed(2) ?? 'n/a'}。`
        : `快照 #${sidStr}（${topic.slug}）：ClickHouse ${ch.reason ?? '无数据'}；PG 窗口 ${snap.topicRanking.timeWindow}，置信 ${snap.confidenceScore?.toFixed(2) ?? 'n/a'}。`;

    const ctx = input.chainContext?.trim();
    const userBlock = [
      ctx ? `前序上下文：\n${ctx}\n\n---\n` : '',
      `topic=${topic.slug} kind=${topic.kind}`,
      `timeWindow=${snap.topicRanking.timeWindow}`,
      `clickhouseOk=${ch.ok} rowCount=${rows.length}`,
      `entityCount=${entityCount} metricKeys=${[...metricKeys].join(',')}`,
      `valueRange=${minVal.toFixed(2)}..${maxVal.toFixed(2)}`,
      `pgConfidence=${snap.confidenceScore ?? 'null'}`,
    ].join('\n');

    const llm = await optionalAgentLlm({
      systemPrompt:
        '你是时序分析助手。结合 PG 快照元数据与 ClickHouse 聚合摘要，用 2～4 句中文说明数据覆盖与可分析性；无 CH 数据时说明局限，不得编造。',
      userContent: userBlock,
      fallback,
    });

    const row = await this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: AI_AGENT_TIME_SERIES_V1,
        summary: llm.text.slice(0, 4000),
        detailJson: {
          schemaVersion: 1,
          agentKind: resolveAiAnalysisAgentKind(AI_AGENT_TIME_SERIES_V1),
          clickhouse: {
            ok: ch.ok,
            rowCount: rows.length,
            entityCount,
            metricKeys: [...metricKeys],
          },
          postgres: {
            topicSlug: topic.slug,
            timeWindow: snap.topicRanking.timeWindow,
            confidenceScore: snap.confidenceScore,
          },
          usedLlm: llm.usedLlm,
          auditSource: AI_AUDIT_SOURCE_RANKING_FOLLOWUP,
        },
        confidence: ch.ok && rows.length > 0 ? 0.8 : 0.6,
      },
    });

    return {
      snapshotId: sidStr,
      aiAnalysisId: row.id.toString(),
      summary: row.summary,
      clickhouseRowCount: rows.length,
    };
  }
}
