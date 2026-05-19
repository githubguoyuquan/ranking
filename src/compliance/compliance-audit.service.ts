import { Injectable } from '@nestjs/common';
import type { ComplianceAuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ComplianceAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(args: {
    action: ComplianceAuditAction;
    actor: string;
    tenantId?: bigint | null;
    resource?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.complianceAuditEvent.create({
      data: {
        action: args.action,
        actor: args.actor.slice(0, 128),
        tenantId: args.tenantId ?? null,
        resource: args.resource?.slice(0, 256) ?? null,
        metadata: args.metadata ?? undefined,
      },
    });
  }

  async listRecent(args: {
    limit?: number;
    tenantId?: bigint;
    action?: ComplianceAuditAction;
  }) {
    const take = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const where: Prisma.ComplianceAuditEventWhereInput = {};
    if (args.tenantId !== undefined) where.tenantId = args.tenantId;
    if (args.action !== undefined) where.action = args.action;
    return this.prisma.complianceAuditEvent.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });
  }
}
