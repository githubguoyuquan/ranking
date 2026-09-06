/** One owner per resource: no overlapping requests, hidden-tab pause and error backoff. */
export function startResourcePolling(options: {
  run: (signal: AbortSignal) => Promise<void>;
  delay: () => number;
  visible: () => boolean;
  subscribe: (wake: () => void) => () => void;
}) {
  let stopped = false, active = false, pending = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  async function tick() {
    clear();
    if (stopped || !options.visible()) return;
    if (active) { pending = true; return; }
    active = true;
    controller = new AbortController();
    try { await options.run(controller.signal); failures = 0; }
    catch { if (!controller.signal.aborted) failures = Math.min(failures + 1, 4); }
    finally {
      active = false;
      if (!stopped && options.visible()) {
        const delay = pending ? 0 : Math.min(60000, options.delay() * 2 ** failures);
        pending = false;
        timer = setTimeout(() => void tick(), delay);
      }
    }
  }
  const refresh = () => { clear(); if (active) pending = true; else void tick(); };
  const unsubscribe = options.subscribe(() => {
    if (options.visible()) refresh();
    else { clear(); controller?.abort(); }
  });
  void tick();
  return { refresh, stop: () => { stopped = true; clear(); controller?.abort(); unsubscribe(); } };
}
