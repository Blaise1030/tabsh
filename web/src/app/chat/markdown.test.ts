import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeHref, transformLinkUri } from './markdown.ts';

test('safeHref allows http(s) and relative, rejects javascript', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('http://example.com'), 'http://example.com');
  assert.equal(safeHref('/docs'), '/docs');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref(''), null);
});

test('transformLinkUri drops unsafe schemes for solid-markdown', () => {
  assert.equal(transformLinkUri('https://ok.example'), 'https://ok.example');
  assert.equal(transformLinkUri('javascript:alert(1)'), '');
});
