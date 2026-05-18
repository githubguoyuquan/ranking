/** `OUTBOX_TYPE_ELASTIC_ENTITY_SYNC` 行 `payload`（Flusher 消费） */
export type ElasticEntitySyncAction = 'upsert' | 'delete';

export type ElasticEntitySyncPayload = {
  schemaVersion: 1;
  action: ElasticEntitySyncAction;
  entityId: string;
};

export function buildElasticEntitySyncOutboxPayload(
  entityId: bigint,
  action: ElasticEntitySyncAction,
): ElasticEntitySyncPayload {
  return {
    schemaVersion: 1,
    action,
    entityId: entityId.toString(),
  };
}
