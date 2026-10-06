import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyChange, parseChange } from './changes.ts';

const known = (...paths: string[]) => new Set(paths);

test('adds become add operations, and the paths become known', () => {
  const k = known('src/');
  const action = applyChange(k, { add: ['src/new.rs'], remove: [] });
  assert.deepEqual(action, { kind: 'ops', ops: [{ type: 'add', path: 'src/new.rs' }] });
  assert.ok(k.has('src/new.rs'));
});

test('adds of paths already present are dropped', () => {
  const k = known('src/', 'src/main.rs');
  assert.deepEqual(applyChange(k, { add: ['src/', 'src/main.rs'], remove: [] }), { kind: 'ops', ops: [] });
});

test('removes of absent paths are dropped', () => {
  const k = known('a.txt');
  assert.deepEqual(applyChange(k, { add: [], remove: ['nope.txt', 'gone/'] }), { kind: 'ops', ops: [] });
});

test('a removed file is removed, and forgotten', () => {
  const k = known('a.txt');
  assert.deepEqual(applyChange(k, { add: [], remove: ['a.txt'] }), {
    kind: 'ops',
    ops: [{ type: 'remove', path: 'a.txt' }],
  });
  assert.ok(!k.has('a.txt'));
});

test('a removed directory removes its subtree once', () => {
  const k = known('lib/', 'lib/deep/', 'lib/deep/x.ts', 'libs.txt');
  // The daemon sends no slash for a path that is gone, and one event per child.
  const action = applyChange(k, { add: [], remove: ['lib', 'lib/deep', 'lib/deep/x.ts'] });
  assert.deepEqual(action, { kind: 'ops', ops: [{ type: 'remove', path: 'lib/', recursive: true }] });
  assert.deepEqual([...k], ['libs.txt']);
});

test('adds put parents before children, adding missing parents too', () => {
  const k = known('src/');
  const action = applyChange(k, { add: ['lib/deep/x.ts', 'lib/', 'lib/deep/', 'src/a.rs'], remove: [] });
  assert.deepEqual(action, {
    kind: 'ops',
    ops: [
      { type: 'add', path: 'lib/' },
      { type: 'add', path: 'lib/deep/' },
      { type: 'add', path: 'lib/deep/x.ts' },
      { type: 'add', path: 'src/a.rs' },
    ],
  });
});

test('removes come before adds, so a rename frees the name first', () => {
  const k = known('src/', 'src/new.rs');
  const action = applyChange(k, { add: ['src/renamed.rs'], remove: ['src/new.rs'] });
  assert.deepEqual(action, {
    kind: 'ops',
    ops: [
      { type: 'remove', path: 'src/new.rs' },
      { type: 'add', path: 'src/renamed.rs' },
    ],
  });
});

test('reset asks for a re-fetch', () => {
  assert.deepEqual(applyChange(known('a'), { reset: true }), { kind: 'reset' });
});

test('parseChange reads the two message shapes and nothing else', () => {
  assert.deepEqual(parseChange('{"add":["a"],"remove":["b"]}'), { add: ['a'], remove: ['b'] });
  assert.deepEqual(parseChange('{"add":["a"]}'), { add: ['a'], remove: [] });
  assert.deepEqual(parseChange('{"reset":true}'), { reset: true });
  assert.equal(parseChange('not json'), null);
  assert.equal(parseChange('{"add":[1]}'), null);
  assert.equal(parseChange('{"hello":1}'), null);
  assert.equal(parseChange('[]'), null);
});
