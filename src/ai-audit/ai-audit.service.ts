import { Injectable } from '@nestjs/common';
import type { AiAuditCategory, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export type RecordChatAuditInput = {
  category: 'CHAT_COMPLETION';
  operation: string;
  model: string | null;
  snapshotId: bigint;
  aiAnalysisId: bigint | null;
  success: boolean;
  quotaDecision?: 'ALLOWED' | 'DENIED_DAILY_CAP' | 'SKIPPED_NO_API_KEY' | null;
  errorMessage?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  requestId: string;
  source: string;
  metadata?: Prisma.InputJsonValue;
};

export type RecordEmbeddingAuditInput = {
  operation: string;
  model: string;
  inputCount: number;
  success: boolean;
  errorMessage?: string | null;
  totalTokens?: number | null;
  source: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class AiAuditService {
  constructor(private readonly prisma: PrismaService) {}

  newRequestId(): string {
    return randomUUID();
  }

  utcDayBounds(d = new Date()): { start: Date; dayKey: string } {
    const start = new Date(d);
    start.setUTCHours(0, 0, 0, 0);
    const dayKey = start.toISOString().slice(0, 10);
    return { start, dayKey };
  }

  async countAnalysesSince(since: Date): Promise<number> {
    return this.prisma.aiAnalysis.count({
      where: { createdAt: { gte: since } },
    });
  }

  async countSuccessfulEmbeddingsSince(since: Date): Promise<number> {
    return this.prisma.aiAuditEvent.count({
      where: {
        createdAt: { gte: since },
        category: 'EMBEDDING',
        success: true,
      },
    });
  }

  async recordChatAttempt(input: RecordChatAuditInput): Promise<void> {
    await this.prisma.aiAuditEvent.create({
      data: {
        category: input.category,
        operation: input.operation.slice(0, 160),
        model: input.model?.slice(0, 128) ?? null,
        snapshotId: input.snapshotId,
        aiAnalysisId: input.aiAnalysisId,
        success: input.success,
        quotaDecision: input.quotaDecision ?? null,
        errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        requestId: input.requestId.slice(0, 128),
        source: input.source.slice(0, 32),
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async recordChatInTx(
    tx: Prisma.TransactionClient,
    input: RecordChatAuditInput,
  ): Promise<void> {
    await tx.aiAuditEvent.create({
      data: {
        category: input.category,
        operation: input.operation.slice(0, 160),
        model: input.model?.slice(0, 128) ?? null,
        snapshotId: input.snapshotId,
        aiAnalysisId: input.aiAnalysisId,
        success: input.success,
        quotaDecision: input.quotaDecision ?? null,
        errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        requestId: input.requestId.slice(0, 128),
        source: input.source.slice(0, 32),
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async recordEmbeddingBatch(input: RecordEmbeddingAuditInput): Promise<void> {
    const baseMeta: Prisma.InputJsonValue = {
      inputCount: input.inputCount,
    };
    const metadata: Prisma.InputJsonValue =
      input.metadata !== undefined && typeof input.metadata === 'object' && input.metadata !== null
        ? { ...baseMeta, ...(input.metadata as object) }
        : baseMeta;

    await this.prisma.aiAuditEvent.create({
      data: {
        category: 'EMBEDDING',
        operation: input.operation.slice(0, 160),
        model: input.model.slice(0, 128),
        snapshotId: null,
        aiAnalysisId: null,
        success: input.success,
        quotaDecision: null,
        errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: input.totalTokens ?? null,
        requestId: null,
        source: input.source.slice(0, 32),
        metadata,
      },
    });
  }

  async getSpectrumSummary(): Promise<Record<string, unknown>> {
    const { start, dayKey } = this.utcDayBounds();
    const analysisCapRaw = process.env.AI_ANALYSIS_DAILY_CAP?.trim();
    const analysisCap =
      analysisCapRaw && Number.isFinite(Number(analysisCapRaw))
        ? Number(analysisCapRaw)
        : null;
    const embeddingCapRaw = process.env.AI_EMBEDDING_DAILY_CAP?.trim();
    const embeddingCap =
      embeddingCapRaw && Number.isFinite(Number(embeddingCapRaw))
        ? Number(embeddingCapRaw)
        : null;

    const [
      analysisRowsToday,
      chatAuditToday,
      embedAuditToday,
      chatBySource,
      deniedQuota,
    ] = await Promise.all([
      this.prisma.aiAnalysis.count({ where: { createdAt: { gte: start } } }),
      this.prisma.aiAuditEvent.count({
        where: {
          createdAt: { gte: start },
          category: 'CHAT_COMPLETION',
        },
      }),
      this.prisma.aiAuditEvent.count({
        where: {
          createdAt: { gte: start },
          category: 'EMBEDDING',
        },
      }),
      this.prisma.aiAuditEvent.groupBy({
        by: ['source'],
        where: { createdAt: { gte: start }, category: 'CHAT_COMPLETION' },
        _count: { id: true },
      }),
      this.prisma.aiAuditEvent.count({
        where: {
          createdAt: { gte: start },
          quotaDecision: 'DENIED_DAILY_CAP',
        },
      }),
    ]);

    const agentKindRows = await this.prisma.$queryRaw<
      { agentKind: string | null; c: bigint }[]
    >`
      SELECT COALESCE("detailJson"->>'agentKind', 'unknown') AS "agentKind", COUNT(*)::bigint AS c
      FROM "AiAnalysis"
      WHERE "createdAt" >= ${start}
      GROUP BY 1
      ORDER BY c DESC
    `;

    const snapshotStems = await this.prisma.topicRankSnapshot.findMany({
      where: {
        analyses: { some: {} },
        snapshotTime: { gte: start },
      },
      orderBy: { id: 'desc' },
      take: 12,
      select: {
        id: true,
        snapshotTime: true,
        topicRankingId: true,
        _count: { select: { analyses: true, aiAudits: true } },
      },
    });

    return {
      utcDay: dayKey,
      quotas: {
        analysisDailyCap: analysisCap,
        analysesPersistedToday: analysisRowsToday,
        embeddingDailyCap: embeddingCap,
        embeddingSuccessBatchesToday: await this.countSuccessfulEmbeddingsSince(start),
        embeddingAuditsToday: embedAuditToday,
        chatAuditsToday: chatAuditToday,
        deniedQuotaEventsToday: deniedQuota,
      },
      byAgentKindToday: Object.fromEntries(
        agentKindRows.map((r) => [r.agentKind ?? 'unknown', Number(r.c)]),
      ),
      chatAuditsBySourceToday: Object.fromEntries(
        chatBySource.map((r) => [r.source, r._count.id]),
      ),
      recentSnapshotsWithAi: snapshotStems.map((s) => ({
        snapshotId: s.id.toString(),
        topicRankingId: s.topicRankingId.toString(),
        snapshotTime: s.snapshotTime.toISOString(),
        analysisCount: s._count.analyses,
        aiAuditCount: s._count.aiAudits,
      })),
    };
  }

  async listAuditEvents(args: {
    limit: number;
    category?: AiAuditCategory;
    source?: string;
  }) {
    const take = Math.min(Math.max(args.limit, 1), 200);
    const where: Prisma.AiAuditEventWhereInput = {};
    if (args.category) where.category = args.category;
    if (args.source?.trim()) where.source = args.source.trim();

    const rows = await this.prisma.aiAuditEvent.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });
    return { count: rows.length, events: rows };
  }
}
