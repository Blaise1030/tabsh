// Turning the daemon's listing (GET /api/files/tree) into what the sidebar
// shows. Pure: nothing here touches the DOM, so `node --test` can load it.
import { shellQuote } from '../ui/drop-paths.ts';

// The daemon's answer: paths are relative to `root`, directories end in `/`.
// A root with too many paths comes truncated, with its folders alone when
// those fit (`foldersOnly`).
export interface Listing {
  root: string;
  paths: string[];
  truncated: boolean;
  foldersOnly?: boolean;
}

export type Shown =
  | { kind: 'tree'; paths: string[] }
  | { kind: 'folders'; paths: string[] }
  | { kind: 'empty' }
  | { kind: 'too-many' };

// A truncated listing never carries a partial tree: it shows every folder
// without files, or the sidebar says there are too many.
export function shown(l: Listing): Shown {
  if (l.truncated) return l.foldersOnly && l.paths.length ? { kind: 'folders', paths: l.paths } : { kind: 'too-many' };
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

// The folder's name, for the header above the tree.
export const rootName = (root: string): string => root.replace(/\/+$/, '').split('/').pop() || '/';

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

// Which menu item a key moves to from `at` among `count` items, wrapping at
// the ends; null for a key that doesn't move.
export function menuStep(at: number, count: number, key: string): number | null {
  if (key === 'ArrowDown') return (at + 1) % count;
  if (key === 'ArrowUp') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

// Whether a key press in the tree opens the search: a bare `/`. (The library
// opens it from letters and digits itself; `/` it leaves alone.) Inside the
// open field `/` is just a character.
export const opensSearch = (
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  searchOpen: boolean,
): boolean => e.key === '/' && !searchOpen && !e.ctrlKey && !e.metaKey && !e.altKey;

// What Enter does on the focused search match (`path` as the tree names it:
// a directory ends in `/`): a file opens in the pane, a folder toggles.
export const enterAction = (path: string | null): 'open' | 'toggle' | null =>
  path === null ? null : isDirectory(path) ? 'toggle' : 'open';
