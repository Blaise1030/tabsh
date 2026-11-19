import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addView, deleteView, nameTaken, parseCurrent, parseViews, renameView, updateView } from './views.ts';

test('saved views read back, dropping anything malformed', () => {
  assert.deepEqual(parseViews([{ id: 'a', name: 'Bugs', query: 'tag:bug' }, { id: 'b', name: 3 }, null]), [
    { id: 'a', name: 'Bugs', query: 'tag:bug' },
  ]);
  assert.deepEqual(parseViews('nope'), []);
  assert.deepEqual(parseViews(undefined), []);
});

test('the current filter reads back, migrating the old shape', () => {
  assert.deepEqual(parseCurrent({ query: 'tag:a', viewId: 'v1' }), { query: 'tag:a', viewId: 'v1' });
  assert.deepEqual(parseCurrent({ query: 'tag:a', viewId: 4 }), { query: 'tag:a', viewId: null });
  assert.deepEqual(parseCurrent({ tags: ['a'], folders: [] }), { query: 'tag:a', viewId: null });
  assert.deepEqual(parseCurrent(undefined), { query: '', viewId: null });
  assert.deepEqual(parseCurrent('{'), { query: '', viewId: null });
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
