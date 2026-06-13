import { describe, expect, it } from 'vitest';
import { parseRelativeOrIsoTime, parseSearchDsl } from './search-dsl';

describe('search-dsl', () => {
  const now = new Date('2026-06-12T12:00:00.000Z');

  it('strips inline filters and keeps free text', () => {
    const r = parseSearchDsl('type:PERSON since:7d taylor swift', {}, now);
    expect(r.text).toBe('taylor swift');
    expect(r.filters.type).toBe('PERSON');
    expect(r.filters.since?.toISOString()).toBe('2026-06-05T12:00:00.000Z');
  });

  it('explicit params override inline', () => {
    const r = parseSearchDsl('type:PERSON', { type: 'ORG' }, now);
    expect(r.filters.type).toBe('ORG');
  });

  it('parseRelativeOrIsoTime supports hours', () => {
    const d = parseRelativeOrIsoTime('24h', now);
    expect(d?.toISOString()).toBe('2026-06-11T12:00:00.000Z');
  });
});
