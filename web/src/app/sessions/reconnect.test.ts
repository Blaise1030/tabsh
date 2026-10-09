import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coalesceAsync,
  enqueueReconnect,
  nextReconnect,
  retryDelay,
  shouldDrainReconnects,
  terminalInView,
} from './reconnect.ts';

test('the active tab is reconnected before any other queued tab', () => {
  const { next, rest } = nextReconnect(['a', 'b', 'c'], 'b');
  assert.equal(next, 'b');
  assert.deepEqual(rest, ['a', 'c']);
});

test('without an active tab, reconnects stay in the order they were queued', () => {
  const { next, rest } = nextReconnect(['a', 'b', 'c'], null);
  assert.equal(next, 'a');
  assert.deepEqual(rest, ['b', 'c']);
});

test('an empty queue has nothing to reconnect', () => {
  assert.deepEqual(nextReconnect([], 'a'), { next: null, rest: [] });
});

test('a tab is only queued once', () => {
  assert.deepEqual(enqueueReconnect(['a'], 'a'), ['a']);
  assert.deepEqual(enqueueReconnect(['a'], 'b'), ['a', 'b']);
});

test('retry delay doubles up to a cap, like the explorer socket', () => {
  assert.equal(retryDelay(0), 1_000);
  assert.equal(retryDelay(1), 2_000);
  assert.equal(retryDelay(2), 4_000);
  assert.equal(retryDelay(10), 15_000);
});

test('reconnects wait while the page is hidden', () => {
  assert.equal(shouldDrainReconnects(true), false);
  assert.equal(shouldDrainReconnects(false), true);
});

test('only the on-screen terminal is in view', () => {
  const base = {
    sessionId: 'a',
    activeId: 'a',
    view: 'terms' as const,
    drawer: false,
    documentHidden: false,
  };
  assert.equal(terminalInView(base), true);
  assert.equal(terminalInView({ ...base, activeId: 'b' }), false);
  assert.equal(terminalInView({ ...base, documentHidden: true }), false);
  assert.equal(terminalInView({ ...base, view: 'board', drawer: false }), false);
  assert.equal(terminalInView({ ...base, view: 'board', drawer: true }), true);
});

test('overlapping sync calls share one run and repeat if another arrived mid-flight', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const sync = coalesceAsync(async () => {
    runs++;
    if (runs === 1) await gate;
  });

  const first = sync();
  const second = sync();
  assert.equal(runs, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 2);
});
