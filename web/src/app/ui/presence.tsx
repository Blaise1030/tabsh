import { createComputed, createSignal, For, type JSX, untrack } from 'solid-js';
import { mergePresence } from './presence.ts';

// Renders `each` by key; an item that leaves stays where it was until its
// `exit` settles. A key back before then stays, and that exit is ignored.
export function Presence<T>(props: {
  each: T[];
  by: (t: T) => string;
  exit: (item: T) => Promise<void>;
  children: (item: T) => JSX.Element;
}): JSX.Element {
  const [items, setItems] = createSignal<T[]>([]);
  // Each leaving key's current exit, so a stale one can't drop a key that left again.
  const leaving = new Map<string, object>();
  // A computed, not an effect: the rows must match `each` before any render
  // effect (a parent's onMount included) looks at them. Only `each` is tracked.
  createComputed(() => {
    const next = props.each;
    untrack(() => {
      const by = props.by;
      const live = new Set(next.map(by));
      for (const k of leaving.keys()) if (live.has(k)) leaving.delete(k);
      const merged = mergePresence(items(), next, by);
      for (const item of merged) {
        const k = by(item);
        if (live.has(k) || leaving.has(k)) continue;
        const token = {};
        leaving.set(k, token);
        props.exit(item).then(() => {
          if (leaving.get(k) !== token) return;
          leaving.delete(k);
          setItems((list) => list.filter((t) => by(t) !== k));
        });
      }
      setItems(merged);
    });
  });
  return <For each={items()}>{(item) => props.children(item)}</For>;
}
