import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_DUPLICATE_DETECTION_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_ORCHESTRATION_ALLOWLIST,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_RULES_V1,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  AI_AGENT_TOPIC_MERGE_V1,
  AI_AGENT_TREND_V1,
  parseOrchestrationPipeline,
} from '../agent/ai-agent.constants';
import { AI_AUDIT_SOURCE_RANKING_FOLLOWUP } from '../ai-audit/ai-audit.constants';
import { SnapshotAnalyzeService } from '../agent/snapshot-analyze.service';
import type { RankingPolicyJson } from '../domain/policy-json';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { AgentRunService } from './agent-run.service';
import {
  AI_AGENT_JOB_NAME,
  AI_AGENT_PIPELINE_JOB_NAME,
  AI_AGENT_QUEUE,
  buildAiAgentJobId,
  buildAiAgentPipelineJobId,
  type AiAgentJobPayload,
  type AiAgentPipelineJobPayload,
} from './ai-agent-job';
import { DuplicateDetectionAgent } from './agents/duplicate-detection.agent';
import { FactCheckAgent } from './agents/fact-check.agent';
import { TopicDiscoveryAgent } from './agents/topic-discovery.agent';
import { TopicMergeAgent } from './agents/topic-merge.agent';

@Injectable()
export class AgentOrchestrationService {
  private readonly logger = new Logger(AgentOrchestrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRuns: AgentRunService,
    private readonly snapshotAnalyze: SnapshotAnalyzeService,
    private readonly topicDiscovery: TopicDiscoveryAgent,
    private readonly topicMerge: TopicMergeAgent,
    private readonly factCheck: FactCheckAgent,
    private readonly duplicateDetection: DuplicateDetectionAgent,
    @InjectQueue(AI_AGENT_QUEUE) private readonly aiAgentQueue: Queue,
  ) {}

  isAgentEnabled(): boolean {
    return process.env.AI_AGENT_DISABLED !== 'true';
  }

  crawlDiscoveryEnabled(): boolean {
    return process.env.AI_AGENT_CRAWL_DISCOVERY === 'true';
  }

  /** 爬取任务完成后可选入队 Topic Discovery */
  async maybeEnqueueDiscoveryAfterCrawl(sourceId: bigint): Promise<void> {
    if (!this.isAgentEnabled() || !this.crawlDiscoveryEnabled()) return;
    await this.enqueueAgent(AI_AGENT_TOPIC_DISCOVERY_V1, {
      sourceId: sourceId.toString(),
    });
  }

  async enqueueAgent(
    agent: string,
    input: Record<string, unknown>,
    opts?: { correlationId?: string; parentRunId?: bigint },
  ) {
    const name = agent.trim().slice(0, 120);
    if (!AI_AGENT_ORCHESTRATION_ALLOWLIST.has(name)) {
      throw new BadRequestException(`unknown agent: ${name}`);
    }
    const correlationId = opts?.correlationId ?? randomUUID();
    const snapshotId = input.snapshotId != null ? BigInt(String(input.snapshotId)) : undefined;
    const topicId =
      input.topicId != null
        ? BigInt(String(input.topicId))
        : input.sourceTopicId != null
          ? BigInt(String(input.sourceTopicId))
          : undefined;

    const run = await this.agentRuns.createQueued({
      correlationId,
      agent: name,
      inputJson: input as Prisma.InputJsonValue,
      snapshotId,
      topicId,
      parentRunId: opts?.parentRunId,
    });

    await this.aiAgentQueue.add(
      AI_AGENT_JOB_NAME,
      {
        correlationId,
        agent: name,
        input,
        parentRunId: opts?.parentRunId?.toString(),
        agentRunId: run.id.toString(),
      } satisfies AiAgentJobPayload,
      {
        jobId: buildAiAgentJobId(run.id.toString()),
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );

    return { correlationId, agentRunId: run.id.toString(), agent: name, status: 'queued' };
  }

  async enqueuePipeline(
    agents: string[],
    input: Record<string, unknown>,
    correlationId?: string,
  ) {
    const cid = correlationId ?? randomUUID();
    await this.aiAgentQueue.add(
      AI_AGENT_PIPELINE_JOB_NAME,
      { correlationId: cid, agents, input } satisfies AiAgentPipelineJobPayload,
      {
        jobId: buildAiAgentPipelineJobId(cid),
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    return { correlationId: cid, agents, status: 'queued' };
  }

  resolveDefaultPipeline(): string[] {
    const raw = process.env.AI_AGENT_DEFAULT_PIPELINE?.trim();
    if (raw) {
      const { agents, unknown } = parseOrchestrationPipeline(raw);
      for (const u of unknown) {
        this.logger.warn(`AI_AGENT_DEFAULT_PIPELINE unknown segment "${u}"`);
      }
      return agents;
    }
    return [];
  }

  async handlePipelineJob(data: AiAgentPipelineJobPayload): Promise<Record<string, unknown>> {
    const results: Array<Record<string, unknown>> = [];
    let parentRunId: bigint | undefined;
    for (const agent of data.agents) {
      const enq = await this.enqueueAgent(agent, data.input, {
        correlationId: data.correlationId,
        parentRunId,
      });
      const out = await this.handleAgentJob({
        correlationId: data.correlationId,
        agent,
        input: data.input,
        agentRunId: enq.agentRunId,
        parentRunId: parentRunId?.toString(),
      });
      results.push({ agent, ...out });
      parentRunId = BigInt(enq.agentRunId);
    }
    return toPlainJson({ ok: true, correlationId: data.correlationId, results }) as Record<
      string,
      unknown
    >;
  }

  async handleAgentJob(data: AiAgentJobPayload): Promise<Record<string, unknown>> {
    const runId = BigInt(data.agentRunId);
    await this.agentRuns.markRunning(runId);
    try {
      const output = await this.executeAgent(data.agent, data.input);
      await this.agentRuns.markCompleted(runId, output as Prisma.InputJsonValue);
      return toPlainJson({ ok: true, agent: data.agent, output }) as Record<string, unknown>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.agentRuns.markFailed(runId, msg);
      this.logger.warn(`agent ${data.agent} failed: ${msg}`);
      return { ok: false, agent: data.agent, error: msg };
    }
  }

  private async executeAgent(
    agent: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (agent) {
      case AI_AGENT_TOPIC_DISCOVERY_V1:
        return (await this.topicDiscovery.run({
          sourceId: input.sourceId as string | undefined,
          limit: input.limit as number | undefined,
          minClusterSize: input.minClusterSize as number | undefined,
        })) as unknown as Record<string, unknown>;
      case AI_AGENT_TOPIC_MERGE_V1:
        return (await this.topicMerge.run({
          sourceTopicId: String(input.sourceTopicId ?? ''),
          targetTopicId: String(input.targetTopicId ?? ''),
          dryRun: input.dryRun as boolean | undefined,
          mergedBy: input.mergedBy as string | undefined,
          minSimilarity: input.minSimilarity as number | undefined,
        })) as unknown as Record<string, unknown>;
      case AI_AGENT_FACT_CHECK_V1:
        return (await this.factCheck.run({
          snapshotId: String(input.snapshotId ?? ''),
          topN: input.topN as number | undefined,
        })) as unknown as Record<string, unknown>;
      case AI_AGENT_DUPLICATE_DETECTION_V1:
        return (await this.duplicateDetection.run({
          sourceId: input.sourceId as string | undefined,
          limit: input.limit as number | undefined,
        })) as unknown as Record<string, unknown>;
      case AI_AGENT_RULES_V1:
      case AI_AGENT_POST_SNAPSHOT_SUMMARY_V1:
      case AI_AGENT_TREND_V1:
      case AI_AGENT_CREDIBILITY_V1: {
        const snapshotId = BigInt(String(input.snapshotId ?? ''));
        const row = await this.snapshotAnalyze.analyzeSnapshot(
          snapshotId,
          {
            agent,
            topN: input.topN as number | undefined,
            chainContext: input.chainContext as string | undefined,
          },
          { auditSource: AI_AUDIT_SOURCE_RANKING_FOLLOWUP },
        );
        return {
          aiAnalysisId: row.id.toString(),
          summary: row.summary,
        };
      }
      default:
        throw new Error(`unhandled agent: ${agent}`);
    }
  }

  async listProposals(filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const take = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const skip = Math.min(Math.max(filters?.offset ?? 0, 0), 100_000);
    const where: Prisma.TopicProposalWhereInput = {};
    if (filters?.status?.trim()) where.status = filters.status.trim();
    const [total, proposals] = await this.prisma.$transaction([
      this.prisma.topicProposal.count({ where }),
      this.prisma.topicProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);
    return { total, proposals, limit: take, offset: skip };
  }

  async approveProposal(proposalId: bigint, opts?: { version?: string }) {
    const p = await this.prisma.topicProposal.findUnique({
      where: { id: proposalId },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status !== 'pending') {
      throw new BadRequestException(`proposal status is ${p.status}`);
    }

    const policy: RankingPolicyJson = {
      weights: { streams: 0.35, mentions: 0.25, social: 0.2, news: 0.2 },
      requiredSignalKeys: ['streams', 'mentions', 'social'],
    };

    const topic = await this.prisma.$transaction(async (tx) => {
      const t = await tx.topic.upsert({
        where: { slug: p.suggestedSlug },
        update: { title: p.suggestedTitle, kind: p.kind },
        create: {
          slug: p.suggestedSlug,
          title: p.suggestedTitle,
          kind: p.kind,
          locale: 'en',
        },
      });
      const ver = opts?.version?.trim() || '2026.05';
      await tx.topicVersion.upsert({
        where: { topicId_version: { topicId: t.id, version: ver } },
        create: {
          topicId: t.id,
          version: ver,
          effectiveFrom: new Date(),
          policyJson: policy as unknown as Prisma.InputJsonValue,
        },
        update: {},
      });
      await tx.topicProposal.update({
        where: { id: proposalId },
        data: {
          status: 'approved',
          approvedTopicId: t.id,
        },
      });
      return t;
    });

    return topic;
  }

  async rejectProposal(proposalId: bigint) {
    return this.prisma.topicProposal.update({
      where: { id: proposalId },
      data: { status: 'rejected' },
    });
  }

  async listMergeAudits(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    return this.prisma.topicMergeAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        sourceTopic: { select: { id: true, slug: true, title: true } },
        targetTopic: { select: { id: true, slug: true, title: true } },
      },
    });
  }
}
