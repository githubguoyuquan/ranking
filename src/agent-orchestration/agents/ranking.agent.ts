import { Injectable, NotFoundException } from '@nestjs/common';
import { AI_AUDIT_SOURCE_RANKING_FOLLOWUP } from '../../ai-audit/ai-audit.constants';
import {
  AI_AGENT_RANKING_V1,
  resolveAiAnalysisAgentKind,
} from '../../agent/ai-agent.constants';
import { optionalAgentLlm } from '../../agent/agent-llm.helper';
import { parseRankingPolicyJson } from '../../domain/policy-json';
import { PrismaService } from '../../prisma/prisma.service';

type SignalGap = {
  entityId: string;
  entityName: string;
  missingKeys: string[];
};

@Injectable()
export class RankingAgent {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: {
    snapshotId: string;
    topN?: number;
    chainContext?: string;
  }): Promise<{
    snapshotId: string;
    aiAnalysisId: string;
    summary: string;
    coverageRatio: number;
    gaps: SignalGap[];
  }> {
    const snapshotId = BigInt(input.snapshotId.trim());
    const topN = Math.min(Math.max(input.topN ?? 10, 1), 50);

    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        items: {
          orderBy: { rank: 'asc' },
          take: topN,
          include: { entity: true },
        },
        topicRanking: {
          select: { topicVersion: { select: { policyJson: true } } },
        },
      },
    });
    if (!snap) throw new NotFoundException('snapshot not found');

    let policy;
    try {
      policy = parseRankingPolicyJson(snap.topicRanking.topicVersion.policyJson);
    } catch {
      policy = {
        weights: { streams: 0.35, mentions: 0.25, social: 0.2, news: 0.2 },
        requiredSignalKeys: ['streams', 'mentions'],
      };
    }

    const signalKeys = [
      ...new Set([
        ...Object.keys(policy.weights),
        ...(policy.requiredSignalKeys ?? []),
      ]),
    ];
    const required = policy.requiredSignalKeys ?? signalKeys;
    const entityIds = snap.items.map((i) => i.entityId);

    const metrics = await this.prisma.entityMetric.findMany({
      where: { entityId: { in: entityIds } },
      select: { entityId: true, metricKey: true },
    });

    const keysByEntity = new Map<string, Set<string>>();
    for (const m of metrics) {
      const id = m.entityId.toString();
      const set = keysByEntity.get(id) ?? new Set<string>();
      set.add(m.metricKey);
      keysByEntity.set(id, set);
    }

    const gaps: SignalGap[] = [];
    let coveredSlots = 0;
    const totalSlots = snap.items.length * required.length;

    for (const item of snap.items) {
      const eid = item.entityId.toString();
      const have = keysByEntity.get(eid) ?? new Set<string>();
      const missing = required.filter((k) => !have.has(k));
      for (const k of required) {
        if (have.has(k)) coveredSlots += 1;
      }
      if (missing.length > 0) {
        gaps.push({
          entityId: eid,
          entityName: item.entity.canonicalName,
          missingKeys: missing,
        });
      }
    }

    const coverageRatio =
      totalSlots > 0 ? coveredSlots / totalSlots : 1;
    const weightSum = Object.values(policy.weights).reduce((a, b) => a + b, 0);
    const weightWarning =
      Math.abs(weightSum - 1) > 0.05
        ? `权重和=${weightSum.toFixed(3)}（偏离 1.0）。`
        : '';

    const sidStr = snapshotId.toString();
    const gapSample = gaps
      .slice(0, 5)
      .map((g) => `${g.entityName}缺${g.missingKeys.join('/')}`)
      .join('；');

    const fallback =
      `快照 #${sidStr} 排行诊断：必填信号覆盖率 ${(coverageRatio * 100).toFixed(0)}%。` +
      (gapSample ? `缺口示例：${gapSample}。` : '前 N 名信号齐全。') +
      weightWarning;

    const ctx = input.chainContext?.trim();
    const userBlock = [
      ctx ? `前序上下文：\n${ctx}\n\n---\n` : '',
      `coverageRatio=${coverageRatio.toFixed(3)}`,
      `requiredSignals=${required.join(',')}`,
      `gaps=${JSON.stringify(gaps.slice(0, 10))}`,
      weightWarning,
    ]
      .filter(Boolean)
      .join('\n');

    const llm = await optionalAgentLlm({
      systemPrompt:
        '你是排行策略助手。仅根据信号覆盖率与缺口 JSON 给出 2～3 句运营建议（补数/调权），不得编造实体或外部事件。',
      userContent: userBlock,
      fallback,
    });

    const newConfidence = Math.min(
      0.98,
      Math.max(0.35, 0.5 + 0.5 * coverageRatio),
    );

    const row = await this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: AI_AGENT_RANKING_V1,
        summary: llm.text.slice(0, 4000),
        detailJson: {
          schemaVersion: 1,
          agentKind: resolveAiAnalysisAgentKind(AI_AGENT_RANKING_V1),
          coverageRatio,
          weightSum,
          gapCount: gaps.length,
          gaps: gaps.slice(0, 20),
          usedLlm: llm.usedLlm,
          auditSource: AI_AUDIT_SOURCE_RANKING_FOLLOWUP,
        },
        confidence: newConfidence,
      },
    });

    await this.prisma.topicRankSnapshot.update({
      where: { id: snapshotId },
      data: { confidenceScore: newConfidence },
    });

    return {
      snapshotId: sidStr,
      aiAnalysisId: row.id.toString(),
      summary: row.summary,
      coverageRatio,
      gaps: gaps.slice(0, 20),
    };
  }
}
