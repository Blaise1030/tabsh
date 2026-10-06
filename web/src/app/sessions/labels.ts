// A tab's labels: the repo its shell is in (automatic) and the tags the user
// gives it, and which tabs a label filter keeps. No DOM here.

export interface Labels {
  repo: string | null;
  tags: string[];
}
export interface Filter {
  kind: 'repo' | 'tag';
  value: string;
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

// A filter key, as kept in the set of checked filters.
export const filterKey = (f: Filter): string => `${f.kind}:${f.value}`;

// The filters the tabs offer: their repos, then their tags, each once and
// sorted, with how many tabs carry it.
export function filterOptions(all: Labels[]): { filter: Filter; count: number }[] {
  const counts = new Map<string, { filter: Filter; count: number }>();
  for (const l of all) {
    const own: Filter[] = [];
    if (l.repo) own.push({ kind: 'repo', value: l.repo });
    for (const t of l.tags) own.push({ kind: 'tag', value: t });
    for (const f of own) {
      const k = filterKey(f);
      const o = counts.get(k) ?? { filter: f, count: 0 };
      o.count++;
      counts.set(k, o);
    }
  }
  return [...counts.values()].sort(
    (a, b) => a.filter.kind.localeCompare(b.filter.kind) || a.filter.value.localeCompare(b.filter.value),
  );
}

// Whether a tab shows under the checked filters: nothing checked shows every
// tab, otherwise it needs any one of them.
export function matches(checked: ReadonlySet<string>, labels: Labels): boolean {
  if (!checked.size) return true;
  return (
    (!!labels.repo && checked.has(filterKey({ kind: 'repo', value: labels.repo }))) ||
    labels.tags.some((t) => checked.has(filterKey({ kind: 'tag', value: t })))
  );
}
