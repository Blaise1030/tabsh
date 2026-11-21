// The board's saved views and its current filter, with no DOM. A view is a
// named query; views live in this browser, as tags do.

export interface View {
  id: string;
  name: string;
  query: string;
}

// The filter on the board: the view picked (if any) and its query, and the
// tags and folders ticked, a quick filter of their own on top of it.
export interface Current {
  query: string;
  viewId: string | null;
  tags: string[];
  folders: string[];
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

// Saved views read back: anything malformed is dropped.
export function parseViews(raw: unknown): View[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const o = record(x);
    if (!o || typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.query !== 'string') return [];
    return [{ id: o.id, name: o.name, query: o.query }];
  });
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

// The current filter read back; anything malformed counts as nothing. The old
// filter (`{ tags, folders }`, ticks only) reads back as the same ticks.
export function parseCurrent(raw: unknown): Current {
  const o = record(raw);
  if (!o) return { query: '', viewId: null, tags: [], folders: [] };
  return {
    query: typeof o.query === 'string' ? o.query : '',
    viewId: typeof o.viewId === 'string' ? o.viewId : null,
    tags: strings(o.tags),
    folders: strings(o.folders),
  };
}

// Whether another view already has this name, ignoring case and spaces at
// either end.
export function nameTaken(views: View[], name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return views.some((v) => v.id !== exceptId && v.name.trim().toLowerCase() === n);
}

const usable = (views: View[], name: string, exceptId?: string): boolean =>
  name.trim() !== '' && !nameTaken(views, name, exceptId);

export function addView(views: View[], view: View): View[] {
  if (!usable(views, view.name)) return views;
  return [...views, { ...view, name: view.name.trim() }];
}

export function renameView(views: View[], id: string, name: string): View[] {
  if (!usable(views, name, id)) return views;
  return views.map((v) => (v.id === id ? { ...v, name: name.trim() } : v));
}

export function updateView(views: View[], id: string, query: string): View[] {
  return views.map((v) => (v.id === id ? { ...v, query } : v));
}

export function deleteView(views: View[], id: string): View[] {
  return views.filter((v) => v.id !== id);
}

// A new view's id: 32 hex digits. `crypto.randomUUID` exists only on secure
// pages, and another device opens tabsh over plain HTTP.
export function newViewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
