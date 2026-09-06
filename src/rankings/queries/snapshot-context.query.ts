import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertTopicAccessible } from '../../compliance/tenant-scope';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
import { querySection } from '../../lib/query/query-section';
import { toPlainJson } from '../../lib/json';

@Injectable()
export class SnapshotContextQuery {
  constructor(private readonly prisma: PrismaService) {}
  async neighbors(id: bigint, auth?: AuthenticatedRequestContext) {
    const current = await this.prisma.topicRankSnapshot.findUnique({ where: { id }, select: {
      topicRankingId: true, snapshotTime: true, topicRanking: { select: { topicVersion: { select: { topic: { select: { tenantId: true } } } } } },
    } });
    if (!current) throw new NotFoundException('snapshot not found');
    await assertTopicAccessible(current.topicRanking.topicVersion.topic, auth);
    return toPlainJson(await querySection(async () => {
      const [previous, next] = await Promise.all([
        this.prisma.topicRankSnapshot.findFirst({ where: { topicRankingId: current.topicRankingId, OR: [{ snapshotTime: { lt: current.snapshotTime } }, { snapshotTime: current.snapshotTime, id: { lt: id } }] }, orderBy: [{ snapshotTime: 'desc' }, { id: 'desc' }], select: { id: true, snapshotTime: true } }),
        this.prisma.topicRankSnapshot.findFirst({ where: { topicRankingId: current.topicRankingId, OR: [{ snapshotTime: { gt: current.snapshotTime } }, { snapshotTime: current.snapshotTime, id: { gt: id } }] }, orderBy: [{ snapshotTime: 'asc' }, { id: 'asc' }], select: { id: true, snapshotTime: true } }),
      ]);
      return { currentSnapshotId: id, previous, next };
    }));
  }
}
