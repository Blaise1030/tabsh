// A keyed list: one node per key, kept while the key lives. Pure (no DOM
// access of its own), so its test runs in Node.
import van from 'vanjs-core';

// What keyed() needs of a parent element.
// biome-ignore lint/suspicious/noExplicitAny: nodes and refs are Elements or a test's fakes
export type ParentLike = { insertBefore(node: any, ref: any): unknown; firstElementChild: any };

// Makes a node with `make` in a VanJS binding scope, so the derives made
// for it (its bindings' too) belong to it: VanJS drops them once the node
// has left the page. Made outside a binding, a derive lives for good, and
// keeps whatever it reads (and its closure) alive. `make` runs once: were
// it to read a state directly, the scope would keep the same node.
export function scoped<N extends Element>(make: () => N): N {
  let node: N | undefined;
  // hydrate binds `make` and swaps its result in for the placeholder, which
  // isn't on the page: no DOM is touched.
  // biome-ignore lint/suspicious/noExplicitAny: a placeholder only needs replaceWith
  van.hydrate({ replaceWith() {} } as any, () => {
    node ??= make();
    return node;
  });
  return node as N;
}

// Keeps `parent`'s children in step with `items`: a key's node is made once
// by `render` and moved, never rebuilt. A key that leaves goes to `exit`
// (which may animate) and is removed when that settles; its node's derives
// go with it (`scoped`). `items` is read inside a derive, so it reruns when
// the states it reads change. Call `keyed` once per long-lived parent; the
// parent holds only the list (or trailing extras).
export function keyed<T>(
  parent: ParentLike,
  items: () => T[],
  key: (t: T) => string,
  render: (t: T) => Element,
  opts: { exit?: (node: Element) => Promise<void> | void } = {},
): void {
  const live = new Map<string, Element>();
  const leaving = new Set<Element>();
  van.derive(() => {
    const list = items();
    const want = new Set(list.map(key));
    for (const [k, node] of live) {
      if (want.has(k)) continue;
      live.delete(k);
      if (!opts.exit) {
        node.remove();
        continue;
      }
      leaving.add(node);
      Promise.resolve(opts.exit(node)).then(() => {
        leaving.delete(node);
        node.remove();
      });
    }
    const nodes = list.map((t) => {
      const k = key(t);
      let node = live.get(k);
      if (!node) {
        node = scoped(() => render(t));
        live.set(k, node);
      }
      return node;
    });
    // Moves only what is out of place, leaving exiting nodes where they are.
    let at = parent.firstElementChild;
    for (const node of nodes) {
      while (at && leaving.has(at)) at = at.nextElementSibling;
      if (node === at) at = at.nextElementSibling;
      else parent.insertBefore(node, at);
    }
  });
}
