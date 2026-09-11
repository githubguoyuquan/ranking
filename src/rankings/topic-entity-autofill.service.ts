import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, type TopicEntityAutofill } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequestContext } from '../compliance/compliance-auth.types';
import { topicWhereForAuth } from '../compliance/tenant-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantSearchService } from '../search/qdrant-search.service';
import { elasticEntitySyncOutboxCreate } from '../search/elastic-entity-outbox';
import { TopicEntityDiscoveryService } from './topic-entity-discovery.service';
import { TOPIC_ENTITY_AUTOFILL_JOB, TOPIC_ENTITY_AUTOFILL_QUEUE, topicEntityAutofillJobId, type TopicEntityAutofillJob } from './topic-entity-autofill-job';

export function publicEntityAutofill(row: TopicEntityAutofill | null) {
  if (!row) return null;
  return {
    requestedCount: row.requestedCount,
    status: row.status,
    strategy: row.strategy,
    message: row.message,
    updatedAt: row.updatedAt.toISOString(),
    entities: row.entities,
  };
}

@Injectable()
export class TopicEntityAutofillService {
  private readonly logger = new Logger(TopicEntityAutofillService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TOPIC_ENTITY_AUTOFILL_QUEUE) private readonly queue: Queue<TopicEntityAutofillJob>,
    private readonly discovery: TopicEntityDiscoveryService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
  ) {}

  async enqueue(topicId: bigint, runToken: string) {
    const payload = { topicId: topicId.toString(), runToken };
    try {
      await this.queue.add(TOPIC_ENTITY_AUTOFILL_JOB, payload, {
        jobId: topicEntityAutofillJobId(payload),
        attempts: 1,
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 604_800, count: 500 },
      });
    } catch (error) {
      this.logger.warn(`Could not enqueue entity autofill for topic ${topicId}: ${error instanceof Error ? error.message : 'queue unavailable'}`);
      await this.prisma.topicEntityAutofill.updateMany({
        where: { topicId, runToken, status: 'queued' },
        data: { status: 'failed', message: '话题已创建，但后台任务未能启动。请稍后在本话题点击“重试自动填充”。' },
      });
    }
    return publicEntityAutofill(await this.prisma.topicEntityAutofill.findUnique({ where: { topicId } }));
  }

  private async findTopic(slug: string, auth?: AuthenticatedRequestContext) {
    const topic = await this.prisma.topic.findFirst({
      where: { slug: slug.trim(), ...topicWhereForAuth(auth) },
      include: { entityAutofill: true },
    });
    if (!topic) throw new NotFoundException('话题不存在或无权访问。');
    return topic;
  }

  async get(slug: string, auth?: AuthenticatedRequestContext) {
    return publicEntityAutofill((await this.findTopic(slug, auth)).entityAutofill);
  }

  async retry(slug: string, auth?: AuthenticatedRequestContext) {
    const topic = await this.findTopic(slug, auth);
    if (!topic.entityAutofill) {
      throw new BadRequestException('该话题创建时未指定自动填充数量，请使用已有的手工实体选择方式。');
    }
    // A new token invalidates old jobs, including jobs still fetching a slow source.
    const runToken = randomUUID();
    await this.prisma.topicEntityAutofill.update({
      where: { topicId: topic.id },
      data: { runToken, status: 'queued', message: null, startedAt: null },
    });
    return this.enqueue(topic.id, runToken);
  }

  async process(payload: TopicEntityAutofillJob) {
    if (!/^\d+$/.test(payload.topicId)) return;
    const topicId = BigInt(payload.topicId);
    const record = await this.prisma.topicEntityAutofill.findUnique({
      where: { topicId }, include: { topic: true },
    });
    if (!record || record.runToken !== payload.runToken || !['queued', 'running'].includes(record.status)) return;
    const activeWhere = { topicId, runToken: payload.runToken, status: { in: ['queued', 'running'] } };
    const claim = await this.prisma.topicEntityAutofill.updateMany({
      where: activeWhere, data: { status: 'running', startedAt: new Date(), message: null },
    });
    if (claim.count === 0) return;

    try {
      const result = await this.discovery.discover({
        title: record.topic.entityScope ?? record.topic.title,
        locale: record.topic.locale, count: record.requestedCount,
      });
      // Defense at the persistence boundary: only actual Wikidata identities with
      // a canonical source URL may be saved; never pad a short result.
      const seen = new Set<string>();
      const candidates = result.entities.filter((entity) => {
        if (!/^Q[1-9]\d*$/.test(entity.externalId) || !entity.name.trim() ||
            entity.sourceUrl !== `https://www.wikidata.org/wiki/${entity.externalId}` || seen.has(entity.externalId)) return false;
        seen.add(entity.externalId);
        return true;
      }).slice(0, record.requestedCount);
      if (!candidates.length) throw new BadRequestException('公开来源没有找到符合这个话题的实体。请将话题名称写得更明确后重试。');

      const status = candidates.length === record.requestedCount ? 'completed' : 'partial';
      const message = [
        status === 'partial' ? `计划 ${record.requestedCount} 个，目前仅找到 ${candidates.length} 个有来源的实体，可重试或使用已有结果。` : null,
        result.warning,
        '候选顺序不代表榜单名次；尚未自动采集排名指标。',
      ].filter(Boolean).join(' ');
      const entities = [];
      // Persist in bounded transactions so a large operator-requested roster does
      // not make one database transaction grow with the requested count.
      for (let start = 0; start < candidates.length; start += 100) {
        const chunk = candidates.slice(start, start + 100);
        const saved = await this.prisma.$transaction(async (tx) => {
          const current = await tx.topicEntityAutofill.findUnique({
            where: { topicId }, select: { runToken: true, status: true },
          });
          if (current?.runToken !== payload.runToken || current.status !== 'running') return null;
          const rows = [];
          for (const candidate of chunk) {
            const externalKey = `wikidata:${record.topic.tenantId?.toString() ?? 'public'}:${candidate.externalId}`;
            const entity = await tx.entity.upsert({
              where: { externalKey },
              create: {
                externalKey, tenantId: record.topic.tenantId,
                type: candidate.type, canonicalName: candidate.name,
              },
              update: {}, // Keep any operator edits to an existing entity.
            });
            if (entity.tenantId !== record.topic.tenantId) throw new Error('Entity source identity tenant mismatch');
            rows.push({ ...candidate, id: entity.id.toString(), name: entity.canonicalName });
            if (this.elastic.isEnabled() || this.qdrant.isEnabled()) {
              await tx.outboxEvent.create({ data: elasticEntitySyncOutboxCreate(entity.id, 'upsert') });
            }
          }
          return rows;
        }, { timeout: 20_000 });
        if (!saved) return;
        entities.push(...saved);
      }
      await this.prisma.topicEntityAutofill.updateMany({
        where: { topicId, runToken: payload.runToken, status: 'running' },
        data: {
          status,
          strategy: result.strategy,
          message,
          entities: entities as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Keep prior successful candidates on a failed retry, with a visible failure.
      this.logger.warn(`Entity autofill failed for topic ${topicId}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      const message = error instanceof BadRequestException
        ? error.message.slice(0, 600)
        : '实体来源暂时无法访问或保存失败，请稍后重试。话题已经保存，无需重复创建。';
      await this.prisma.topicEntityAutofill.updateMany({
        where: activeWhere, data: { status: 'failed', message },
      });
    }
  }
}
