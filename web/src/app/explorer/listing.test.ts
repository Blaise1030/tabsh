import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absolutePath, isDirectory, type Listing, pastedPath, shown } from './listing.ts';

const listing = (over: Partial<Listing>): Listing => ({ root: '/p', paths: [], truncated: false, ...over });

test('a listing becomes the tree it lists, directories keeping their trailing slash', () => {
  const paths = ['README.md', 'docs/', 'src/', 'src/main.rs'];
  assert.deepEqual(shown(listing({ paths })), { kind: 'tree', paths });
  assert.ok(isDirectory('docs/'));
  assert.ok(!isDirectory('src/main.rs'));
});
test('a truncated listing is a message, never a partial tree', () => {
  assert.deepEqual(shown(listing({ truncated: true })), { kind: 'too-many' });
  assert.deepEqual(shown(listing({ truncated: true, paths: ['a'] })), { kind: 'too-many' });
});
test('an empty root is its own state', () => {
  assert.deepEqual(shown(listing({})), { kind: 'empty' });
});
test("a row's absolute path is the root and its relative path", () => {
  assert.equal(absolutePath('/p', 'src/main.rs'), '/p/src/main.rs');
  assert.equal(absolutePath('/p', 'src/'), '/p/src');
  assert.equal(absolutePath('/p/', 'a.txt'), '/p/a.txt');
  assert.equal(absolutePath('/', 'a.txt'), '/a.txt');
});
test('a pasted path is shell-quoted when it needs it', () => {
  assert.equal(pastedPath('/p', 'src/main.rs'), '/p/src/main.rs');
  assert.equal(pastedPath('/my proj', 'a b.txt'), "'/my proj/a b.txt'");
  assert.equal(pastedPath('/p', "it's.txt"), `'/p/it'\\''s.txt'`);
  assert.equal(pastedPath('/p', 'ünï/日本.txt'), "'/p/ünï/日本.txt'");
  assert.equal(pastedPath('/p', '$(rm -rf).txt'), "'/p/$(rm -rf).txt'");
  assert.equal(pastedPath('/p', 'dir name/'), "'/p/dir name'");
});
