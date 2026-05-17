/** Prisma `TimeWindow`，与 `LeaderboardQueryDto` / `RunRankingDto` 一致 */
export const TIME_WINDOW_VALUES = [
  "REALTIME",
  "DAY",
  "WEEK",
  "MONTH",
  "YEAR",
  "CUSTOM",
] as const;

export type TimeWindowValue = (typeof TIME_WINDOW_VALUES)[number];

export const TIME_WINDOW_SET = new Set<string>(TIME_WINDOW_VALUES);
