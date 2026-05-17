import { createHash } from 'crypto';
import type { TimeWindow } from '@prisma/client';

export const RANKING_QUEUE = 'ranking';
export const RANKING_JOB_NAME = 'execute';

export type RankingJobPayload = {
  topicRankingId: string;
  topicVersionId: string;
  timeWindow: TimeWindow;
  windowStart: string;
  windowEnd: string;
  asOf?: string;
};

export function buildRankingJobId(p: RankingJobPayload): string {
  const raw = [
    p.topicRankingId,
    p.topicVersionId,
    p.timeWindow,
    p.windowStart,
    p.windowEnd,
    p.asOf ?? '',
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}
