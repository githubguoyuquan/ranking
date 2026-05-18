import { describe, expect, it } from 'vitest';
import { TimeWindow } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED } from '../outbox/outbox.constants';
import { buildKafkaEnvelopeV1 } from './event-registry';
import { buildRankingSnapshotCompletedOutboxPayload } from '../rankings/ranking-snapshot-completed-outbox-payload';

const SCHEMA_DIR = join(__dirname, 'schemas');

describe('Kafka JSON Schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const envelope = ajv.compile(
    JSON.parse(
      readFileSync(join(SCHEMA_DIR, 'event-envelope-v1.schema.json'), 'utf8'),
    ) as object,
  );
  const snapshotPayload = ajv.compile(
    JSON.parse(
      readFileSync(
        join(SCHEMA_DIR, 'ranking-snapshot-completed-payload-v1.schema.json'),
        'utf8',
      ),
    ) as object,
  );

  it('accepts ranking.snapshot.completed wire envelope + payload', () => {
    const payload = buildRankingSnapshotCompletedOutboxPayload({
      snapshotId: 1n,
      topicRankingId: 2n,
      topicVersionId: 3n,
      topicId: 4n,
      topicVersionLabel: 'v1',
      timeWindow: TimeWindow.WEEK,
      snapshotTime: new Date('2026-05-17T00:00:00.000Z'),
      snapshotVersion: '1.WEEK.x',
      itemCount: 3,
      confidenceScore: 0.5,
      scoreModelId: null,
    });
    expect(snapshotPayload(payload)).toBe(true);

    const env = buildKafkaEnvelopeV1({
      type: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
      payload,
      outboxId: 99n,
      createdAt: new Date('2026-05-17T01:00:00.000Z'),
    });
    expect(envelope(env)).toBe(true);
  });
});
