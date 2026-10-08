import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asStatus, type Card, dropOrder, group, recentFolders, shortPath, since } from './model.ts';

const card = (status: Card['status'], cwd: string | null = null, statusAt = 0): Card => ({
  status,
  statusAt,
  note: null,
  cwd,
});
const item = (id: string, status: Card['status'], cwd: string | null = null, statusAt = 0) => ({
  id,
  card: card(status, cwd, statusAt),
});

test('unknown statuses read as backlog', () => {
  assert.equal(asStatus('needs_input'), 'needs_input');
  assert.equal(asStatus('doing'), 'backlog');
  assert.equal(asStatus(undefined), 'backlog');
});

test('group keeps tab order within each status', () => {
  const g = group([item('a', 'completed'), item('b', 'backlog'), item('c', 'completed')]);
  assert.deepEqual(
    g.completed.map((x) => x.id),
    ['a', 'c'],
  );
  assert.deepEqual(g.archived, []);
});

test('since is short', () => {
  assert.equal(since(1000, 1030), 'now');
  assert.equal(since(1000, 1000 + 5 * 60), '5m');
  assert.equal(since(1000, 1000 + 3 * 3600), '3h');
  assert.equal(since(1000, 1000 + 2 * 86400), '2d');
  assert.equal(since(2000, 1000), 'now'); // clock skew
});

test('shortPath shortens home', () => {
  assert.equal(shortPath('/Users/jo/code/app'), '~/code/app');
  assert.equal(shortPath('/home/jo'), '~');
  assert.equal(shortPath('/tmp/x'), '/tmp/x');
  assert.equal(shortPath(null), '');
});

test('recent folders are unique, newest first', () => {
  const r = recentFolders([
    item('a', 'backlog', '/a', 1),
    item('b', 'backlog', '/b', 3),
    item('c', 'backlog', '/a', 5),
    item('d', 'backlog', null, 9),
  ]);
  assert.deepEqual(r, ['/a', '/b']);
});

test('dropOrder puts the card before the target, or at the end of its column', () => {
  const items = [item('a', 'backlog'), item('b', 'in_progress'), item('c', 'backlog'), item('d', 'completed')];
  assert.deepEqual(dropOrder(items, 'd', 'backlog', 'c'), ['a', 'b', 'd', 'c']);
  assert.deepEqual(dropOrder(items, 'a', 'backlog', null), ['b', 'c', 'a', 'd']);
  assert.deepEqual(dropOrder(items, 'a', 'needs_input', null), ['b', 'c', 'd', 'a']);
});
