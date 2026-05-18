import { describe, expect, it } from 'vitest';
import { buildRankingFollowupJobId } from './ranking-followup-job';

describe('ranking-followup-job', () => {
  it('buildRankingFollowupJobId is stable per snapshotId', () => {
    expect(buildRankingFollowupJobId('42')).toBe('ranking-followup:42');
    expect(buildRankingFollowupJobId('42')).toBe(buildRankingFollowupJobId('42'));
  });
});
