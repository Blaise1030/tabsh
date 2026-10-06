// Turning the daemon's listing (GET /api/files/tree) into what the sidebar
// shows. Pure: nothing here touches the DOM, so `node --test` can load it.
import { shellQuote } from '../ui/drop-paths.ts';

// The daemon's answer: paths are relative to `root`, directories end in `/`.
export interface Listing {
  root: string;
  paths: string[];
  truncated: boolean;
}

export type Shown = { kind: 'tree'; paths: string[] } | { kind: 'empty' } | { kind: 'too-many' };

// A truncated listing never carries a partial tree: the sidebar says so
// instead.
export function shown(l: Listing): Shown {
  if (l.truncated) return { kind: 'too-many' };
  if (!l.paths.length) return { kind: 'empty' };
  return { kind: 'tree', paths: l.paths };
}

export const isDirectory = (path: string): boolean => path.endsWith('/');

// The absolute path of a row: the root and the row's relative path, without
// the `/` that marks a directory.
export function absolutePath(root: string, path: string): string {
  const rel = isDirectory(path) ? path.slice(0, -1) : path;
  return `${root.replace(/\/+$/, '')}/${rel}`;
}

// What pasting a row's path at the prompt types.
export const pastedPath = (root: string, path: string): string => shellQuote(absolutePath(root, path));

// What pasting `cd` for a folder row types. `--` keeps a folder named like an
// option from being read as one. It is never submitted: Enter is the user's.
export const cdCommand = (root: string, path: string): string => `cd -- ${pastedPath(root, path)}`;

// Where a tab opened from a row starts: the folder itself, or a file's parent.
export function folderOf(root: string, path: string): string {
  const abs = absolutePath(root, path);
  if (isDirectory(path)) return abs;
  const cut = abs.lastIndexOf('/');
  return cut > 0 ? abs.slice(0, cut) : '/';
}

export type RowAction = 'insert' | 'cd' | 'tab';

// The menu's entries for a row: `cd here` makes sense for folders only.
export const rowActions = (path: string): RowAction[] =>
  isDirectory(path) ? ['insert', 'cd', 'tab'] : ['insert', 'tab'];
