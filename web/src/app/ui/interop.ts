// Temporary: lets Solid read the VanJS states while the views move over.
import { type Accessor, createSignal } from 'solid-js';
import van, { type State } from 'vanjs-core';

const mirrors = new WeakMap<object, Accessor<unknown>>();

// A Solid accessor following `state`, one per state for good. Reads are
// current at once; Solid hears of a change once VanJS runs its derives (a
// microtask later). `rawVal` keeps a read inside a VanJS derive from
// subscribing it.
export function fromVan<T>(state: State<T>): Accessor<T> {
  let read = mirrors.get(state);
  if (!read) {
    const [version, bump] = createSignal(0, { equals: false });
    let first = true;
    van.derive(() => {
      state.val;
      if (first) first = false;
      else bump(0);
    });
    read = () => {
      version();
      return state.rawVal;
    };
    mirrors.set(state, read);
  }
  return read as Accessor<T>;
}
