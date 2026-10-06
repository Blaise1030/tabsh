import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropIndex, inOrder } from './order.ts';

test('a dragged tab goes after every tab whose center it passed', () => {
  const centers = [50, 150, 250];
  assert.equal(dropIndex(centers, 10), 0);
  assert.equal(dropIndex(centers, 149), 1);
  assert.equal(dropIndex(centers, 151), 2);
  assert.equal(dropIndex(centers, 400), 3);
  assert.equal(dropIndex([], 10), 0);
});

test('tabs follow the given order, unknown ones last in their old order', () => {
  const tabs = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  assert.deepEqual(
    inOrder(tabs, ['c', 'a']).map((t) => t.id),
    ['c', 'a', 'b', 'd'],
  );
});
