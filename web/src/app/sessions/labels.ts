// A tab's labels: the repo its shell is in (automatic) and the tags the user
// gives it, and how the strip groups tabs by them. No DOM here.

export interface Labels {
  repo: string | null;
  tags: string[];
}

// The colors a tag can get, picked from its name so a tag keeps its color.
export const TAG_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6'];

// A project root's label: its last path segment.
export function repoName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

export function tagColor(tag: string): string {
  let h = 0;
  for (const c of tag) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// A tag as typed: trimmed and capped, or null when nothing is left.
export function cleanTag(raw: string): string | null {
  const t = raw.trim().slice(0, 24);
  return t || null;
}

// The stored tags (session id → its tags), dropping anything that isn't a
// tag and repeats. A single string (one tag per tab, as first stored) is read
// as a list of one.
export function parseTags(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw)) {
    const list: unknown[] = Array.isArray(value) ? value : [value];
    const tags = [...new Set(list.map((t) => (typeof t === 'string' ? cleanTag(t) : null)))].filter(
      (t): t is string => !!t,
    );
    if (tags.length) out[id] = tags;
  }
  return out;
}

// Whether two tag lists are the same tags in the same order.
export const sameTags = (a: string[], b: string[]): boolean => a.length === b.length && a.every((t, i) => t === b[i]);

// A tab's tags with `tag` added or taken away, in the order they were given.
export function toggleTag(tags: string[], tag: string, on: boolean): string[] {
  const rest = tags.filter((t) => t !== tag);
  return on ? [...rest, tag] : rest;
}

// The bar in front of a tagged tab's name: its tag's color, or the colors of
// its tags stacked in equal parts.
export function tagBar(tags: string[]): string {
  if (tags.length === 1) return tagColor(tags[0]);
  const step = 100 / tags.length;
  const stops = tags.map((t, i) => `${tagColor(t)} ${i * step}% ${(i + 1) * step}%`);
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

// A group of tabs on the strip. `value` is the repo or tag it stands for, or
// null for the tabs without one (no repo known yet, or no tag).
export interface Group {
  key: string;
  kind: 'repo' | 'tag';
  value: string | null;
  ids: string[];
}

export const groupKey = (kind: Group['kind'], value: string | null): string => `${kind}:${value ?? ''}`;

// The strip's groups, in the order their first tab comes in `tabs` (the
// strip's own order); the group of tabs without a label comes last. By tag,
// a tab sits in the group of each of its tags. Not grouping gives no groups.
export function groupTabs(tabs: { id: string; labels: Labels }[], by: 'none' | 'repo' | 'tag'): Group[] {
  if (by === 'none') return [];
  const groups = new Map<string, Group>();
  const rest: Group = { key: groupKey(by, null), kind: by, value: null, ids: [] };
  for (const { id, labels } of tabs) {
    const values = by === 'repo' ? (labels.repo ? [labels.repo] : []) : labels.tags;
    if (!values.length) rest.ids.push(id);
    for (const value of values) {
      const key = groupKey(by, value);
      const g = groups.get(key) ?? { key, kind: by, value, ids: [] };
      g.ids.push(id);
      groups.set(key, g);
    }
  }
  return [...groups.values(), ...(rest.ids.length ? [rest] : [])];
}

// The stored collapsed groups: their keys, dropping anything that isn't one.
export function parseCollapsed(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((k): k is string => typeof k === 'string' && /^(repo|tag):/.test(k)));
}

// What a new tab opened from group `key` needs to land in it: its tag, or
// its repo to start in. The unlabelled group needs nothing.
export function joinGroup(key: string | null): { tag: string | null; repo: string | null } {
  const m = key?.match(/^(repo|tag):(.+)$/);
  return { tag: m?.[1] === 'tag' ? m[2] : null, repo: m?.[1] === 'repo' ? m[2] : null };
}

// A tab's tags once it is dragged from the group of tag `from` into that of
// `to` (null for the untagged group): `to` takes `from`'s place, so the tab
// keeps its other tags and their order.
export function moveTag(tags: string[], from: string | null, to: string | null): string[] {
  const swapped = from && tags.includes(from) ? tags.map((t) => (t === from ? to : t)) : [...tags, to];
  return [...new Set(swapped.filter((t): t is string => !!t))];
}
