import { describe, expect, it } from 'vitest';
import {
  listKafkaPublishOutboxTypes,
  listKafkaRoutedOutboxTypes,
} from './event-registry';
import { OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED } from '../outbox/outbox.constants';

describe('event-registry', () => {
  it('excludes followup from Kafka publish list', () => {
    const routed = listKafkaRoutedOutboxTypes();
    const publish = listKafkaPublishOutboxTypes();
    expect(routed).toContain(OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED);
    expect(publish).not.toContain(OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED);
    expect(publish.length).toBe(routed.length - 1);
  });
});
