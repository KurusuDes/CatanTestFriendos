// Debounced persistence (UI-8). Games used to be written to localStorage on EVERY action, which
// serialises the whole state (board included) synchronously on the main thread. Now a save is
// scheduled: it runs when the browser is idle, at most once per `minMs`, and any pending save is
// flushed right away when the tab is hidden or closed. Clearing (game over) is immediate.

type RIC = (cb: () => void, opts?: { timeout: number }) => number;

export interface Saver<T> {
  /** remember the latest value; it is written later (the value is read at write time, so in-place mutation is fine) */
  schedule(value: T): void;
  /** write the pending value now (tab hidden, page closing, leaving the game) */
  flush(): void;
  /** cancel anything pending and write `null` immediately */
  clear(): void;
  /** stop listening for page lifecycle events (the saver is no longer needed) */
  dispose(): void;
  /** how many times `write` ran (diagnostics / tests) */
  readonly writes: number;
}

const savers = new Set<{ flush(): void }>();
let hooked = false;

function hookLifecycle() {
  if (hooked || typeof document === 'undefined' || typeof window === 'undefined') return;
  hooked = true;
  const flushAll = () => savers.forEach(s => s.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
}

export function createSaver<T>(write: (value: T | null) => void, minMs = 1500): Saver<T> {
  let pending: { v: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = -Infinity;
  let writes = 0;

  const doWrite = (v: T | null) => {
    lastWrite = Date.now();
    writes++;
    write(v);
  };
  const run = () => {
    timer = null;
    if (!pending) return;
    const { v } = pending;
    pending = null;
    doWrite(v);
  };
  const onIdle = () => {
    const ric = (globalThis as { requestIdleCallback?: RIC }).requestIdleCallback;
    if (ric) ric(run, { timeout: 2000 });
    else run();
  };

  const saver: Saver<T> = {
    schedule(value) {
      pending = { v: value };
      if (timer !== null) return;
      timer = setTimeout(onIdle, Math.max(0, lastWrite + minMs - Date.now()));
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (pending) run();
    },
    clear() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      doWrite(null);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      savers.delete(saver);
    },
    get writes() {
      return writes;
    },
  };
  savers.add(saver);
  hookLifecycle();
  return saver;
}
