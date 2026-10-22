import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordJumpSequence } from './keys.ts';

const mods = (over: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

test('mac Option+Arrow becomes Ctrl+Arrow for the shell', () => {
  assert.equal(wordJumpSequence('ArrowLeft', mods(), true), '\x1b[1;5D');
  assert.equal(wordJumpSequence('ArrowRight', mods(), true), '\x1b[1;5C');
});

test('the mapping needs bare Option on a Mac', () => {
  assert.equal(wordJumpSequence('ArrowLeft', mods(), false), null);
  assert.equal(wordJumpSequence('ArrowLeft', mods({ altKey: false }), true), null);
  assert.equal(wordJumpSequence('ArrowLeft', mods({ ctrlKey: true }), true), null);
  assert.equal(wordJumpSequence('ArrowLeft', mods({ metaKey: true }), true), null);
  assert.equal(wordJumpSequence('a', mods(), true), null);
});
