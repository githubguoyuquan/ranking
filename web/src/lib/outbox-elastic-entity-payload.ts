/** 与 Nest `OUTBOX_TYPE_ELASTIC_ENTITY_SYNC` 一致 */
export const OUTBOX_TYPE_ELASTIC_ENTITY_SYNC =
  "elasticsearch.entity.sync" as const;

export type ElasticEntitySyncOutboxPreview = {
  entityId: string;
  action: "upsert" | "delete";
};

function isAction(v: unknown): v is "upsert" | "delete" {
  return v === "upsert" || v === "delete";
}

export function parseElasticEntitySyncOutboxPreview(
  type: string,
  payload: unknown,
): ElasticEntitySyncOutboxPreview | undefined {
  if (type !== OUTBOX_TYPE_ELASTIC_ENTITY_SYNC) return undefined;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.entityId == null || !isAction(p.action)) return undefined;
  return {
    entityId: String(p.entityId),
    action: p.action,
  };
}
