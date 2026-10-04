import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToken } from './parse.ts';

test('parseToken accepts a pairing link, a fragment or a bare token', () => {
  const t = 'a'.repeat(32);
  assert.equal(parseToken(`https://tabsh.cc/app/#token=${t}`), t);
  assert.equal(parseToken(`#token=${t}`), t);
  assert.equal(parseToken(`  ${t.toUpperCase()}  `), t.toUpperCase());
  assert.equal(parseToken('a'.repeat(31)), null);
  assert.equal(parseToken('hello'), null);
});
