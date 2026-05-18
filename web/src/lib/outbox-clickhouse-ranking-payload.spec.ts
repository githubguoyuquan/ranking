import { describe, expect, it } from "vitest";
import {
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  parseClickhouseRankingSnapshotOutboxPreview,
} from "./outbox-clickhouse-ranking-payload";

describe("parseClickhouseRankingSnapshotOutboxPreview", () => {
  it("returns undefined for other types", () => {
    expect(
      parseClickhouseRankingSnapshotOutboxPreview("ranking.snapshot.completed", {
        snapshotId: "1",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when snapshotId missing", () => {
    expect(
      parseClickhouseRankingSnapshotOutboxPreview(
        OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
        { schemaVersion: 1 },
      ),
    ).toBeUndefined();
  });

  it("parses snapshotId", () => {
    expect(
      parseClickhouseRankingSnapshotOutboxPreview(
        OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
        { schemaVersion: 1, snapshotId: "42" },
      ),
    ).toEqual({ snapshotId: "42" });
  });
});
