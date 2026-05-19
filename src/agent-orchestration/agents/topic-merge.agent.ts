import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecommendationsService } from '../../search/recommendations.service';

@Injectable()
export class TopicMergeAgent {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async run(input: {
    sourceTopicId: string;
    targetTopicId: string;
    dryRun?: boolean;
    mergedBy?: string;
    minSimilarity?: number;
  }): Promise<Record<string, unknown>> {
    const sourceId = BigInt(input.sourceTopicId.trim());
    const targetId = BigInt(input.targetTopicId.trim());
    if (sourceId === targetId) {
      throw new BadRequestException('source and target topic must differ');
    }

    const [source, target] = await Promise.all([
      this.prisma.topic.findUnique({
        where: { id: sourceId },
        include: { _count: { select: { versions: true, sources: true } } },
      }),
      this.prisma.topic.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new NotFoundException('source topic not found');
    if (!target) throw new NotFoundException('target topic not found');

    let similarity = 0;
    try {
      const hits = await this.recommendations.similarTopics(sourceId, 5);
      const hit = hits.find((h) => h.topicId === targetId.toString());
      similarity = hit?.score ?? 0;
    } catch {
      similarity = 0;
    }

    const minSim = input.minSimilarity ?? 0.55;
    const plan = {
      sourceTopicId: sourceId.toString(),
      targetTopicId: targetId.toString(),
      sourceSlug: source.slug,
      targetSlug: target.slug,
      similarity,
      minSimilarity: minSim,
      sourcesToMove: source._count.sources,
      versionsOnSource: source._count.versions,
      wouldPassSimilarity: similarity >= minSim,
    };

    const dryRun = input.dryRun !== false;
    if (dryRun) {
      return { dryRun: true, plan };
    }

    if (similarity < minSim) {
      throw new BadRequestException(
        `similarity ${similarity.toFixed(3)} below threshold ${minSim}`,
      );
    }

    const mergedBy = (input.mergedBy?.trim() || 'admin').slice(0, 128);

    await this.prisma.$transaction(async (tx) => {
      await tx.source.updateMany({
        where: { topicId: sourceId },
        data: { topicId: targetId },
      });
      await tx.topicEmbedding.deleteMany({ where: { topicId: sourceId } });
      await tx.topicFingerprint.deleteMany({ where: { topicId: sourceId } });
      await tx.topic.update({
        where: { id: sourceId },
        data: {
          slug: `__merged_${sourceId}__`,
          title: `[merged → ${target.slug}] ${source.title}`.slice(0, 500),
        },
      });
      await tx.topicMergeAudit.create({
        data: {
          sourceTopicId: sourceId,
          targetTopicId: targetId,
          mergedBy,
          detailJson: plan as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return { dryRun: false, merged: true, plan };
  }
}
