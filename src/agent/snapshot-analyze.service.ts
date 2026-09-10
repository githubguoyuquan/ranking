import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestContext } from '../compliance/compliance-auth.types';
import { assertTopicAccessible } from '../compliance/tenant-scope';
import type { Prisma } from '@prisma/client';
import {
  AI_AUDIT_SOURCE_API,
  AI_AUDIT_SOURCE_RANKING_FOLLOWUP,
} from '../ai-audit/ai-audit.constants';
import { AiAuditService } from '../ai-audit/ai-audit.service';
import { parseTenantSettings } from '../compliance/tenant-settings';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_AGENT_RULES_V1,
  LIST_ANALYSES_AGENT_KINDS,
  resolveAiAnalysisAgentKind,
  type ListAnalysesAgentKind,
} from './ai-agent.constants';
import { buildAiAnalysisAgentKindFilter } from './ai-analysis-kind-filter';

type LlmSummaryResult = {
  text: string;
  usedLlm: boolean;
  model: string | null;
  usage: { prompt: number; completion: number; total: number } | null;
};

@Injectable()
export class SnapshotAnalyzeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AiAuditService,
  ) {}

  async listAnalyses(
    snapshotId: bigint,
    filters?: {
      agentKind?: string;
      agent?: string;
      limit?: number;
      offset?: number;
    },
    auth?: AuthenticatedRequestContext | null,
  ) {
    const snapshot = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      select: { topicRanking: { select: { topicVersion: { select: { topic: { select: { tenantId: true } } } } } } },
    });
    if (!snapshot) throw new NotFoundException('TopicRankSnapshot not found');
    await assertTopicAccessible(snapshot.topicRanking.topicVersion.topic, auth);
    const where = this.buildListAnalysesWhere(snapshotId, filters);
    const take = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const skip = Math.min(Math.max(filters?.offset ?? 0, 0), 100_000);

    const [total, analyses] = await this.prisma.$transaction([
      this.prisma.aiAnalysis.count({ where }),
      this.prisma.aiAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    return {
      filter: {
        agentKind: filters?.agentKind?.trim() || null,
        agent: filters?.agent?.trim()?.slice(0, 120) || null,
        limit: take,
        offset: skip,
      },
      total,
      analyses,
    };
  }

  private buildListAnalysesWhere(
    snapshotId: bigint,
    filters?: { agentKind?: string; agent?: string },
  ): Prisma.AiAnalysisWhereInput {
    const where: Prisma.AiAnalysisWhereInput = { snapshotId };
    const agentQ = filters?.agent?.trim();
    if (agentQ) {
      where.agent = agentQ.slice(0, 120);
    }
    const k = filters?.agentKind?.trim();
    if (
      k &&
      (LIST_ANALYSES_AGENT_KINDS as readonly string[]).includes(k)
    ) {
      Object.assign(where, buildAiAnalysisAgentKindFilter(k as ListAnalysesAgentKind));
    }
    return where;
  }

  /** UTC 日 `AiAnalysis` 配额预检（编排 agent 与 `analyzeSnapshot` 共用） */
  async assertAnalysisQuota(snapshotId: bigint): Promise<void> {
    const cap = await this.resolveAnalysisDailyCap(snapshotId);
    if (cap === null) return;
    const { start: dayStart } = this.audit.utcDayBounds();
    const preCount = await this.countAnalysesForQuota(snapshotId, dayStart);
    if (preCount >= cap) {
      throw new BadRequestException(
        `AiAnalysis quota: daily cap ${cap} (UTC) reached`,
      );
    }
  }

  /**
   * @param ctx.auditSource — `api`（默认）或 `ranking_followup` 等，用于配额审计图谱
   */
  async analyzeSnapshot(
    snapshotId: bigint,
    opts: { agent?: string; topN?: number; chainContext?: string },
    ctx?: { auditSource?: string },
  ) {
    const auditSource =
      ctx?.auditSource === AI_AUDIT_SOURCE_RANKING_FOLLOWUP
        ? AI_AUDIT_SOURCE_RANKING_FOLLOWUP
        : AI_AUDIT_SOURCE_API;
    const requestId = this.audit.newRequestId();
    const { start: dayStart } = this.audit.utcDayBounds();
    const cap = await this.resolveAnalysisDailyCap(snapshotId);

    if (cap !== null) {
      const preCount = await this.countAnalysesForQuota(snapshotId, dayStart);
      if (preCount >= cap) {
        await this.audit.recordChatAttempt({
          category: 'CHAT_COMPLETION',
          operation: 'analyzeSnapshot',
          model: null,
          snapshotId,
          aiAnalysisId: null,
          success: false,
          quotaDecision: 'DENIED_DAILY_CAP',
          requestId,
          source: auditSource,
          metadata: { phase: 'pre_flight', cap },
        });
        throw new BadRequestException(
          `AiAnalysis quota: daily cap ${cap} (UTC) reached`,
        );
      }
    }

    const topN = Math.min(Math.max(opts.topN ?? 8, 1), 50);
    const agentResolved = (opts.agent?.trim() || AI_AGENT_RULES_V1).slice(0, 120);
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        items: {
          orderBy: { rank: 'asc' },
          take: topN,
          include: { entity: true },
        },
      },
    });
    if (!snap) throw new NotFoundException('TopicRankSnapshot not found');

    const lines = snap.items.map(
      (it) =>
        `#${it.rank} ${it.entity.canonicalName} (${it.trendType}, popularity ${it.popularityScore.toFixed(2)})`,
    );
    const names = snap.items.map((i) => i.entity.canonicalName);
    const baseline = `本榜前 ${snap.items.length} 名：${names.join('、')}。`;
    const llm = await this.localSummary(
      lines.join('\n'),
      baseline,
      agentResolved,
      opts.chainContext,
    );

    return this.prisma.$transaction(async (tx) => {
      if (cap !== null) {
        const n = await this.countAnalysesForQuotaInTx(tx, snapshotId, dayStart);
        if (n >= cap) {
          await this.audit.recordChatInTx(tx, {
            category: 'CHAT_COMPLETION',
            operation: 'analyzeSnapshot',
            model: llm.model,
            snapshotId,
            aiAnalysisId: null,
            success: false,
            quotaDecision: 'DENIED_DAILY_CAP',
            requestId,
            source: auditSource,
            promptTokens: llm.usage?.prompt ?? null,
            completionTokens: llm.usage?.completion ?? null,
            totalTokens: llm.usage?.total ?? null,
            metadata: { phase: 'post_llm_race', cap },
          });
          throw new BadRequestException(
            `AiAnalysis quota: daily cap ${cap} (UTC) reached (post-check)`,
          );
        }
      }

      const row = await tx.aiAnalysis.create({
        data: {
          snapshotId,
          agent: agentResolved,
          summary: llm.text,
          detailJson: {
            schemaVersion: 1,
            topN,
            lines,
            snapshotVersion: snap.snapshotVersion,
            agentKind: resolveAiAnalysisAgentKind(agentResolved),
            usedChainContext: Boolean(opts.chainContext?.trim()),
            auditRequestId: requestId,
          },
          confidence: 0.55,
        },
      });

      await this.audit.recordChatInTx(tx, {
        category: 'CHAT_COMPLETION',
        operation: 'analyzeSnapshot',
        model: llm.model,
        snapshotId,
        aiAnalysisId: row.id,
        success: true,
        quotaDecision: llm.usedLlm ? 'ALLOWED' : 'SKIPPED_NO_API_KEY',
        promptTokens: llm.usage?.prompt ?? null,
        completionTokens: llm.usage?.completion ?? null,
        totalTokens: llm.usage?.total ?? null,
        requestId,
        source: auditSource,
        metadata: { agent: agentResolved, topN },
      });

      return row;
    });
  }

  /** UTC 自然日 `AiAnalysis` 条数上限；租户 settings 优先于全局 env */
  private async resolveAnalysisDailyCap(snapshotId: bigint): Promise<number | null> {
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        topicRanking: {
          select: {
            topicVersion: {
              select: {
                topic: {
                  select: { tenant: { select: { settingsJson: true } } },
                },
              },
            },
          },
        },
      },
    });
    const settings = parseTenantSettings(
      snap?.topicRanking?.topicVersion?.topic?.tenant?.settingsJson,
    );
    if (settings.aiAnalysisDailyCap !== undefined) {
      return settings.aiAnalysisDailyCap;
    }
    return this.readGlobalAnalysisDailyCap();
  }

  private readGlobalAnalysisDailyCap(): number | null {
    const raw = process.env.AI_ANALYSIS_DAILY_CAP?.trim();
    if (!raw) return null;
    const cap = Number(raw);
    if (!Number.isFinite(cap) || cap < 0) return null;
    return cap;
  }

  private async tenantIdForSnapshot(snapshotId: bigint): Promise<bigint | null> {
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        topicRanking: {
          select: {
            topicVersion: { select: { topic: { select: { tenantId: true } } } },
          },
        },
      },
    });
    return snap?.topicRanking?.topicVersion?.topic?.tenantId ?? null;
  }

  private async countAnalysesForQuota(
    snapshotId: bigint,
    since: Date,
  ): Promise<number> {
    const tenantId = await this.tenantIdForSnapshot(snapshotId);
    if (tenantId != null) {
      return this.audit.countAnalysesForTenantSince(tenantId, since);
    }
    return this.audit.countAnalysesSince(since);
  }

  private async countAnalysesForQuotaInTx(
    tx: Prisma.TransactionClient,
    snapshotId: bigint,
    since: Date,
  ): Promise<number> {
    const tenantId = await this.tenantIdForSnapshot(snapshotId);
    if (tenantId != null) {
      return tx.aiAnalysis.count({
        where: {
          createdAt: { gte: since },
          snapshot: {
            topicRanking: {
              topicVersion: { topic: { tenantId } },
            },
          },
        },
      });
    }
    return tx.aiAnalysis.count({ where: { createdAt: { gte: since } } });
  }

  private async localSummary(
    _context: string,
    fallback: string,
    _agent: string,
    _chainContext?: string,
  ): Promise<LlmSummaryResult> {
    void _agent;
    void _chainContext;
    return { text: fallback, usedLlm: false, model: null, usage: null };
  }
}
