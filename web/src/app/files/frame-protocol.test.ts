import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_QUOTE, parseFromFrame, parseToFrame } from './frame-protocol.ts';

const rect = { top: 1, bottom: 2, left: 3, right: 4 };
const select = { type: 'select', sel: 1, quote: 'hi', from: 2, to: 3, nth: 0, of: 1, rect };

test('well-formed messages from the frame pass, rebuilt with only their fields', () => {
  assert.deepEqual(parseFromFrame({ type: 'ready', extra: 1 }), { type: 'ready' });
  assert.deepEqual(parseFromFrame({ ...select, extra: 'x' }), select);
  assert.deepEqual(parseFromFrame({ type: 'hover', id: 4, rect }), { type: 'hover', id: 4, rect });
  assert.deepEqual(parseFromFrame({ type: 'located', id: 4, from: 5, to: 5 }), {
    type: 'located',
    id: 4,
    from: 5,
    to: 5,
  });
  assert.deepEqual(parseFromFrame({ type: 'lost', id: 4 }), { type: 'lost', id: 4 });
  for (const type of ['clear', 'unhover', 'scroll']) assert.deepEqual(parseFromFrame({ type }), { type });
  assert.deepEqual(parseFromFrame({ ...select, nth: -1 }), { ...select, nth: -1 });
  assert.deepEqual(parseFromFrame({ ...select, nth: 0, of: 2 }), { ...select, nth: 0, of: 2 });
});

test('malformed messages from the frame are dropped', () => {
  for (const bad of [
    null,
    'select',
    [],
    { type: 'nope' },
    { ...select, quote: '   ' },
    { ...select, quote: 'x'.repeat(MAX_QUOTE + 1) },
    { ...select, quote: 3 },
    { ...select, from: 0 },
    { ...select, from: 4, to: 3 },
    { ...select, from: 1.5 },
    { ...select, sel: 0 },
    { ...select, nth: -2 },
    { ...select, of: -1 },
    { ...select, rect: { ...rect, top: Number.NaN } },
    { ...select, rect: { ...rect, left: '3' } },
    { ...select, rect: null },
    { type: 'hover', id: 0, rect },
    { type: 'hover', id: 1 },
    { type: 'located', id: 1, from: 3, to: 2 },
    { type: 'lost', id: '1' },
    { ...select, nth: 1, of: 1 },
    Object.assign([], { type: 'ready' }),
    Object.assign(Object.create({ sel: 1 }), { type: 'select', quote: 'hi', from: 2, to: 3, nth: 0, of: 1, rect }),
    Object.defineProperty({ ...select }, 'quote', { get: () => 'hi', enumerable: true }),
  ]) {
    assert.equal(parseFromFrame(bad), null, JSON.stringify(bad));
  }
});

test('well-formed messages to the frame pass', () => {
  assert.deepEqual(parseToFrame({ type: 'keep', id: 1, sel: 2 }), { type: 'keep', id: 1, sel: 2 });
  assert.deepEqual(parseToFrame({ type: 'drop', id: 1 }), { type: 'drop', id: 1 });
  assert.deepEqual(parseToFrame({ type: 'dropAll' }), { type: 'dropAll' });
  const locate = { type: 'locate', id: 1, quote: 'q', from: 3, nth: 1, of: 2 };
  assert.deepEqual(parseToFrame(locate), locate);
  assert.deepEqual(parseToFrame({ type: 'theme', css: 'body{}' }), { type: 'theme', css: 'body{}' });
});

test('malformed messages to the frame are dropped', () => {
  for (const bad of [
    undefined,
    { type: 'keep', id: 1 },
    { type: 'keep', id: -1, sel: 1 },
    { type: 'drop', id: Number.POSITIVE_INFINITY },
    { type: 'locate', id: 1, quote: '', from: 3, nth: 0, of: 1 },
    { type: 'locate', id: 1, quote: 'q', from: 3, nth: 0 },
    { type: 'locate', id: 1, quote: 'q', from: 3, nth: 2, of: 2 },
    { type: 'theme', css: 4 },
    { type: 'theme', css: 'x'.repeat(20_001) },
  ]) {
    assert.equal(parseToFrame(bad), null, JSON.stringify(bad));
  }
});
