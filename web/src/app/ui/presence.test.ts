import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePresence } from './presence.ts';

test('a removed item keeps its place', () => {
  assert.deepEqual(
    mergePresence(['a', 'b', 'c'], ['a', 'c'], (x) => x),
    ['a', 'b', 'c'],
  );
});

test('a reorder keeps a leaving item near its old slot', () => {
  assert.deepEqual(
    mergePresence(['a', 'b', 'c'], ['c', 'a'], (x) => x),
    ['c', 'b', 'a'],
  );
});

test('a key that is back is not duplicated', () => {
  assert.deepEqual(
    mergePresence(['a', 'b'], ['b', 'a'], (x) => x),
    ['b', 'a'],
  );
});
