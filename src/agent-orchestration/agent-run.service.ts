import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentRunService {
  constructor(private readonly prisma: PrismaService) {}

  async createQueued(args: {
    correlationId: string;
    agent: string;
    inputJson?: Prisma.InputJsonValue;
    snapshotId?: bigint;
    topicId?: bigint;
    proposalId?: bigint;
    parentRunId?: bigint;
  }) {
    return this.prisma.agentRun.create({
      data: {
        correlationId: args.correlationId,
        agent: args.agent.slice(0, 120),
        status: 'queued',
        inputJson: args.inputJson ?? undefined,
        snapshotId: args.snapshotId,
        topicId: args.topicId,
        proposalId: args.proposalId,
        parentRunId: args.parentRunId,
      },
    });
  }

  async markRunning(id: bigint) {
    return this.prisma.agentRun.update({
      where: { id },
      data: { status: 'running', startedAt: new Date(), error: null },
    });
  }

  async markCompleted(id: bigint, outputJson: Prisma.InputJsonValue) {
    return this.prisma.agentRun.update({
      where: { id },
      data: {
        status: 'completed',
        outputJson,
        finishedAt: new Date(),
      },
    });
  }

  async markFailed(id: bigint, error: string) {
    return this.prisma.agentRun.update({
      where: { id },
      data: {
        status: 'failed',
        error: error.slice(0, 16_000),
        finishedAt: new Date(),
      },
    });
  }

  async list(filters?: {
    agent?: string;
    status?: string;
    correlationId?: string;
    limit?: number;
    offset?: number;
  }) {
    const take = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const skip = Math.min(Math.max(filters?.offset ?? 0, 0), 100_000);
    const where: Prisma.AgentRunWhereInput = {};
    if (filters?.agent?.trim()) where.agent = filters.agent.trim().slice(0, 120);
    if (filters?.status?.trim()) where.status = filters.status.trim();
    if (filters?.correlationId?.trim()) {
      where.correlationId = filters.correlationId.trim().slice(0, 64);
    }
    const [total, runs] = await this.prisma.$transaction([
      this.prisma.agentRun.count({ where }),
      this.prisma.agentRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);
    return { total, runs, limit: take, offset: skip };
  }
}
