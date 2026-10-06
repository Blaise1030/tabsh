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
