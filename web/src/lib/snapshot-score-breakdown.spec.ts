import { describe, expect, it } from "vitest";
import { parseScoreBreakdownEntries } from "./snapshot-score-breakdown";

describe("parseScoreBreakdownEntries", () => {
  it("returns sorted numeric entries", () => {
    expect(
      parseScoreBreakdownEntries({ streams: 0.2, mentions: 0.5, bad: "x" }),
    ).toEqual([
      { key: "mentions", value: 0.5 },
      { key: "streams", value: 0.2 },
    ]);
  });

  it("handles empty or invalid", () => {
    expect(parseScoreBreakdownEntries(null)).toEqual([]);
    expect(parseScoreBreakdownEntries([])).toEqual([]);
    expect(parseScoreBreakdownEntries({})).toEqual([]);
  });
});
