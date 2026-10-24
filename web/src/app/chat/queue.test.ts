import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadQueue, parseQueued, saveQueue } from './queue.ts';

test('parseQueued keeps only string lines', () => {
  assert.deepEqual(parseQueued(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseQueued(['a', 1, null, 'b']), ['a', 'b']);
  assert.deepEqual(parseQueued(null), []);
  assert.deepEqual(parseQueued({}), []);
});

test('saveQueue and loadQueue round-trip per session', () => {
  const store = new Map<string, string>();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
  try {
    saveQueue('s1', ['one', 'two']);
    saveQueue('s2', ['other']);
    assert.deepEqual(loadQueue('s1'), ['one', 'two']);
    assert.deepEqual(loadQueue('s2'), ['other']);
    saveQueue('s1', []);
    assert.deepEqual(loadQueue('s1'), []);
    assert.deepEqual(loadQueue('s2'), ['other']);
  } finally {
    globalThis.localStorage = prev;
  }
});
