import { describe, expect, it } from "vitest";
import { formatTopicRankingStatusSummary } from "./format-topic-ranking-status";

describe("formatTopicRankingStatusSummary", () => {
  it("includes latest snapshot id and hasScoreModel", () => {
    const out = formatTopicRankingStatusSummary(
      JSON.stringify({
        status: "completed",
        snapshots: [{ id: "42", hasScoreModel: true }],
      }),
    );
    expect(out).toContain("DB status=completed");
    expect(out).toContain("latestSnapshotId: 42");
    expect(out).toContain("latestHasScoreModel: yes");
  });

  it("falls back to raw text on invalid JSON", () => {
    expect(formatTopicRankingStatusSummary("not json")).toBe("not json");
  });
});
