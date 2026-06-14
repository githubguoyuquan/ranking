import type { TimeWindow } from '@prisma/client';

export type RealtimeWindowSemantics = {
  kind: 'sliding';
  slidingMinutes: number;
  timezone: 'UTC';
  description: string;
};

export type ResolvedRealtimeRankingWindow = {
  timeWindow: TimeWindow;
  windowStart: Date;
  windowEnd: Date;
  asOf: Date;
  semantics: RealtimeWindowSemantics;
};

function readSlidingMinutes(): number {
  const raw = Number(process.env.REALTIME_SLIDING_MINUTES ?? '15');
  if (!Number.isFinite(raw)) return 15;
  return Math.min(120, Math.max(5, Math.floor(raw)));
}

/** REALTIME 排行：UTC 滑动窗口（默认近 15 分钟，对齐到分钟边界） */
export function resolveRealtimeRankingWindow(
  now: Date = new Date(),
  opts?: { slidingMinutes?: number },
): ResolvedRealtimeRankingWindow {
  const slidingMinutes = opts?.slidingMinutes ?? readSlidingMinutes();
  const end = new Date(now);
  end.setUTCSeconds(0, 0);
  const start = new Date(end.getTime() - slidingMinutes * 60_000);

  return {
    timeWindow: 'REALTIME',
    windowStart: start,
    windowEnd: end,
    asOf: end,
    semantics: {
      kind: 'sliding',
      slidingMinutes,
      timezone: 'UTC',
      description: `UTC sliding ${slidingMinutes}m window ending at asOf`,
    },
  };
}

export function isRealtimeTimeWindow(tw: TimeWindow | undefined): boolean {
  return tw === 'REALTIME';
}
