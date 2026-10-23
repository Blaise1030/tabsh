import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFileHref, parseFileHref, safeHref, transformLinkUri } from './markdown.ts';

test('safeHref allows http(s), relative, and tabsh-file; rejects javascript', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('http://example.com'), 'http://example.com');
  assert.equal(safeHref('/docs'), '/docs');
  assert.equal(safeHref(encodeFileHref('/Users/a/b.ts', 3)), encodeFileHref('/Users/a/b.ts', 3));
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref(''), null);
});

test('transformLinkUri drops unsafe schemes for solid-markdown', () => {
  assert.equal(transformLinkUri('https://ok.example'), 'https://ok.example');
  assert.equal(transformLinkUri('javascript:alert(1)'), '');
});

test('encodeFileHref / parseFileHref round-trip path and line', () => {
  const href = encodeFileHref('/Users/me/web/src/a.ts', 12);
  assert.deepEqual(parseFileHref(href), { text: '/Users/me/web/src/a.ts', line: 12 });
  assert.deepEqual(parseFileHref(encodeFileHref('web/src/a.ts')), { text: 'web/src/a.ts' });
  assert.equal(parseFileHref('https://x'), null);
});
