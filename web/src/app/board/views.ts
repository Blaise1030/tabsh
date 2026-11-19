// The board's saved views and its current filter, with no DOM. A view is a
// named query; views live in this browser, as tags do.

import { migrateFilter } from './query.ts';

export interface View {
  id: string;
  name: string;
  query: string;
}

// The filter on the board: its query, and the view it came from (if any).
export interface Current {
  query: string;
  viewId: string | null;
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

// The current filter read back. The old `{ tags, folders }` filter becomes
// the query that means the same, with no view.
export function parseCurrent(raw: unknown): Current {
  const o = record(raw);
  if (!o) return { query: '', viewId: null };
  if (typeof o.query === 'string') {
    return { query: o.query, viewId: typeof o.viewId === 'string' ? o.viewId : null };
  }
  return { query: migrateFilter(o), viewId: null };
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
