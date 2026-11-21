import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addView,
  deleteView,
  nameTaken,
  newViewId,
  parseCurrent,
  parseViews,
  renameView,
  updateView,
} from './views.ts';

test('saved views read back, dropping anything malformed', () => {
  assert.deepEqual(parseViews([{ id: 'a', name: 'Bugs', query: 'tag:bug' }, { id: 'b', name: 3 }, null]), [
    { id: 'a', name: 'Bugs', query: 'tag:bug' },
  ]);
  assert.deepEqual(parseViews('nope'), []);
  assert.deepEqual(parseViews(undefined), []);
});

test('the current filter reads back: a view, its query and the ticked tags and folders', () => {
  const none = { query: '', viewId: null, tags: [], folders: [] };
  assert.deepEqual(parseCurrent({ query: 'tag:a', viewId: 'v1', tags: ['b'], folders: ['/x'] }), {
    query: 'tag:a',
    viewId: 'v1',
    tags: ['b'],
    folders: ['/x'],
  });
  assert.deepEqual(parseCurrent({ query: 'tag:a', viewId: 4, tags: 'b' }), { ...none, query: 'tag:a' });
  // The old filter was only ticks: they stay ticks.
  assert.deepEqual(parseCurrent({ tags: ['a'], folders: ['/x'] }), { ...none, tags: ['a'], folders: ['/x'] });
  assert.deepEqual(parseCurrent(undefined), none);
  assert.deepEqual(parseCurrent('{'), none);
});

test('views are added, renamed, updated and deleted; names stay unique', () => {
  let v = addView([], { id: '1', name: ' Bugs ', query: 'tag:bug' });
  assert.deepEqual(v, [{ id: '1', name: 'Bugs', query: 'tag:bug' }]);
  assert.equal(addView(v, { id: '2', name: 'bugs', query: '' }), v);
  assert.equal(addView(v, { id: '2', name: '  ', query: '' }), v);
  assert.equal(nameTaken(v, 'BUGS'), true);
  assert.equal(nameTaken(v, 'Bugs', '1'), false);
  v = renameView(v, '1', 'Defects');
  assert.equal(v[0].name, 'Defects');
  v = addView(v, { id: '2', name: 'Other', query: '' });
  assert.equal(renameView(v, '2', 'defects'), v);
  v = updateView(v, '1', 'tag:defect');
  assert.equal(v[0].query, 'tag:defect');
  assert.deepEqual(
    deleteView(v, '1').map((x) => x.id),
    ['2'],
  );
});

test('a view id is made without crypto.randomUUID (missing over plain HTTP)', () => {
  const real = crypto.randomUUID;
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const a = newViewId();
    const b = newViewId();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, b);
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: real, configurable: true });
  }
});
