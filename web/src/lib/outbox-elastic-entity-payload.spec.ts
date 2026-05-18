import { describe, expect, it } from "vitest";
import {
  OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
  parseElasticEntitySyncOutboxPreview,
} from "./outbox-elastic-entity-payload";

describe("parseElasticEntitySyncOutboxPreview", () => {
  it("returns undefined for wrong type", () => {
    expect(
      parseElasticEntitySyncOutboxPreview("other", {
        entityId: "1",
        action: "upsert",
      }),
    ).toBeUndefined();
  });

  it("parses entity outbox payload", () => {
    expect(
      parseElasticEntitySyncOutboxPreview(
        OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
        { schemaVersion: 1, entityId: "88", action: "delete" },
      ),
    ).toEqual({ entityId: "88", action: "delete" });
  });
});
