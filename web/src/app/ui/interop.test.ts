import assert from 'node:assert/strict';
import { test } from 'node:test';
import van from 'vanjs-core';
import { fromVan } from './interop.ts';

test('fromVan follows a VanJS state', () => {
  const s = van.state('a');
  const read = fromVan(s);
  assert.equal(read(), 'a');
  s.val = 'b';
  assert.equal(read(), 'b');
});

test('fromVan shares one mirror per state', () => {
  const s = van.state(1);
  assert.equal(fromVan(s), fromVan(s));
});
