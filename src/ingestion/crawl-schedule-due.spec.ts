import { describe, expect, it } from 'vitest';
import { isSourceScheduleDue } from './crawl-schedule-due';

describe('isSourceScheduleDue', () => {
  it('fires on interval when never scheduled', () => {
    expect(
      isSourceScheduleDue(
        { scheduleIntervalMinutes: 60, scheduleCron: null, lastScheduledAt: null },
        new Date('2026-05-20T12:00:00Z'),
      ),
    ).toBe(true);
  });

  it('waits until interval elapsed', () => {
    expect(
      isSourceScheduleDue(
        {
          scheduleIntervalMinutes: 60,
          scheduleCron: null,
          lastScheduledAt: new Date('2026-05-20T11:30:00Z'),
        },
        new Date('2026-05-20T12:00:00Z'),
      ),
    ).toBe(false);
  });

  it('matches simple cron minute', () => {
    expect(
      isSourceScheduleDue(
        {
          scheduleIntervalMinutes: null,
          scheduleCron: '0 * * * *',
          lastScheduledAt: null,
        },
        new Date('2026-05-20T14:00:00Z'),
      ),
    ).toBe(true);
  });
});
