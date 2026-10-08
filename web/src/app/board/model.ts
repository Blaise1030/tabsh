// The board's data, with no DOM: statuses, columns, and the small
// calculations the view needs.

export type Status = 'backlog' | 'in_progress' | 'needs_input' | 'completed' | 'archived';
export const STATUSES: Status[] = ['backlog', 'in_progress', 'needs_input', 'completed', 'archived'];

// The stages a card moves through; the board shows Archived after them.
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
  // Its first prompt while the card waits in Backlog for its drag, and the
  // agent launch template that runs it. Both once it starts.
  prompt: string | null;
  command: string | null;
  // The agent it runs, by command, for its icon.
  agent: string | null;
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
export function foldersOf(items: { card: Card }[]): string[] {
  const sorted = [...items].sort((a, b) => b.card.statusAt - a.card.statusAt);
  return [...new Set(sorted.map((x) => x.card.cwd).filter((c): c is string => !!c))];
}

// The folders offered when making a card: the same list, capped.
export function recentFolders(items: { card: Card }[], limit = 8): string[] {
  return foldersOf(items).slice(0, limit);
}

// What the board is narrowed to. Nothing checked means every card.
export interface BoardFilter {
  tags: string[];
  folders: string[];
}

// A card stays when it is in any checked folder (if a folder is checked) and
// has any checked tag (if a tag is checked).
export function matchesFilter(item: { card: Card; tags: string[] }, filter: BoardFilter): boolean {
  if (filter.folders.length > 0 && !filter.folders.includes(item.card.cwd ?? '')) return false;
  if (filter.tags.length > 0 && !filter.tags.some((t) => item.tags.includes(t))) return false;
  return true;
}

// Tags in use, in the order they first show up.
export function tagsInUse(items: { tags: string[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { tags } of items) {
    for (const tag of tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
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

// The first prompt of the card the board's setup screen opens: the agent
// wires its own hooks by following `tabsh setup`'s guide.
export const SETUP_PROMPT =
  'Run `tabsh setup` and follow the guide it prints, so your hooks keep your card on the tabsh board current.';

// A card's first prompt with its attached images: their saved paths, one per
// line after the prompt, which agents like Claude Code read as images. The
// prompt's first line stays the card's title.
export function withImages(prompt: string, paths: string[]): string {
  return paths.length ? `${prompt}\n\n${paths.join('\n')}` : prompt;
}
