import { OUTBOX_TYPE_ELASTIC_ENTITY_SYNC } from '../outbox/outbox.constants';
import {
  buildElasticEntitySyncOutboxPayload,
  type ElasticEntitySyncAction,
} from './elastic-entity-sync-outbox-payload';

export type {
  ElasticEntitySyncAction,
  ElasticEntitySyncPayload,
} from './elastic-entity-sync-outbox-payload';

/** 与 `Entity` 写操作放在同一 PG 事务内的 Outbox 行 */
export function elasticEntitySyncOutboxCreate(
  entityId: bigint,
  action: ElasticEntitySyncAction,
) {
  return {
    type: OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
    payload: buildElasticEntitySyncOutboxPayload(entityId, action),
  };
}
