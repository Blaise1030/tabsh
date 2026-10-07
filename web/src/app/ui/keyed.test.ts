import assert from 'node:assert/strict';
import { test } from 'node:test';
import van from 'vanjs-core';
import { keyed } from './keyed.ts';

type Node = { key: string; parent: Fake | null; nextElementSibling: Node | null; remove(): void };

// Just enough of a parent for keyed(): ordered children, insertBefore, firstElementChild.
class Fake {
  kids: Node[] = [];
  get firstElementChild(): Node | null {
    return this.kids[0] ?? null;
  }
  insertBefore(node: Node, ref: Node | null): void {
    node.parent?.kids.splice(node.parent.kids.indexOf(node), 1);
    node.parent = this;
    this.kids.splice(ref ? this.kids.indexOf(ref) : this.kids.length, 0, node);
    this.kids.forEach((k, i) => {
      k.nextElementSibling = this.kids[i + 1] ?? null;
    });
  }
  keys = () => this.kids.map((k) => k.key);
}

// VanJS reruns derives on a timer, not at once.
const tick = () => new Promise((r) => setTimeout(r, 5));

function setup(initial: string[], exit?: (n: Node) => Promise<void>) {
  const parent = new Fake();
  const items = van.state(initial);
  const made: string[] = [];
  const render = (key: string) => {
    made.push(key);
    const node: Node = {
      key,
      parent: null,
      nextElementSibling: null,
      remove() {
        const p = node.parent;
        if (!p) return;
        p.kids.splice(p.kids.indexOf(node), 1);
        node.parent = null;
        p.kids.forEach((k, i) => {
          k.nextElementSibling = p.kids[i + 1] ?? null;
        });
      },
    };
    return node;
  };
  keyed(
    parent,
    () => items.val,
    (k) => k,
    render as never,
    { exit: exit as never },
  );
  return { parent, items, made };
}

test('renders each key once in order', () => {
  const { parent, made } = setup(['a', 'b', 'c']);
  assert.deepEqual(parent.keys(), ['a', 'b', 'c']);
  assert.deepEqual(made, ['a', 'b', 'c']);
});

test("keeps a surviving key's node", async () => {
  const { parent, items, made } = setup(['a', 'b', 'c']);
  const [a, , c] = parent.kids;
  items.val = ['c', 'a'];
  await tick();
  assert.deepEqual(parent.keys(), ['c', 'a']);
  assert.equal(parent.kids[0], c);
  assert.equal(parent.kids[1], a);
  assert.equal(made.length, 3);
});

test('adds new keys in place', async () => {
  const { parent, items, made } = setup(['a', 'c']);
  items.val = ['a', 'b', 'c'];
  await tick();
  assert.deepEqual(parent.keys(), ['a', 'b', 'c']);
  assert.deepEqual(made, ['a', 'c', 'b']);
});

test('exit runs before removal', async () => {
  let done!: () => void;
  const { parent, items } = setup(['a', 'b'], () => new Promise<void>((r) => (done = r)));
  const b = parent.kids[1];
  items.val = ['a'];
  await tick();
  assert.ok(parent.kids.includes(b), 'b stays while exiting');
  items.val = ['a', 'b'];
  await tick();
  assert.notEqual(
    parent.kids.find((k) => k !== parent.kids[0] && k !== b),
    b,
    'a re-added b is a new node',
  );
  assert.equal(parent.kids.filter((k) => k.key === 'b').length, 2);
  done();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!parent.kids.includes(b), 'b is gone once exit resolves');
  assert.deepEqual(parent.keys(), ['a', 'b']);
});
