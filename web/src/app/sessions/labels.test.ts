import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTag,
  cleanTag,
  groupTabs,
  joinGroup,
  moveTag,
  parseCollapsed,
  parseTagList,
  parseTags,
  repoName,
  TAG_COLORS,
  tagBar,
  tagColor,
  tagOptions,
  toggleTag,
} from './labels.ts';

test('a repo is labelled by the last segment of its root', () => {
  assert.equal(repoName('/Users/me/Developer/tabsh'), 'tabsh');
  assert.equal(repoName('/Users/me/Developer/tabsh/'), 'tabsh');
  assert.equal(repoName('C:\\code\\app'), 'app');
  assert.equal(repoName('/'), '/');
});

test('a tag always gets the same color from the palette', () => {
  assert.equal(tagColor('deploy'), tagColor('deploy'));
  assert.ok(TAG_COLORS.includes(tagColor('debug')));
});

test('a typed tag is trimmed and capped, and blank means none', () => {
  assert.equal(cleanTag('  deploy '), 'deploy');
  assert.equal(cleanTag('   '), null);
  assert.equal(cleanTag('x'.repeat(40))?.length, 24);
});

test('a typed tag list is split on commas, without blanks or repeats', () => {
  assert.deepEqual(parseTagList(' bug, ui ,,bug, '), ['bug', 'ui']);
  assert.deepEqual(parseTagList('   '), []);
});

test('a typed tag joins the picked ones once, and a pasted list adds each', () => {
  assert.deepEqual(addTag(['bug'], ' ui '), ['bug', 'ui']);
  assert.deepEqual(addTag(['bug'], 'bug'), ['bug']);
  assert.deepEqual(addTag(['bug'], 'ui, bug,,docs'), ['bug', 'ui', 'docs']);
  assert.deepEqual(addTag(['bug'], '  '), ['bug']);
});

test('stored tags keep only string tags, once each, and read one tag as a list', () => {
  assert.deepEqual(parseTags({ a: ['deploy', 'deploy', ' ', 3], b: 'debug', c: 3, d: [] }), {
    a: ['deploy'],
    b: ['debug'],
  });
  assert.deepEqual(parseTags(null), {});
  assert.deepEqual(parseTags('x'), {});
});

test('toggling a tag adds it at the end or takes it away', () => {
  assert.deepEqual(toggleTag(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleTag(['a', 'b'], 'a', true), ['b', 'a']);
  assert.deepEqual(toggleTag(['a', 'b'], 'a', false), ['b']);
});

test("a tab's bar is its tag's color, or its tags' colors stacked", () => {
  assert.equal(tagBar(['deploy']), tagColor('deploy'));
  assert.equal(
    tagBar(['deploy', 'debug']),
    `linear-gradient(to bottom, ${tagColor('deploy')} 0% 50%, ${tagColor('debug')} 50% 100%)`,
  );
});

test('not grouping gives no groups', () => {
  assert.deepEqual(groupTabs([{ id: 'a', labels: { repo: 'x', tags: [] } }], 'none'), []);
});

test('by repo, groups follow the strip order and unknown repos come last', () => {
  const groups = groupTabs(
    [
      { id: 'a', labels: { repo: 'web', tags: [] } },
      { id: 'b', labels: { repo: null, tags: [] } },
      { id: 'c', labels: { repo: 'tabsh', tags: ['x'] } },
      { id: 'd', labels: { repo: 'web', tags: [] } },
    ],
    'repo',
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.value, g.ids]),
    [
      ['repo:web', 'web', ['a', 'd']],
      ['repo:tabsh', 'tabsh', ['c']],
      ['repo:', null, ['b']],
    ],
  );
});

test('by tag, a tab sits in each of its tags, and untagged tabs come last', () => {
  const groups = groupTabs(
    [
      { id: 'a', labels: { repo: 'web', tags: ['deploy', 'debug'] } },
      { id: 'b', labels: { repo: 'web', tags: [] } },
      { id: 'c', labels: { repo: null, tags: ['debug'] } },
    ],
    'tag',
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.ids]),
    [
      ['tag:deploy', ['a']],
      ['tag:debug', ['a', 'c']],
      ['tag:', ['b']],
    ],
  );
});

test('the stored collapsed groups keep only group keys', () => {
  assert.deepEqual([...parseCollapsed(['tag:work', 'repo:', 'other', 3])], ['tag:work', 'repo:']);
  assert.deepEqual([...parseCollapsed(null)], []);
});

test('a new tab joins a group through its tag or its repo, and the unlabelled group asks nothing', () => {
  assert.deepEqual(joinGroup('tag:work'), { tag: 'work', repo: null });
  assert.deepEqual(joinGroup('repo:tabsh'), { tag: null, repo: 'tabsh' });
  assert.deepEqual(joinGroup('tag:'), { tag: null, repo: null });
  assert.deepEqual(joinGroup(null), { tag: null, repo: null });
});

test('a tab dragged between tag groups trades the tag it was dragged by for the target', () => {
  assert.deepEqual(moveTag(['red'], 'red', 'blue'), ['blue']);
  assert.deepEqual(moveTag(['red', 'blue'], 'blue', 'green'), ['red', 'green']);
  assert.deepEqual(moveTag(['red', 'blue'], 'red', 'blue'), ['blue']); // already there: once
  assert.deepEqual(moveTag([], null, 'red'), ['red']); // out of the untagged group
  assert.deepEqual(moveTag(['red', 'blue'], 'red', null), ['blue']); // into it: loses only that tag
});

test('the tag list offers every tag, picked ones checked, filtered by what is typed', () => {
  const used = ['deploy', 'Bug', 'ui'];
  assert.deepEqual(tagOptions(used, ['ui', 'new'], ''), [
    { tag: 'Bug', on: false, create: false },
    { tag: 'deploy', on: false, create: false },
    { tag: 'new', on: true, create: false },
    { tag: 'ui', on: true, create: false },
  ]);
  assert.deepEqual(tagOptions(used, [], ' U '), [
    { tag: 'U', on: false, create: true },
    { tag: 'Bug', on: false, create: false },
    { tag: 'ui', on: false, create: false },
  ]);
});

test('a typed tag that is already there, in any case, is not offered to create', () => {
  assert.deepEqual(tagOptions(['Bug'], [], 'bug'), [{ tag: 'Bug', on: false, create: false }]);
  assert.deepEqual(tagOptions([], [], 'perf'), [{ tag: 'perf', on: false, create: true }]);
  assert.deepEqual(tagOptions([], [], '   '), []);
});
