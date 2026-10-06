// What the daemon's live updates (GET /api/files/watch) do to the tree. Pure:
// nothing here touches the DOM or the tree library, so `node --test` can load
// it. `view.ts` hands the operations to `FileTree.batch()`.
// One message: paths relative to the root, directories ending in `/` (a
// removed path carries no `/`: its kind went with it), a reset, or the news
// that the tab's project root is now another one.
export type Change = { add: string[]; remove: string[] } | { reset: true } | { root: string };

// The subset of the tree's batch operations the page needs.
export type Op = { type: 'add'; path: string } | { type: 'remove'; path: string; recursive?: boolean };

export type Action = { kind: 'reset' } | { kind: 'ignore' } | { kind: 'ops'; ops: Op[] };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((p) => typeof p === 'string');

export function parseChange(text: string): Change | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  if (m.reset === true) return { reset: true };
  if (typeof m.root === 'string' && m.root) return { root: m.root };
  if (m.add === undefined && m.remove === undefined) return null;
  const add = m.add ?? [];
  const remove = m.remove ?? [];
  return isStrings(add) && isStrings(remove) ? { add, remove } : null;
}

const depth = (path: string) => path.split('/').length;

// The operations for a message, against `known`: every path the tree shows.
// `known` is updated to match. Adds of paths already there and removes of
// absent ones are dropped, a removed directory takes its subtree in one
// operation, and parents are added before children (a path sorts after its
// parent).
export function applyChange(known: Set<string>, change: Change): Action {
  if ('reset' in change || 'root' in change) return { kind: 'reset' };
  const ops: Op[] = [];
  for (const path of [...change.remove].sort((a, b) => depth(a) - depth(b))) {
    const dir = `${path}/`;
    if (known.has(dir)) {
      for (const p of known) if (p.startsWith(dir)) known.delete(p);
      known.delete(dir);
      ops.push({ type: 'remove', path: dir, recursive: true });
    } else if (known.delete(path)) {
      ops.push({ type: 'remove', path });
    }
  }
  const add = (path: string) => {
    if (known.has(path)) return;
    known.add(path);
    ops.push({ type: 'add', path });
  };
  for (const path of [...change.add].sort()) {
    // A parent the tree doesn't have yet comes first.
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) add(`${parts.slice(0, i).join('/')}/`);
    add(path);
  }
  return { kind: 'ops', ops };
}

// What the page knows about the tree it shows, as live messages arrive.
// `known` is null with no tree showing; `settling` is true from the news of a
// new root until the listing of it has landed.
export interface Live {
  known: Set<string> | null;
  settling: boolean;
}

// What a live message asks of the page. A new root drops the tree's paths at
// once, and until its listing lands every message is for the old root (or
// redundant with the fetch in flight): ignored, so one `root` is one re-fetch.
export function onMessage(live: Live, change: Change): Action {
  if ('root' in change) {
    live.known = null;
    live.settling = true;
    return { kind: 'reset' };
  }
  if (live.settling) return { kind: 'ignore' };
  if (!live.known) return { kind: 'reset' };
  return applyChange(live.known, change);
}
