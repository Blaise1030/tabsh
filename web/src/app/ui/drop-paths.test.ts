import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localPaths, shellQuote } from './drop-paths.ts';

test('shellQuote leaves plain paths and quotes the rest', () => {
  assert.equal(shellQuote('/tmp/a.png'), '/tmp/a.png');
  assert.equal(shellQuote('/tmp/my file.png'), `'/tmp/my file.png'`);
  assert.equal(shellQuote(`/tmp/it's.png`), `'/tmp/it'\\''s.png'`);
});
test('localPaths keeps file URLs only, decoded', () => {
  assert.deepEqual(localPaths('file:///Users/a/My%20Shot.png\r\nhttps://x.y/z\nfile:///b'), [
    '/Users/a/My Shot.png',
    '/b',
  ]);
  assert.deepEqual(localPaths(''), []);
});
