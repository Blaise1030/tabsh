// Pure helpers for waking after sleep or a backgrounded browser tab:
// coalesce overlapping syncs, and reconnect sockets one at a time (active
// first) so every tab's scrollback isn't replayed on the main thread at once.

/** Share one in-flight run; if another call arrives mid-flight, run once more. */
export function coalesceAsync(run: () => Promise<void>): () => Promise<void> {
  let inflight: Promise<void> | null = null;
  let again = false;
  return () => {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        again = false;
        await run();
      } while (again);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** Queue `id` once. */
export function enqueueReconnect(queue: string[], id: string): string[] {
  return queue.includes(id) ? queue : [...queue, id];
}

/** Next id to reconnect: the active tab if queued, otherwise FIFO. */
export function nextReconnect(queue: string[], activeId: string | null): { next: string | null; rest: string[] } {
  if (!queue.length) return { next: null, rest: [] };
  const i = activeId != null ? queue.indexOf(activeId) : -1;
  if (i >= 0) {
    return { next: queue[i], rest: [...queue.slice(0, i), ...queue.slice(i + 1)] };
  }
  return { next: queue[0], rest: queue.slice(1) };
}

const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 15_000;

/** Backoff between reconnect attempts for one tab, capped like the explorer. */
export function retryDelay(attempt: number, firstMs = FIRST_RETRY_MS, maxMs = LAST_RETRY_MS): number {
  return Math.min(firstMs * 2 ** Math.max(0, attempt), maxMs);
}

/** Don't open sockets while the page is hidden (laptop lid, other browser tab). */
export function shouldDrainReconnects(documentHidden: boolean): boolean {
  return !documentHidden;
}

/** Whether this tab's terminal is on screen (and should hold a socket). */
export function terminalInView(opts: {
  sessionId: string;
  activeId: string | null;
  view: 'terms' | 'board';
  drawer: boolean;
  documentHidden: boolean;
}): boolean {
  if (opts.documentHidden) return false;
  if (opts.activeId !== opts.sessionId) return false;
  // The board alone hides the workspace; its drawer shows the terminal again.
  if (opts.view === 'board' && !opts.drawer) return false;
  return true;
}
