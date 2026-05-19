import { afterEach, describe, expect, it } from 'vitest';
import { resolveSearchPrimary } from './search-primary';

describe('resolveSearchPrimary', () => {
  const prev = process.env.SEARCH_PRIMARY;

  afterEach(() => {
    if (prev === undefined) delete process.env.SEARCH_PRIMARY;
    else process.env.SEARCH_PRIMARY = prev;
  });

  it('prefers qdrant in auto when enabled', () => {
    delete process.env.SEARCH_PRIMARY;
    expect(
      resolveSearchPrimary({ isEnabled: () => true }, { isEnabled: () => true }),
    ).toBe('qdrant');
  });

  it('falls back to elasticsearch', () => {
    delete process.env.SEARCH_PRIMARY;
    expect(
      resolveSearchPrimary({ isEnabled: () => false }, { isEnabled: () => true }),
    ).toBe('elasticsearch');
  });
});
