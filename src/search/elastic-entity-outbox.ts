import { OUTBOX_TYPE_ELASTIC_ENTITY_SYNC } from '../outbox/outbox.constants';

export type ElasticEntitySyncAction = 'upsert' | 'delete';

export type ElasticEntitySyncPayload = {
  schemaVersion: 1;
  action: ElasticEntitySyncAction;
  entityId: string;
};

/** 与 `Entity` 写操作放在同一 PG 事务内的 Outbox 行 */
export function elasticEntitySyncOutboxCreate(entityId: bigint, action: ElasticEntitySyncAction) {
  return {
    type: OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
    payload: {
      schemaVersion: 1 as const,
      action,
      entityId: entityId.toString(),
    } satisfies ElasticEntitySyncPayload,
  };
}
