/** 与 Nest `OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC` 一致 */
export const OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC =
  "elasticsearch.crawled_url.sync" as const;

export type ElasticCrawledUrlSyncOutboxPreview = {
  crawledUrlId: string;
  action: "upsert" | "delete";
};

function isAction(v: unknown): v is "upsert" | "delete" {
  return v === "upsert" || v === "delete";
}

export function parseElasticCrawledUrlSyncOutboxPreview(
  type: string,
  payload: unknown,
): ElasticCrawledUrlSyncOutboxPreview | undefined {
  if (type !== OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC) return undefined;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.crawledUrlId == null || !isAction(p.action)) return undefined;
  return {
    crawledUrlId: String(p.crawledUrlId),
    action: p.action,
  };
}
