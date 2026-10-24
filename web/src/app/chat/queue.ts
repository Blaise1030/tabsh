// Queued composer lines that have not been POSTed yet. Kept per UI card in
// this browser so a refresh (or a tab switch) does not drop them.
const QUEUE_KEY = 'tabsh.chat.queue';

/** Pure: only string entries from a stored value. */
export function parseQueued(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export function loadQueue(sessionId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '{}');
    if (!v || typeof v !== 'object') return [];
    return parseQueued((v as Record<string, unknown>)[sessionId]);
  } catch {
    return [];
  }
}

export function saveQueue(sessionId: string, queue: string[]): void {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '{}');
    const all: Record<string, unknown> = v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {};
    if (!queue.length) delete all[sessionId];
    else all[sessionId] = queue;
    if (!Object.keys(all).length) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(all));
  } catch {
    // Quota or private mode: the in-memory queue still works for this page.
  }
}
