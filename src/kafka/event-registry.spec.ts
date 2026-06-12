import { describe, expect, it } from 'vitest';
import {
  listFlusherOutboxTypes,
  listKafkaPublishOutboxTypes,
  listKafkaRoutedOutboxTypes,
} from './event-registry';
import { OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED } from '../outbox/outbox.constants';
import { OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED } from '../outbox/outbox.constants';

describe('event-registry', () => {
  it('excludes followup from Kafka publish list', () => {
    const routed = listKafkaRoutedOutboxTypes();
    const publish = listKafkaPublishOutboxTypes();
    expect(routed).toContain(OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED);
    expect(publish).not.toContain(OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED);
    expect(publish.length).toBe(routed.length - 1);
  });

  it('excludes kafka-only snapshot from flusher list', () => {
    const flusher = listFlusherOutboxTypes();
    expect(flusher).not.toContain(OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED);
    expect(flusher.length).toBeGreaterThan(0);
  });
});
