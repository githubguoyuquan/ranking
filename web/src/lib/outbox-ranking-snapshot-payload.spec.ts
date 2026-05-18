import { describe, expect, it } from "vitest";
import {
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
  parseRankingSnapshotCompletedOutboxPreview,
} from "./outbox-ranking-snapshot-payload";

describe("parseRankingSnapshotCompletedOutboxPreview", () => {
  it("returns undefined for other types", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        "elasticsearch.entity.sync",
        { snapshotId: "1" },
      ),
    ).toBeUndefined();
  });

  it("returns undefined when payload is not an object", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        null,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when snapshotId missing", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        { hasScoreModel: true },
      ),
    ).toBeUndefined();
  });

  it("uses explicit hasScoreModel and scoreModelId", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        {
          snapshotId: "10",
          hasScoreModel: true,
          scoreModelId: "99",
        },
      ),
    ).toEqual({
      snapshotId: "10",
      hasScoreModel: true,
      scoreModelId: "99",
    });
  });

  it("infers hasScoreModel from scoreModelId when boolean omitted", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        { snapshotId: "10", scoreModelId: "88" },
      ),
    ).toEqual({
      snapshotId: "10",
      hasScoreModel: true,
      scoreModelId: "88",
    });
  });

  it("treats null scoreModelId as no model", () => {
    expect(
      parseRankingSnapshotCompletedOutboxPreview(
        OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        {
          snapshotId: "10",
          hasScoreModel: false,
          scoreModelId: null,
        },
      ),
    ).toEqual({
      snapshotId: "10",
      hasScoreModel: false,
      scoreModelId: null,
    });
  });
});
