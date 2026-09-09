import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TopicEntityAutofillService } from './topic-entity-autofill.service';

const candidate = { externalId: 'Q42', name: 'Candidate A', type: 'PERSON', description: 'public source description', sourceUrl: 'https://www.wikidata.org/wiki/Q42' };
const auth = { tenantId: 7n, tenantSlug: 'seven', apiKeyId: 1n, apiKeyLabel: 'test', scopes: ['admin'] as ['admin'] };

function fixture(overrides: Record<string, unknown> = {}) {
  const record = {
    topicId: 8n, requestedCount: 2, status: 'queued', runToken: 'run-1',
    strategy: null, message: null, updatedAt: new Date('2026-09-08T00:00:00Z'),
    entities: [], topic: { id: 8n, tenantId: 7n, title: '业务对象榜', locale: 'zh-CN' }, ...overrides,
  };
  const tx = {
    topicEntityAutofill: {
      findUnique: vi.fn().mockResolvedValue({ runToken: 'run-1', status: 'running' }),
    },
    entity: { upsert: vi.fn().mockImplementation(async (args) => ({ ...args.create, id: 11n })) },
    outboxEvent: { create: vi.fn() },
  };
  const prisma = {
    topic: { findFirst: vi.fn().mockResolvedValue({ ...record.topic, entityAutofill: record }) },
    topicEntityAutofill: {
      findUnique: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue(record),
    },
    $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)),
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
  const discovery = { discover: vi.fn().mockResolvedValue({ source: 'wikidata', strategy: 'runtime category', entities: [candidate] }) };
  const service = new TopicEntityAutofillService(prisma as never, queue as never, discovery as never, { isEnabled: () => true } as never, { isEnabled: () => false } as never);
  return { record, tx, prisma, queue, discovery, service };
}

describe('topic entity autofill', () => {
  it('saves a sourced, tenant-specific partial selection and indexes it without creating metrics', async () => {
    const { service, tx, prisma, discovery } = fixture();
    await service.process({ topicId: '8', runToken: 'run-1' });
    expect(discovery.discover).toHaveBeenCalledWith({ title: '业务对象榜', locale: 'zh-CN', count: 2 });
    expect(tx.entity.upsert).toHaveBeenCalledWith({
      where: { externalKey: 'wikidata:7:Q42' },
      create: { externalKey: 'wikidata:7:Q42', tenantId: 7n, type: 'PERSON', canonicalName: 'Candidate A' }, update: {},
    });
    expect(prisma.topicEntityAutofill.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'partial', entities: [{ ...candidate, id: '11' }] }),
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it('deduplicates QIDs, rejects unsafe sources, caps quantity and isolates public identities', async () => {
    const { service, tx, prisma, discovery } = fixture({ requestedCount: 1, topic: { id: 8n, tenantId: null, title: '业务对象榜', locale: 'zh-CN' } });
    discovery.discover.mockResolvedValue({ source: 'wikidata', strategy: 'runtime category', entities: [
      { ...candidate, externalId: 'Q17', sourceUrl: 'http://localhost/admin' }, candidate, candidate,
      { ...candidate, externalId: 'Q43', sourceUrl: 'https://www.wikidata.org/wiki/Q43' },
    ] });
    await service.process({ topicId: '8', runToken: 'run-1' });
    expect(tx.entity.upsert).toHaveBeenCalledOnce();
    expect(tx.entity.upsert.mock.calls[0][0].where.externalKey).toBe('wikidata:public:Q42');
    expect(prisma.topicEntityAutofill.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('does not write when a newer retry supersedes a slow source request', async () => {
    const { service, tx, prisma } = fixture();
    tx.topicEntityAutofill.findUnique.mockResolvedValue({ runToken: 'new-run', status: 'running' });
    await service.process({ topicId: '8', runToken: 'run-1' });
    expect(tx.entity.upsert).not.toHaveBeenCalled();
    expect(prisma.topicEntityAutofill.updateMany).toHaveBeenCalledOnce();
  });

  it.each([{ status: 'completed' }, { runToken: 'new-run' }])('ignores duplicate or superseded jobs: %j', async (overrides) => {
    const { service, discovery } = fixture(overrides);
    await service.process({ topicId: '8', runToken: 'run-1' });
    expect(discovery.discover).not.toHaveBeenCalled();
  });

  it('retains prior candidates on failed retry with an actionable message', async () => {
    const { service, prisma, tx, discovery } = fixture({ entities: [{ ...candidate, id: '11' }] });
    discovery.discover.mockRejectedValue(new BadRequestException('请明确对象类别。'));
    await service.process({ topicId: '8', runToken: 'run-1' });
    expect(prisma.topicEntityAutofill.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: 'failed', message: '请明确对象类别。' } }));
    expect(tx.entity.upsert).not.toHaveBeenCalled();
  });

  it('reports a retryable failure if enqueueing fails after creating the topic', async () => {
    const { service, queue, prisma } = fixture();
    queue.add.mockRejectedValue(new Error('redis disconnected'));
    await service.enqueue(8n, 'run-1');
    expect(prisma.topicEntityAutofill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { topicId: 8n, runToken: 'run-1', status: 'queued' }, data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('checks tenant access for reads/retries and does not expose the internal token', async () => {
    const { service, prisma, queue } = fixture();
    expect(await service.get(' business-topic ', auth)).not.toHaveProperty('runToken');
    expect(prisma.topic.findFirst).toHaveBeenCalledWith({ where: { slug: 'business-topic', tenantId: 7n }, include: { entityAutofill: true } });
    await service.retry('business-topic', auth);
    expect(queue.add.mock.calls[0][1].runToken).not.toBe('run-1');
    expect(queue.add.mock.calls[0][1].topicId).toBe('8');
    prisma.topic.findFirst.mockResolvedValue(null);
    await expect(service.retry('other-tenant', auth)).rejects.toThrow(NotFoundException);
    expect(queue.add).toHaveBeenCalledOnce();
  });
});
