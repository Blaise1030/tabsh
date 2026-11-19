import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Status } from './model.ts';
import {
  completionAt,
  formatTerm,
  hasTerm,
  liveQuery,
  liveText,
  matches,
  migrateFilter,
  parseQuery,
  type Subject,
  suggestionsFor,
  withoutTerm,
  withTerm,
} from './query.ts';

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

test('ticking adds a term; unticking removes it', () => {
  assert.equal(withTerm('', 'tag', 'bug'), 'tag:bug');
  assert.equal(withTerm('tag:a', 'tag', 'two words'), 'tag:a tag:"two words"');
  assert.equal(withTerm('tag:a', 'tag', 'A'), 'tag:a'); // already there
  assert.equal(withoutTerm('tag:a tag:"two words" -tag:c', 'tag', 'two words'), 'tag:a -tag:c');
  assert.equal(withoutTerm('tag:bug', 'tag', 'BUG'), '');
  assert.equal(withoutTerm('tag:a and tag:b', 'tag', 'b'), 'tag:a');
  assert.equal(withoutTerm('tag:a and tag:b and tag:c', 'tag', 'b'), 'tag:a and tag:c');
  assert.equal(withoutTerm('tag:a oops', 'tag', 'a'), 'tag:a oops'); // invalid: left alone
});

test('ticking under a top-level or keeps its meaning', () => {
  assert.equal(withTerm('tag:a or tag:b', 'tag', 'c'), '(tag:a or tag:b) tag:c');
});

test('a box is ticked only for a plain top-level term', () => {
  assert.equal(hasTerm('tag:a tag:b', 'tag', 'b'), true);
  assert.equal(hasTerm('tag:B', 'tag', 'b'), true);
  assert.equal(hasTerm('-tag:b', 'tag', 'b'), false);
  assert.equal(hasTerm('tag:a or tag:b', 'tag', 'b'), false);
  assert.equal(hasTerm('folder:~/app', 'folder', '~/app'), true);
  assert.equal(hasTerm('tag:a oops', 'tag', 'a'), false);
});

test('completion knows the field and what is typed', () => {
  assert.deepEqual(completionAt('ta', 2), { field: null, partial: 'ta', start: 0, end: 2 });
  assert.deepEqual(completionAt('-tag:bu', 7), { field: 'tag', partial: 'bu', start: 5, end: 7 });
  assert.deepEqual(completionAt('(status:ne', 10), { field: 'status', partial: 'ne', start: 8, end: 10 });
  assert.deepEqual(completionAt('tag:"two wo', 11), { field: 'tag', partial: 'two wo', start: 4, end: 11 });
  assert.equal(completionAt('tag:a ', 6), null);
  assert.equal(completionAt('tag:"a b" ', 10), null);
  assert.equal(completionAt('colour:r', 8), null);
});

test('a value still being typed does not blank the board', () => {
  const known = { tags: ['bug'], folders: [] };
  const card = (tags: string[]): Subject => ({ tags, cwd: null, status: 'backlog' });
  const live = liveQuery('tag:x tag:b', 11, known);
  assert.ok(live.ok);
  assert.equal(matches(live.node, card(['x'])), true);
  const alone = liveQuery('tag:b', 5, known);
  assert.ok(alone.ok);
  assert.equal(alone.node, null);
  const either = liveQuery('tag:x or tag:b', 14, known);
  assert.ok(either.ok);
  assert.equal(matches(either.node, card(['x'])), true);
  const status = liveQuery('status:need', 11, known);
  assert.ok(status.ok);
  assert.equal(status.node, null);
  const elsewhere = liveQuery('tag:b', 2, known); // caret elsewhere: taken as typed
  assert.ok(elsewhere.ok);
  assert.equal(matches(elsewhere.node, card(['bug'])), false);
  const typo = liveQuery('tag:x tag:bgu', 13, known); // names nothing in use: left out too
  assert.ok(typo.ok);
  assert.equal(matches(typo.node, card(['x'])), true);
  assert.equal(liveText('folder:/Users/me/Doc', 20, { tags: [], folders: ['~/Documents'] }), '');
});

test('an old filter becomes the same query', () => {
  assert.equal(
    migrateFilter({ tags: ['a', 'two words'], folders: ['/Users/me/app'] }),
    '(tag:a or tag:"two words") folder:~/app',
  );
  assert.equal(migrateFilter({ tags: ['a'], folders: [] }), 'tag:a');
  assert.equal(migrateFilter(null), '');
  assert.equal(migrateFilter({ tags: 'a' }), '');
});

test('the live text is what is applied while typing', () => {
  const known = { tags: ['bug', 'build'], folders: ['~/app'] };
  assert.equal(liveText('tag:x tag:b', 11, known), 'tag:x');
  assert.equal(liveText('tag:x tag:bug', 13, known), 'tag:x tag:bug');
  assert.equal(liveText('tag:x -tag:b', 12, known), 'tag:x');
});

test('suggestions: fields for a bare word, values after a field', () => {
  const known = { tags: ['bug', 'build', 'two words'], folders: ['~/app', '~/web'] };
  assert.deepEqual(suggestionsFor({ field: null, partial: 'f', start: 0, end: 1 }, known), [
    { label: 'folder:', insert: 'folder:' },
  ]);
  assert.deepEqual(
    suggestionsFor({ field: 'tag', partial: 'u', start: 4, end: 5 }, known).map((x) => x.insert),
    ['bug', 'build'],
  );
  assert.deepEqual(suggestionsFor({ field: 'tag', partial: 'two', start: 4, end: 7 }, known), [
    { label: 'two words', insert: '"two words"' },
  ]);
  assert.deepEqual(suggestionsFor({ field: 'tag', partial: 'bug', start: 4, end: 7 }, known), []);
  assert.deepEqual(
    suggestionsFor({ field: 'status', partial: 'in', start: 7, end: 9 }, known).map((x) => x.insert),
    ['"In progress"', '"Needs input"'],
  );
});
