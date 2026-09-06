export type OptionalResult<T> = { status: 'ok' | 'stale' | 'unavailable'; data: T | null; sampledAt: string | null };

/** Shared platform-admin projections only. Never reuse for tenant-scoped or personalized queries. */
export class OptionalQueryCache {
  private entries = new Map<string, { data?: unknown; sampledAt?: string; until: number; running?: Promise<unknown> }>();
  async get<T>(key: string, load: () => Promise<T>, ttlMs = 15000, budgetMs = 1500): Promise<OptionalResult<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 32) {
        const idle = [...this.entries].find(([, e]) => !e.running);
        if (idle) this.entries.delete(idle[0]);
        else return { status: 'unavailable', data: null, sampledAt: null };
      }
      entry = { until: 0 }; this.entries.set(key, entry);
    }
    const current = entry;
    if (current.sampledAt && current.until > Date.now()) return { status: 'ok', data: current.data as T, sampledAt: current.sampledAt };
    if (!current.running) {
      current.running = Promise.resolve().then(load).then(data => {
        current.data = data; current.sampledAt = new Date().toISOString(); current.until = Date.now() + ttlMs;
        return data;
      });
      // A response deadline does not release this slot: avoid multiplying slow backend calls.
      void current.running.then(() => { current.running = undefined; }, () => { current.running = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([current.running as Promise<T>, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('query deadline')), budgetMs);
      })]);
      return { status: 'ok', data, sampledAt: current.sampledAt ?? null };
    } catch {
      return { status: current.sampledAt ? 'stale' : 'unavailable', data: current.sampledAt ? current.data as T : null, sampledAt: current.sampledAt ?? null };
    } finally { if (timer) clearTimeout(timer); }
  }
}
