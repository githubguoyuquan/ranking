import { BadRequestException } from '@nestjs/common';
import { TopicKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RankingsService } from './rankings.service';

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
