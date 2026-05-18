import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_RULES_V1,
  AI_AGENT_TREND_V1,
  resolveAiAnalysisAgentKind,
} from './ai-agent.constants';

@Injectable()
export class SnapshotAnalyzeService {
  constructor(private readonly prisma: PrismaService) {}

  async listAnalyses(
    snapshotId: bigint,
    filters?: {
      agentKind?: string;
      agent?: string;
      limit?: number;
      offset?: number;
    },
  ) {
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
    if (k === 'followup') {
      where.OR = [
        { agent: AI_AGENT_POST_SNAPSHOT_SUMMARY_V1 },
        { detailJson: { path: ['agentKind'], equals: 'followup' } },
      ];
    } else if (k === 'trend') {
      where.OR = [
        { agent: AI_AGENT_TREND_V1 },
        { detailJson: { path: ['agentKind'], equals: 'trend' } },
      ];
    } else if (k === 'credibility') {
      where.OR = [
        { agent: AI_AGENT_CREDIBILITY_V1 },
        { detailJson: { path: ['agentKind'], equals: 'credibility' } },
      ];
    } else if (k === 'default') {
      where.NOT = {
        OR: [
          { agent: AI_AGENT_POST_SNAPSHOT_SUMMARY_V1 },
          { agent: AI_AGENT_TREND_V1 },
          { agent: AI_AGENT_CREDIBILITY_V1 },
          { detailJson: { path: ['agentKind'], equals: 'followup' } },
          { detailJson: { path: ['agentKind'], equals: 'trend' } },
          { detailJson: { path: ['agentKind'], equals: 'credibility' } },
        ],
      };
    }
    return where;
  }

  async analyzeSnapshot(
    snapshotId: bigint,
    opts: { agent?: string; topN?: number; chainContext?: string },
  ) {
    const quota = await this.checkAnalysisDailyCap();
    if (!quota.ok) {
      throw new BadRequestException(`AiAnalysis quota: ${quota.reason}`);
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
    let summary = `本榜前 ${snap.items.length} 名：${names.join('、')}。`;
    summary = await this.maybeOpenAiSummary(
      lines.join('\n'),
      summary,
      agentResolved,
      opts.chainContext,
    );

    return this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: agentResolved,
        summary,
        detailJson: {
          schemaVersion: 1,
          topN,
          lines,
          snapshotVersion: snap.snapshotVersion,
          agentKind: resolveAiAnalysisAgentKind(agentResolved),
          usedChainContext: Boolean(opts.chainContext?.trim()),
        },
        confidence: process.env.OPENAI_API_KEY?.trim() ? 0.85 : 0.55,
      },
    });
  }

  /**
   * 全局「软配额」占位（按 UTC 日 `AiAnalysis` 条数）。生产请改为多租户 Redis / DB 计费等。
   */
  private async checkAnalysisDailyCap(): Promise<
    { ok: true } | { ok: false; reason: string }
  > {
    const raw = process.env.AI_ANALYSIS_DAILY_CAP?.trim();
    if (!raw) return { ok: true };
    const cap = Number(raw);
    if (!Number.isFinite(cap) || cap < 0) return { ok: true };
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.aiAnalysis.count({
      where: { createdAt: { gte: since } },
    });
    if (count >= cap) {
      return { ok: false, reason: `daily cap ${cap} (UTC) reached` };
    }
    return { ok: true };
  }

  private buildUserPromptRankingBlock(rankingLines: string, chainContext?: string): string {
    const ctx = chainContext?.trim();
    if (!ctx) return rankingLines;
    return [
      '以下为流水线中前序步骤已生成的摘要（供衔接；请勿逐句复述。若与下列结构化榜单数据抵触，以榜单元数据为准。）',
      ctx,
      '',
      '---',
      '',
      '榜单元数据（名次、trendType、popularity）：',
      rankingLines,
    ].join('\n');
  }

  private systemPromptForAgent(agent: string): string {
    if (agent === AI_AGENT_POST_SNAPSHOT_SUMMARY_V1) {
      return (
        '你是排行榜运营助手。根据下列名次与趋势标签，用 2～3 句中文写出运营可读摘要，语气客观，不得编造未出现的实体名；可略提名次分布特点。'
      );
    }
    if (agent === AI_AGENT_TREND_V1) {
      return (
        '你是数据分析师。仅依据下列名次、trendType 与 popularity，用 2～4 句中文解读当前榜单的「位置—标签」模式：可点名具体位次上的实体，说明哪些趋势标签集中出现在前列/后列；不得编造未出现的名称或外部数据。'
      );
    }
    if (agent === AI_AGENT_CREDIBILITY_V1) {
      return (
        '你是风险语感助手。仅基于下列结构化排名与趋势标签，用 2～3 句中文说明该结果在可解释性上的边界：可提及榜样条权重或标签同质性等「榜单内」线索；避免断言真实世界真伪或引用未提供来源，不得编造实体或事件。'
      );
    }
    return '你是排行榜运营助手。请用 2～4 句中文概括下列排名信息，语气客观，不要编造未出现的名字。';
  }

  private async maybeOpenAiSummary(
    context: string,
    fallback: string,
    agent: string,
    chainContext?: string,
  ): Promise<string> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return fallback;

    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    const userContent = this.buildUserPromptRankingBlock(context, chainContext);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: this.systemPromptForAgent(agent),
            },
            { role: 'user', content: userContent },
          ],
          max_tokens: 300,
          temperature: 0.4,
        }),
      });
      if (!res.ok) return fallback;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }
}
