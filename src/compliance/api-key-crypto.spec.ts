import { describe, expect, it } from 'vitest';
import { apiKeyPrefix, generateApiKeyPlaintext, hashApiKey } from './api-key-crypto';

describe('api-key-crypto', () => {
  it('hashes deterministically', () => {
    const h1 = hashApiKey('rk_test');
    const h2 = hashApiKey('rk_test');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('generates rk_ prefixed keys', () => {
    const k = generateApiKeyPlaintext();
    expect(k.startsWith('rk_')).toBe(true);
    expect(apiKeyPrefix(k).length).toBeGreaterThan(0);
  });
});
