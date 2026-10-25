import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNearBottom, scrollFades } from './scroll.ts';

test('isNearBottom is true within the threshold of the end', () => {
  assert.equal(isNearBottom({ scrollTop: 920, scrollHeight: 1000, clientHeight: 80 }, 40), true);
  assert.equal(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 80 }, 40), false);
});

test('isNearBottom treats a short list as pinned', () => {
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 50, clientHeight: 200 }, 40), true);
});

test('scrollFades fades only the edges with content beyond them', () => {
  // The list fits: no fade.
  assert.deepEqual(scrollFades({ scrollTop: 0, scrollHeight: 140, clientHeight: 224 }), {
    top: false,
    bottom: false,
  });
  // At the start of a long list: only the bottom fades.
  assert.deepEqual(scrollFades({ scrollTop: 0, scrollHeight: 600, clientHeight: 224 }), {
    top: false,
    bottom: true,
  });
  // In the middle: both edges fade.
  assert.deepEqual(scrollFades({ scrollTop: 200, scrollHeight: 600, clientHeight: 224 }), {
    top: true,
    bottom: true,
  });
  // At the end: only the top fades.
  assert.deepEqual(scrollFades({ scrollTop: 376, scrollHeight: 600, clientHeight: 224 }), {
    top: true,
    bottom: false,
  });
});
