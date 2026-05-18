import { describe, expect, it } from "vitest";
import {
  OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
  parseElasticCrawledUrlSyncOutboxPreview,
} from "./outbox-elastic-crawled-url-payload";

describe("parseElasticCrawledUrlSyncOutboxPreview", () => {
  it("parses crawled-url outbox payload", () => {
    expect(
      parseElasticCrawledUrlSyncOutboxPreview(
        OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
        { schemaVersion: 1, crawledUrlId: "5", action: "upsert" },
      ),
    ).toEqual({ crawledUrlId: "5", action: "upsert" });
  });
});
