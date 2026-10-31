// What the palette's search shows: its `>` prefix, which rows match, and the
// order its Sessions group lists cards in. Pure, for `node --test`.

// How many sessions an empty search lists, the most recent first.
export const RECENT_SESSIONS = 5;
// How many visited sessions are remembered.
const MAX_VISITS = 100;

export interface Query {
  // A leading `>`: only sessions, matched by title.
  sessionsOnly: boolean;
  term: string;
}

// `prefix` is false on pages without sessions, where `>` is just text.
export function parseQuery(raw: string, prefix = true): Query {
  const s = raw.trim().toLowerCase();
  if (prefix && s.startsWith('>')) return { sessionsOnly: true, term: s.slice(1).trim() };
  return { sessionsOnly: false, term: s };
}

// A setting or command: its label, or any one keyword, holds the term, as in
// Basecoat's own filter.
export function itemMatches(item: { label: string; keywords: string }, q: Query): boolean {
  if (q.sessionsOnly) return false;
  if (item.label.toLowerCase().includes(q.term)) return true;
  return item.keywords
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((k) => k.includes(q.term));
}

// A session, `rank` places in `recentFirst`'s order. An empty search lists
// the most recent few, a lone `>` all of them; otherwise its title holds the
// term, or (without `>`) its folder's name or its note does.
export function sessionMatches(
  s: { title: string; cwd: string | null; note: string | null; rank: number },
  q: Query,
): boolean {
  if (!q.term) return q.sessionsOnly || s.rank < RECENT_SESSIONS;
  if (s.title.toLowerCase().includes(q.term)) return true;
  if (q.sessionsOnly) return false;
  const folder = s.cwd?.split('/').filter(Boolean).pop() ?? '';
  return folder.toLowerCase().includes(q.term) || !!s.note?.toLowerCase().includes(q.term);
}

// Sessions visited in this page, latest first, then the rest by their latest
// status change; the one on screen after those (Enter on an empty search goes
// back to the one before), and archived cards last.
export function recentFirst<T extends { id: string; statusAt: number; archived: boolean }>(
  cards: T[],
  visits: string[],
  activeId: string | null,
): T[] {
  const seen = new Map(visits.map((id, i) => [id, i]));
  const key = (c: T): [number, number] => {
    const tier = c.archived ? 3 : c.id === activeId ? 2 : seen.has(c.id) ? 0 : 1;
    return [tier, tier === 0 ? (seen.get(c.id) as number) : -c.statusAt];
  };
  return [...cards].sort((a, b) => {
    const [ta, va] = key(a);
    const [tb, vb] = key(b);
    return ta - tb || va - vb;
  });
}

// The visits after going to `id`: it moves to the front.
export function visit(visits: string[], id: string): string[] {
  return [id, ...visits.filter((v) => v !== id)].slice(0, MAX_VISITS);
}
