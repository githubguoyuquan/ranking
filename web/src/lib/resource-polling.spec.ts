import { afterEach, describe, expect, it, vi } from 'vitest';
import { startResourcePolling } from './resource-polling';
afterEach(() => vi.useRealTimers());
describe('resource polling', () => {
  it('never overlaps, coalesces refreshes and aborts on hidden/unmount', async () => {
    vi.useFakeTimers();
    let visible = true, wake = () => {}, done = () => {};
    const signals: AbortSignal[] = [];
    const run = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<void>(resolve => { done = resolve; }); });
    const unsubscribe = vi.fn();
    const poll = startResourcePolling({ run, delay: () => 100, visible: () => visible, subscribe: fn => { wake = fn; return unsubscribe; } });
    poll.refresh(); poll.refresh();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
    done(); await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    visible = false; wake(); expect(signals[1].aborted).toBe(true);
    done(); await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    visible = true; wake(); expect(run).toHaveBeenCalledTimes(3);
    poll.stop(); expect(signals[2].aborted).toBe(true); expect(unsubscribe).toHaveBeenCalledOnce();
    done(); await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('backs off failures and returns to normal cadence after recovery', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const poll = startResourcePolling({ run, delay: () => 100, visible: () => true, subscribe: () => () => {} });
    await vi.advanceTimersByTimeAsync(199); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100); expect(run).toHaveBeenCalledTimes(3);
    poll.stop();
  });
});
