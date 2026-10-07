import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandHome, foldersUrl, moveActive, tildify } from './folders.ts';

test('a folder under home is shown with ~', () => {
  assert.equal(tildify('/Users/jo/code/tabsh', '/Users/jo'), '~/code/tabsh');
  assert.equal(tildify('/Users/jo', '/Users/jo'), '~');
  assert.equal(tildify('/Users/joe/x', '/Users/jo'), '/Users/joe/x');
  assert.equal(tildify('/tmp/x', '/Users/jo'), '/tmp/x');
  assert.equal(tildify('/tmp/x', null), '/tmp/x');
});

test('~ is expanded with the home folder when it is known', () => {
  assert.equal(expandHome('~/code', '/Users/jo'), '/Users/jo/code');
  assert.equal(expandHome('~', '/Users/jo'), '/Users/jo');
  assert.equal(expandHome('~/code', null), '~/code');
  assert.equal(expandHome('/tmp', '/Users/jo'), '/tmp');
  assert.equal(expandHome('~bob/x', '/Users/jo'), '~bob/x');
});

test('the highlight wraps around the list', () => {
  assert.equal(moveActive(0, 1, 3), 1);
  assert.equal(moveActive(2, 1, 3), 0);
  assert.equal(moveActive(0, -1, 3), 2);
  assert.equal(moveActive(-1, 1, 3), 0);
  assert.equal(moveActive(-1, -1, 3), 2);
  assert.equal(moveActive(0, 1, 0), -1);
});

test('the search request carries the typed text', () => {
  assert.equal(foldersUrl('~/my code/ta'), '/api/files/folders?path=~%2Fmy%20code%2Fta');
});
