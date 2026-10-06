// The board's data, with no DOM: statuses, columns, and the small
// calculations the view needs.

export type Status = 'backlog' | 'in_progress' | 'needs_input' | 'completed' | 'archived';
export const STATUSES: Status[] = ['backlog', 'in_progress', 'needs_input', 'completed', 'archived'];

// The board's columns; Archive is a collapsed extra at the end.
export const COLUMNS: { status: Status; name: string }[] = [
  { status: 'backlog', name: 'Backlog' },
  { status: 'in_progress', name: 'In progress' },
  { status: 'needs_input', name: 'Needs input' },
  { status: 'completed', name: 'Completed' },
];

export interface Card {
  status: Status;
  statusAt: number; // unix seconds
  note: string | null;
  cwd: string | null;
}

export const asStatus = (v: unknown): Status => (STATUSES.includes(v as Status) ? (v as Status) : 'backlog');

// Items by status, each list in the order given (the tab order).
export function group<T extends { card: Card }>(items: T[]): Record<Status, T[]> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, [] as T[]])) as Record<Status, T[]>;
  for (const x of items) out[x.card.status].push(x);
  return out;
}

// How long a card has been in its status: now, 5m, 3h, 2d.
export function since(statusAt: number, nowSec: number): string {
  const s = Math.max(0, nowSec - statusAt);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// A folder with the home directory written as ~.
export function shortPath(p: string | null): string {
  if (!p) return '';
  return p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~');
}

// The folders cards are in, most recently moved card first, without repeats.
export function recentFolders(items: { card: Card }[], limit = 8): string[] {
  const sorted = [...items].sort((a, b) => b.card.statusAt - a.card.statusAt);
  return [...new Set(sorted.map((x) => x.card.cwd).filter((c): c is string => !!c))].slice(0, limit);
}

// The whole tab order after dropping `movedId` into `status`'s column:
// before `beforeId`, or after that column's last card (at the very end when
// the column is empty).
export function dropOrder(
  items: { id: string; card: Card }[],
  movedId: string,
  status: Status,
  beforeId: string | null,
): string[] {
  const rest = items.filter((x) => x.id !== movedId);
  let at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
  if (at < 0) {
    const last = rest.map((x) => x.card.status).lastIndexOf(status);
    at = last < 0 ? rest.length : last + 1;
  }
  const ids = rest.map((x) => x.id);
  ids.splice(at, 0, movedId);
  return ids;
}

export const DEFAULT_COMMAND = 'claude {prompt}';

// The agent commands offered in New card: the one just used first.
export function rememberCommand(list: string[], command: string): string[] {
  const c = command.trim();
  if (!c) return list;
  return [c, ...list.filter((x) => x !== c)].slice(0, 8);
}
