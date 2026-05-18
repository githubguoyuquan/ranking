import { describe, expect, it } from "vitest";
import {
  OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
  parseRankingFollowupRequestedOutboxPreview,
} from "./outbox-ranking-followup-payload";

describe("parseRankingFollowupRequestedOutboxPreview", () => {
  it("parses followup outbox payload", () => {
    expect(
      parseRankingFollowupRequestedOutboxPreview(
        OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
        {
          schemaVersion: 1,
          snapshotId: "1",
          topicRankingId: "2",
          topicVersionId: "3",
          topicId: "4",
          timeWindow: "DAY",
          snapshotTime: "2026-05-17T12:00:00.000Z",
        },
      ),
    ).toEqual({
      snapshotId: "1",
      topicRankingId: "2",
      topicVersionId: "3",
      topicId: "4",
      timeWindow: "DAY",
      snapshotTime: "2026-05-17T12:00:00.000Z",
    });
  });
});
