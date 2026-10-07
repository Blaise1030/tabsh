import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changed, fileAction, fromQuery, HOME, merge, type Place, toQuery } from './place.ts';

const q = (s: string) => fromQuery(new URLSearchParams(s));

test('round-trips a full place', () => {
  const p: Place = { tab: '7f3a', view: 'board', file: '/r/src/main.rs', line: 42, explorer: true, palette: 'root' };
  assert.deepEqual(fromQuery(new URLSearchParams(toQuery(p, new URLSearchParams()))), p);
});

test('leaves defaults out', () => {
  assert.equal(toQuery({ ...HOME, tab: '7f3a' }, new URLSearchParams()), '?tab=7f3a');
  assert.equal(toQuery(HOME, new URLSearchParams()), '');
});

test('keeps other keys', () => {
  const keep = new URLSearchParams('daemon=http%3A%2F%2F127.0.0.1%3A9&view=board');
  assert.equal(toQuery({ ...HOME, tab: 'a' }, keep), '?daemon=http%3A%2F%2F127.0.0.1%3A9&tab=a');
});

test('drops bad values', () => {
  assert.deepEqual(q('view=grid'), {});
  assert.deepEqual(q('palette=../x'), {});
  assert.deepEqual(q('line=0'), {});
  assert.deepEqual(q('line=-3'), {});
  assert.deepEqual(q('line=abc'), {});
  assert.deepEqual(q('line=4'), {});
  assert.deepEqual(q(`tab=${'a'.repeat(129)}`), {});
  assert.deepEqual(q(`file=${'a'.repeat(4097)}`), {});
  assert.deepEqual(q('file=/x&line=4'), { file: '/x', line: 4 });
});

test('merge: a push closes the palette', () => {
  const from = { ...HOME, tab: 'a', palette: 'root' };
  assert.equal(merge(from, { view: 'board' }, 'push').palette, null);
  assert.equal(merge(from, { view: 'board' }, 'replace').palette, 'root');
  assert.equal(merge(from, { palette: 'theme' }, 'push').palette, 'theme');
});

test('merge: a new tab drops the file', () => {
  const from = { ...HOME, tab: 'a', file: '/x', line: 3 };
  const moved = merge(from, { tab: 'b' }, 'push');
  assert.equal(moved.file, null);
  assert.equal(moved.line, null);
  assert.equal(merge(from, { tab: 'a' }, 'push').file, '/x');
});

test('changed lists steps in order', () => {
  assert.deepEqual(changed(HOME, { ...HOME, palette: 'root', tab: 'a' }), ['tab', 'palette']);
  assert.deepEqual(changed({ ...HOME, file: '/x', line: 1 }, { ...HOME, file: '/x', line: 2 }), ['file']);
  assert.deepEqual(changed(HOME, HOME), []);
});

test('fileAction', () => {
  const a = { ...HOME, tab: 'a', file: '/x', line: 3 };
  assert.equal(fileAction(a, { ...a }), 'keep');
  assert.equal(fileAction(a, { ...a, tab: 'b', file: null, line: null }), 'adopt');
  assert.equal(fileAction(a, { ...a, file: null, line: null }), 'close');
  assert.equal(fileAction({ ...a, file: null, line: null }, { ...a, file: null, line: null }), 'keep');
  assert.equal(fileAction(a, { ...a, file: '/y' }), 'open');
  assert.equal(fileAction(a, { ...a, line: 4 }), 'open');
});
