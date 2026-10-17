import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSessions } from './split.ts';

test('splitSessions keeps cards and groups side terminals by parent', () => {
  const { cards, sides } = splitSessions([
    { id: 'card', parent: null },
    { id: 't1', parent: 'card' },
    { id: 't2', parent: 'card' },
    { id: 'other', parent: null },
  ]);
  assert.deepEqual(
    cards.map((c) => c.id),
    ['card', 'other'],
  );
  assert.deepEqual(
    sides.get('card')?.map((s) => s.id),
    ['t1', 't2'],
  );
  assert.equal(sides.has('other'), false);
});

test('splitSessions drops a side terminal whose parent is missing or itself a side', () => {
  const { cards, sides } = splitSessions([
    { id: 'card', parent: null },
    { id: 'orphan', parent: 'gone' },
    { id: 'nested', parent: 'side' },
    { id: 'side', parent: 'card' },
  ]);
  assert.deepEqual(
    cards.map((c) => c.id),
    ['card'],
  );
  assert.deepEqual(
    sides.get('card')?.map((s) => s.id),
    ['side'],
  );
  assert.equal(
    [...sides.values()].flat().some((s) => s.id === 'orphan' || s.id === 'nested'),
    false,
  );
});
