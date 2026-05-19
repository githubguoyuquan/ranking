import { describe, expect, it } from 'vitest';
import { qdrantPointIdFromBigint } from './qdrant-point-id';

describe('qdrantPointIdFromBigint', () => {
  it('is stable and uuid-shaped', () => {
    const a = qdrantPointIdFromBigint(42n);
    const b = qdrantPointIdFromBigint(42n);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
