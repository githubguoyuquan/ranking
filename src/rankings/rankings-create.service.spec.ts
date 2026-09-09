import { BadRequestException } from '@nestjs/common';
import { TopicKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RankingsService } from './rankings.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTopicAdminDto } from './rankings.controller';

function makeService(prisma: Record<string, unknown>): RankingsService {
  return new RankingsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('RankingsService admin topic creation', () => {
  it.each([0, -1, 1.5, true, '10'])('rejects invalid entityCount %j at the API boundary', async (entityCount) => {
    const dto = plainToInstance(CreateTopicAdminDto, {
      slug: 'runtime-topic', title: '运行时业务对象榜', kind: 'SEMI_OBJECTIVE', entityCount,
    }, { enableImplicitConversion: true });
    expect((await validate(dto)).some((error) => error.property === 'entityCount')).toBe(true);
  });

  it.each([51, 1_000, 100_000])('accepts entityCount %i without a business upper limit', async (entityCount) => {
    const dto = plainToInstance(CreateTopicAdminDto, {
      slug: 'runtime-topic', title: '运行时业务对象榜', kind: 'SEMI_OBJECTIVE', entityCount,
    }, { enableImplicitConversion: true });
    expect((await validate(dto)).some((error) => error.property === 'entityCount')).toBe(false);
  });

  it('persists requested count with the topic before enqueueing', async () => {
    const create = vi.fn().mockResolvedValue({ id: 11n, kind: TopicKind.SEMI_OBJECTIVE });
    const enqueue = vi.fn().mockResolvedValue({ status: 'queued', requestedCount: 5, entities: [] });
    const service = new RankingsService(
      { topic: { create } } as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      undefined, undefined, { enqueue } as never,
    );
    const result = await service.createTopic({ slug: 'runtime-topic', title: '运行时业务对象榜', kind: TopicKind.SEMI_OBJECTIVE, entityCount: 5 });
    const population = create.mock.calls[0][0].data.entityAutofill.create;
    expect(population.requestedCount).toBe(5);
    expect(enqueue).toHaveBeenCalledWith(11n, population.runToken);
    expect(result).toMatchObject({ id: '11', entityAutofill: { requestedCount: 5 } });
  });

  it('creates a topic in the authenticated tenant', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 11n,
      tenantId: 7n,
      slug: 'ai-tools',
      title: 'AI Tools',
      kind: TopicKind.SEMI_OBJECTIVE,
      locale: 'zh-CN',
    });
    const service = makeService({ topic: { create } });

    const result = await service.createTopic(
      {
        slug: ' ai-tools ',
        title: ' AI Tools ',
        kind: TopicKind.SEMI_OBJECTIVE,
        locale: ' zh-CN ',
      },
      {
        tenantId: 7n,
        tenantSlug: 'tenant-7',
        apiKeyId: 70n,
        apiKeyLabel: 'test',
        scopes: ['admin'],
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        slug: 'ai-tools',
        title: 'AI Tools',
        kind: TopicKind.SEMI_OBJECTIVE,
        locale: 'zh-CN',
        tenant: { connect: { id: 7n } },
      },
    });
    expect(result).toMatchObject({ id: '11', slug: 'ai-tools' });
  });

  it('persists the runtime metric plan instead of assigning fixed topic-kind metrics', async () => {
    const metricPlan = {
      generatedBy: 'openai' as const,
      rationale: '按运行时话题生成。',
      metrics: [
        {
          key: 'result_quality', label: '结果质量', description: '结果质量。',
          normalizationGuide: '同批换算为 0–100。', sourceHints: ['公开记录'],
          weight: 0.7, required: true,
        },
        {
          key: 'peer_recognition', label: '同行认可', description: '同行认可。',
          normalizationGuide: '同周期换算为 0–100。', sourceHints: ['权威档案'],
          weight: 0.3, required: false,
        },
      ],
    };
    const create = vi.fn().mockResolvedValue({
      id: 12n, slug: 'runtime-topic', title: '运行时业务对象榜',
      kind: TopicKind.SEMI_OBJECTIVE, locale: 'zh-CN',
    });
    const suggest = vi.fn().mockResolvedValue(metricPlan);
    const service = new RankingsService(
      { topic: { create } } as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      undefined, undefined, undefined, { suggest } as never,
    );

    const result = await service.createTopic({
      slug: 'runtime-topic', title: '运行时业务对象榜',
      kind: TopicKind.SEMI_OBJECTIVE, locale: 'zh-CN',
    });

    expect(suggest).toHaveBeenCalledWith({
      title: '运行时业务对象榜', kind: TopicKind.SEMI_OBJECTIVE, locale: 'zh-CN',
    });
    expect(create.mock.calls[0][0].data.metricPlan).toEqual(metricPlan);
    expect(JSON.stringify(create.mock.calls[0][0].data.metricPlan)).not.toContain('streams');
    expect(result).toMatchObject({ id: '12', metricPlan });
  });

  it('creates an unfrozen version only after tenant-scoped entity validation', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 3n,
      tenantId: 7n,
      slug: 'ai-tools',
    });
    const findMany = vi.fn().mockResolvedValue([{ id: 21n }, { id: 22n }]);
    const create = vi.fn().mockResolvedValue({
      id: 31n,
      topicId: 3n,
      version: '2026.09',
      effectiveFrom: new Date('2026-09-07T00:00:00.000Z'),
      effectiveTo: null,
      frozen: false,
      policyJson: {},
    });
    const service = makeService({
      topic: { findFirst },
      entity: { findMany },
      topicVersion: { create },
    });

    const result = await service.createTopicVersion(
      'ai-tools',
      {
        version: ' 2026.09 ',
        effectiveFrom: new Date('2026-09-07T00:00:00.000Z'),
        policyJson: {
          weights: { streams: 0.6, mentions: 0.4 },
          requiredSignalKeys: ['streams'],
          entityIds: ['21', '22'],
        },
      },
      {
        tenantId: 7n,
        tenantSlug: 'tenant-7',
        apiKeyId: 70n,
        apiKeyLabel: 'test',
        scopes: ['admin'],
      },
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: 'ai-tools', tenantId: 7n },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [21n, 22n] }, tenantId: 7n },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topicId: 3n,
        version: '2026.09',
      }),
    });
    expect(result).toMatchObject({ id: '31', version: '2026.09', frozen: false });
  });

  it('rejects versions with missing entities or an invalid date range', async () => {
    const topic = {
      findFirst: vi.fn().mockResolvedValue({
        id: 3n,
        tenantId: null,
        slug: 'ai-tools',
      }),
    };
    const topicVersion = { create: vi.fn() };
    const missingEntityService = makeService({
      topic,
      entity: { findMany: vi.fn().mockResolvedValue([]) },
      topicVersion,
    });

    await expect(
      missingEntityService.createTopicVersion('ai-tools', {
        version: 'v1',
        effectiveFrom: new Date('2026-09-07T00:00:00.000Z'),
        policyJson: { weights: { streams: 1 }, entityIds: ['999'] },
      }),
    ).rejects.toThrow(BadRequestException);

    const invalidRangeService = makeService({
      topic,
      entity: { findMany: vi.fn().mockResolvedValue([{ id: 1n }]) },
      topicVersion,
    });
    await expect(
      invalidRangeService.createTopicVersion('ai-tools', {
        version: 'v2',
        effectiveFrom: new Date('2026-09-08T00:00:00.000Z'),
        effectiveTo: new Date('2026-09-07T00:00:00.000Z'),
        policyJson: { weights: { streams: 1 }, entityIds: ['1'] },
      }),
    ).rejects.toThrow('effectiveTo must be after effectiveFrom');
    expect(topicVersion.create).not.toHaveBeenCalled();
  });
});
