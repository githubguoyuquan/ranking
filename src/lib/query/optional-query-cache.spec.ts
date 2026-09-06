import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionalQueryCache } from './optional-query-cache';
afterEach(() => vi.useRealTimers());
describe('optional metric cache', () => {
  it('shares concurrent work and retains the in-flight slot after a response timeout', async () => {
    vi.useFakeTimers();
    let resolve!: (n: number) => void;
    const read = vi.fn(() => new Promise<number>(done => { resolve = done; }));
    const cache = new OptionalQueryCache();
    const first = cache.get('metric', read, 1000, 10), second = cache.get('metric', read, 1000, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect((await first).status).toBe('unavailable');
    expect((await second).status).toBe('unavailable');
    const third = cache.get('metric', read, 1000, 10);
    expect(read).toHaveBeenCalledTimes(1);
    resolve(42);
    expect(await third).toMatchObject({ status: 'ok', data: 42 });
    expect(await cache.get('metric', read)).toMatchObject({ status: 'ok', data: 42 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('labels retained data stale when refresh fails', async () => {
    vi.useFakeTimers();
    const cache = new OptionalQueryCache();
    await cache.get('m', async () => 8, 50);
    await vi.advanceTimersByTimeAsync(51);
    expect(await cache.get('m', async () => { throw new Error('offline'); })).toMatchObject({ status: 'stale', data: 8 });
  });
});
