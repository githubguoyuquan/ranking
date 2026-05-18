import { describe, expect, it } from 'vitest';
import { clampCrawlTasksListTake } from './crawl-list-limits';

describe('clampCrawlTasksListTake', () => {
  it('defaults non-finite to 30 then clamps to range', () => {
    expect(clampCrawlTasksListTake(Number.NaN)).toBe(30);
    expect(clampCrawlTasksListTake(Number.POSITIVE_INFINITY)).toBe(30);
  });
  it('clamps to 1–100', () => {
    expect(clampCrawlTasksListTake(0)).toBe(1);
    expect(clampCrawlTasksListTake(-5)).toBe(1);
    expect(clampCrawlTasksListTake(30)).toBe(30);
    expect(clampCrawlTasksListTake(100)).toBe(100);
    expect(clampCrawlTasksListTake(500)).toBe(100);
  });
  it('truncates toward zero', () => {
    expect(clampCrawlTasksListTake(12.7)).toBe(12);
  });
});
