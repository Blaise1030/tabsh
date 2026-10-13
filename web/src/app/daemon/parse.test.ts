import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepsTokenInAddress, parseToken } from './parse.ts';

test('keepsTokenInAddress only on another device reaching the daemon by IP', () => {
  for (const host of ['100.86.117.9', '192.168.1.2', '[fd7a:115c:a1e0::1]']) {
    assert.equal(keepsTokenInAddress(host), true, host);
  }
  for (const host of [
    'tabsh.cc',
    'localhost',
    'tabsh.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '[::1]',
    '[::ffff:127.0.0.1]',
  ]) {
    assert.equal(keepsTokenInAddress(host), false, host);
  }
});

test('parseToken accepts a pairing link, a fragment or a bare token', () => {
  const t = 'a'.repeat(32);
  assert.equal(parseToken(`https://tabsh.cc/app/#token=${t}`), t);
  assert.equal(parseToken(`#token=${t}`), t);
  assert.equal(parseToken(`  ${t.toUpperCase()}  `), t.toUpperCase());
  assert.equal(parseToken('a'.repeat(31)), null);
  assert.equal(parseToken('hello'), null);
});
