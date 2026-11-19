import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Status } from './model.ts';
import { formatTerm, matches, parseQuery, type Subject } from './query.ts';

const s = (tags: string[], cwd: string | null = '/Users/me/app', status: Status = 'backlog'): Subject => ({
  tags,
  cwd,
  status,
});
const m = (q: string, subj: Subject): boolean => {
  const p = parseQuery(q);
  assert.ok(p.ok, q);
  return matches(p.node, subj);
};

test('an empty query matches every card', () => {
  assert.equal(m('', s([])), true);
  assert.equal(m('   ', s(['x'])), true);
});

test('a tag term matches ignoring case', () => {
  assert.equal(m('tag:Bug', s(['bug'])), true);
  assert.equal(m('tag:bug', s(['bugs'])), false);
});

test('adjacent terms and "and" both mean both', () => {
  assert.equal(m('tag:a tag:b', s(['a'])), false);
  assert.equal(m('tag:a AND tag:b', s(['a', 'b'])), true);
});

test('or, not and minus', () => {
  assert.equal(m('tag:a or tag:b', s(['b'])), true);
  assert.equal(m('-tag:wip', s(['wip'])), false);
  assert.equal(m('not tag:wip', s([])), true);
});

test('and binds tighter than or; brackets regroup', () => {
  assert.equal(m('tag:a tag:b or tag:c', s(['c'])), true);
  assert.equal(m('tag:a (tag:b or tag:c)', s(['c'])), false);
  assert.equal(m('-(tag:a or tag:b)', s(['b'])), false);
});

test('quoted values keep spaces', () => {
  assert.equal(m('tag:"two words"', s(['Two Words'])), true);
  assert.equal(m('tag:"say \\"hi\\""', s(['say "hi"'])), true);
});

test('folder matches itself and anything inside, full or ~ form', () => {
  assert.equal(m('folder:~/app', s([], '/Users/me/app/web')), true);
  assert.equal(m('folder:/Users/me/app/', s([], '/Users/me/app')), true);
  assert.equal(m('folder:~/app', s([], '/Users/me/apple')), false);
  assert.equal(m('folder:~/app', s([], null)), false);
});

test('status by id or name', () => {
  assert.equal(m('status:"needs input"', s([], null, 'needs_input')), true);
  assert.equal(m('status:in_progress', s([], null, 'in_progress')), true);
  assert.equal(m('STATUS:Backlog', s([], null, 'backlog')), true);
  assert.equal(m('status:backlog', s([], null, 'completed')), false);
});

test('errors say where and hint', () => {
  const bare = parseQuery('tag:a bug');
  assert.ok(!bare.ok);
  assert.equal(bare.error.message, 'Unknown term "bug". Did you mean tag:bug?');
  assert.deepEqual([bare.error.start, bare.error.end], [6, 9]);
  for (const bad of [
    '(tag:a',
    'tag:a)',
    'tag:a or',
    'colour:red',
    'status:soon',
    'tag:',
    'tag:"open',
    '()',
    'or tag:a',
  ])
    assert.equal(parseQuery(bad).ok, false, bad);
});

test('formatTerm quotes only when needed', () => {
  assert.equal(formatTerm('tag', 'bug'), 'tag:bug');
  assert.equal(formatTerm('tag', 'two words'), 'tag:"two words"');
  assert.equal(formatTerm('tag', 'say "hi"'), 'tag:"say \\"hi\\""');
  assert.equal(formatTerm('tag', 'or'), 'tag:or');
  assert.equal(formatTerm('folder', '~/my app'), 'folder:"~/my app"');
});
