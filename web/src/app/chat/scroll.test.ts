import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNearBottom } from './scroll.ts';

test('isNearBottom is true within the threshold of the end', () => {
  assert.equal(isNearBottom({ scrollTop: 920, scrollHeight: 1000, clientHeight: 80 }, 40), true);
  assert.equal(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 80 }, 40), false);
});

test('isNearBottom treats a short list as pinned', () => {
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 50, clientHeight: 200 }, 40), true);
});
