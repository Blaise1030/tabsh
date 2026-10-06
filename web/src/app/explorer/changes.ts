// What the daemon's live updates (GET /api/files/watch) do to the tree. Pure:
// nothing here touches the DOM or the tree library, so `node --test` can load
// it. `view.ts` hands the operations to `FileTree.batch()`.
// One message: paths relative to the root, directories ending in `/` (a
// removed path carries no `/`: its kind went with it), or a reset.
export type Change = { add: string[]; remove: string[] } | { reset: true };

// The subset of the tree's batch operations the page needs.
export type Op = { type: 'add'; path: string } | { type: 'remove'; path: string; recursive?: boolean };

export type Action = { kind: 'reset' } | { kind: 'ops'; ops: Op[] };

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
  if ('reset' in change) return { kind: 'reset' };
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
