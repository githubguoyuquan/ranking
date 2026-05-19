import { describe, expect, it } from 'vitest';
import { redactCanonicalName, parseApiKeyScopes } from './pii-redact';

describe('pii-redact', () => {
  it('redacts HIGH pii for non-admin scopes', () => {
    expect(redactCanonicalName('Taylor Swift', 'HIGH', ['read'])).toBe('T********');
  });

  it('keeps name for admin scope', () => {
    expect(redactCanonicalName('Taylor Swift', 'HIGH', ['admin'])).toBe('Taylor Swift');
  });

  it('parses scopes array', () => {
    expect(parseApiKeyScopes(['read', 'write'])).toEqual(['read', 'write']);
  });
});
