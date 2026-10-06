import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanTag,
  filterKey,
  filterOptions,
  isSingleFilter,
  matches,
  parseTags,
  repoName,
  TAG_COLORS,
  tagBar,
  tagColor,
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

test('the filter offers each repo and tag once, with its tab count', () => {
  const opts = filterOptions([
    { repo: 'tabsh', tags: ['deploy', 'debug'] },
    { repo: 'tabsh', tags: [] },
    { repo: 'web', tags: ['deploy'] },
  ]);
  assert.deepEqual(
    opts.map((o) => [filterKey(o.filter), o.count]),
    [
      ['repo:tabsh', 2],
      ['repo:web', 1],
      ['tag:debug', 1],
      ['tag:deploy', 2],
    ],
  );
});

test('the palette marks an item current only when it is the one filter checked, or none for all tabs', () => {
  assert.ok(isSingleFilter(new Set(), null));
  assert.ok(!isSingleFilter(new Set(['repo:tabsh']), null));
  assert.ok(isSingleFilter(new Set(['repo:tabsh']), 'repo:tabsh'));
  assert.ok(!isSingleFilter(new Set(['repo:tabsh', 'tag:deploy']), 'repo:tabsh'));
  assert.ok(!isSingleFilter(new Set(['tag:deploy']), 'repo:tabsh'));
});

test('a tab shows when nothing is checked, or when any checked filter fits it', () => {
  const labels = { repo: 'tabsh', tags: ['deploy', 'debug'] };
  assert.ok(matches(new Set(), labels));
  assert.ok(matches(new Set(['repo:tabsh']), labels));
  assert.ok(matches(new Set(['repo:other', 'tag:debug']), labels));
  assert.ok(!matches(new Set(['repo:other']), labels));
  assert.ok(!matches(new Set(['tag:deploy']), { repo: 'tabsh', tags: [] }));
});
