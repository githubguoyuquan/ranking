import { Injectable, NotFoundException } from '@nestjs/common';
import { AI_AUDIT_SOURCE_RANKING_FOLLOWUP } from '../../ai-audit/ai-audit.constants';
import {
  AI_AGENT_TREND_ANALYSIS_V1,
  resolveAiAnalysisAgentKind,
} from '../../agent/ai-agent.constants';
import { optionalAgentLlm } from '../../agent/agent-llm.helper';
import { PrismaService } from '../../prisma/prisma.service';

type SnapshotTrendPayload = {
  schemaVersion?: number;
  kind?: string;
  snapshotId?: string;
  trendTypeCounts?: Record<string, number>;
  topRankGainers?: Array<{
    entityId: string;
    canonicalName: string;
    rankChange: number | null;
  }>;
  topRankLosers?: Array<{
    entityId: string;
    canonicalName: string;
    rankChange: number | null;
  }>;
  avgConfidence?: number;
  itemCount?: number;
};

@Injectable()
export class TrendAnalysisAgent {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: {
    snapshotId: string;
    topN?: number;
    chainContext?: string;
  }): Promise<{
    snapshotId: string;
    aiAnalysisId: string;
    summary: string;
    trendAnalysisId: string | null;
  }> {
    const snapshotId = BigInt(input.snapshotId.trim());
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        topicRanking: {
          select: {
            timeWindow: true,
            topicVersion: { select: { topicId: true } },
          },
        },
      },
    });
    if (!snap) throw new NotFoundException('snapshot not found');

    const topicId = snap.topicRanking.topicVersion.topicId;
    const timeWindow = snap.topicRanking.timeWindow;
    const sidStr = snapshotId.toString();

    let trendRow = await this.prisma.trendAnalysis.findFirst({
      where: {
        topicId,
        entityId: null,
        window: timeWindow,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (trendRow?.payload && typeof trendRow.payload === 'object') {
      const p = trendRow.payload as SnapshotTrendPayload;
      if (p.snapshotId !== sidStr) {
        const matched = await this.prisma.trendAnalysis.findMany({
          where: { topicId, entityId: null, window: timeWindow },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        trendRow =
          matched.find(
            (r) =>
              r.payload &&
              typeof r.payload === 'object' &&
              (r.payload as SnapshotTrendPayload).snapshotId === sidStr,
          ) ?? trendRow;
      }
    }

    const payload = (trendRow?.payload ?? {}) as SnapshotTrendPayload;
    const counts = payload.trendTypeCounts ?? {};
    const gainers = (payload.topRankGainers ?? []).slice(0, 5);
    const losers = (payload.topRankLosers ?? []).slice(0, 5);

    const countParts = Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join('、');
    const gainerText =
      gainers.length > 0
        ? gainers
            .map((g) => `${g.canonicalName}(+${g.rankChange ?? 0})`)
            .join('、')
        : '无显著涨榜';
    const loserText =
      losers.length > 0
        ? losers.map((g) => `${g.canonicalName}(${g.rankChange ?? 0})`).join('、')
        : '无显著跌榜';

    const fallback =
      `快照 #${sidStr} 趋势分析：` +
      (countParts ? `标签分布 ${countParts}。` : '暂无标签分布。') +
      `涨榜：${gainerText}；跌榜：${loserText}。` +
      (payload.avgConfidence != null
        ? `平均置信 ${payload.avgConfidence.toFixed(2)}。`
        : '');

    const ctx = input.chainContext?.trim();
    const userBlock = [
      ctx ? `前序上下文：\n${ctx}\n\n---\n` : '',
      `snapshotId=${sidStr}`,
      `trendTypeCounts=${JSON.stringify(counts)}`,
      `topRankGainers=${JSON.stringify(gainers)}`,
      `topRankLosers=${JSON.stringify(losers)}`,
      payload.avgConfidence != null ? `avgConfidence=${payload.avgConfidence}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const llm = await optionalAgentLlm({
      systemPrompt:
        '你是趋势分析师。仅依据提供的 trendTypeCounts、涨榜/跌榜列表解读动量与异常模式，2～4 句中文，不得编造未出现的实体名或外部数据。',
      userContent: userBlock,
      fallback,
    });

    const row = await this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: AI_AGENT_TREND_ANALYSIS_V1,
        summary: llm.text.slice(0, 4000),
        detailJson: {
          schemaVersion: 1,
          agentKind: resolveAiAnalysisAgentKind(AI_AGENT_TREND_ANALYSIS_V1),
          trendAnalysisId: trendRow?.id.toString() ?? null,
          payloadDigest: {
            trendTypeCounts: counts,
            gainerCount: gainers.length,
            loserCount: losers.length,
          },
          usedLlm: llm.usedLlm,
          auditSource: AI_AUDIT_SOURCE_RANKING_FOLLOWUP,
        },
        confidence: llm.usedLlm ? 0.82 : 0.68,
      },
    });

    return {
      snapshotId: sidStr,
      aiAnalysisId: row.id.toString(),
      summary: row.summary,
      trendAnalysisId: trendRow?.id.toString() ?? null,
    };
  }
}
