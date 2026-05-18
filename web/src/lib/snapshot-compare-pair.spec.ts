import { describe, expect, it } from "vitest";
import { compareIdsFromRankingSnapshots } from "./snapshot-compare-pair";

describe("compareIdsFromRankingSnapshots", () => {
  const cur = "10";

  it("returns single id when snapshots missing or short", () => {
    expect(compareIdsFromRankingSnapshots(cur, undefined)).toEqual([cur]);
    expect(compareIdsFromRankingSnapshots(cur, [])).toEqual([cur]);
    expect(compareIdsFromRankingSnapshots(cur, [{ id: "10" }])).toEqual([cur]);
  });

  it("returns single id when current not in ranking window", () => {
    const snaps = [{ id: "1" }, { id: "2" }];
    expect(compareIdsFromRankingSnapshots(cur, snaps)).toEqual([cur]);
  });

  it("pairs newest with older neighbor (desc list)", () => {
    const snaps = [{ id: "10" }, { id: "9" }];
    expect(compareIdsFromRankingSnapshots("10", snaps)).toEqual(["9", "10"]);
  });

  it("pairs oldest with newer neighbor", () => {
    const snaps = [{ id: "10" }, { id: "9" }];
    expect(compareIdsFromRankingSnapshots("9", snaps)).toEqual(["9", "10"]);
  });

  it("middle prefers older neighbor (previous run vs current)", () => {
    const snaps = [{ id: "12" }, { id: "11" }, { id: "10" }];
    expect(compareIdsFromRankingSnapshots("11", snaps)).toEqual(["10", "11"]);
  });
});
