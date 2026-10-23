import assert from 'node:assert/strict';
import { test } from 'node:test';
import { takePending, withOptimisticUser } from './optimistic.ts';

test('withOptimisticUser appends pending then queued user lines', () => {
  const view = withOptimisticUser([{ type: 'text_delta', text: 'hi' }], ['one'], ['two']);
  assert.equal(view.length, 3);
  assert.equal(view[1]?.type, 'user_text');
  assert.equal(view[1]?.text, 'one');
  assert.equal(view[1]?.queued, undefined);
  assert.equal(view[2]?.text, 'two');
  assert.equal(view[2]?.queued, true);
});

test('takePending removes the first matching line', () => {
  assert.deepEqual(takePending(['a', 'b', 'a'], 'a'), ['b', 'a']);
  assert.deepEqual(takePending(['a'], 'x'), ['a']);
});
