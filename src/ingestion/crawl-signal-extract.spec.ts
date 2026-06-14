import { describe, expect, it } from 'vitest';
import { extractSignalsFromCrawlText } from './crawl-signal-extract';

describe('extractSignalsFromCrawlText', () => {
  it('extracts streams and followers from page text', () => {
    const text =
      'Taylor Swift — Monthly listeners: 82.5M · Followers: 120,000 · Mentions: 4.2k';
    const signals = extractSignalsFromCrawlText(text);
    const byKey = Object.fromEntries(signals.map((s) => [s.metricKey, s.value]));
    expect(byKey.streams).toBe(82_500_000);
    expect(byKey.social).toBe(120_000);
    expect(byKey.mentions).toBe(4_200);
  });

  it('returns empty when no patterns match', () => {
    expect(extractSignalsFromCrawlText('plain biography without metrics')).toEqual([]);
  });
});
