import { describe, expect, it } from 'vitest';
import { extractPageTitle } from './http-fetch';

describe('extractPageTitle', () => {
  it('reads first HTML title', () => {
    const html = Buffer.from(
      '<!doctype html><html><head><title>Hello &amp; World</title></head><body></body></html>',
      'utf8',
    );
    expect(extractPageTitle('text/html', html)).toBe('Hello & World');
  });

  it('returns null for JSON', () => {
    const buf = Buffer.from('{"title":"x"}', 'utf8');
    expect(extractPageTitle('application/json', buf)).toBeNull();
  });

  it('returns null when no title tag', () => {
    const buf = Buffer.from('<html><body>hi</body></html>', 'utf8');
    expect(extractPageTitle('text/html', buf)).toBeNull();
  });
});
