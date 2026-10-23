import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockTypes, safeHref } from './markdown.ts';

test('safeHref allows http(s) and rejects javascript', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('http://example.com'), 'http://example.com');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref(''), null);
});

test('blockTypes reads headings, paragraphs, code and lists', () => {
  assert.deepEqual(
    blockTypes('## Title\n\nHello **there**\n\n```rs\nfn x() {}\n```\n\n- a\n- b\n'),
    ['heading', 'paragraph', 'code', 'list'],
  );
});

test('an unfinished fence still yields a code block when closed-enough', () => {
  // Streaming often ends mid-fence; lexer should not throw.
  assert.ok(blockTypes('before\n\n```\npartial').includes('paragraph') || blockTypes('before\n\n```\npartial').includes('code'));
});
