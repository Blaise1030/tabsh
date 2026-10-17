import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bellsWhen } from './bells.ts';

test('a bell is skipped only for the terminal on screen in a focused window', () => {
  const looking = { onScreen: true, windowFocused: true, documentHidden: false };
  assert.equal(bellsWhen(looking), false);
  // Its card, while a side terminal is what's on screen.
  assert.equal(bellsWhen({ ...looking, onScreen: false }), true);
  // A side terminal of the active card, while the card's agent is on screen.
  assert.equal(bellsWhen({ ...looking, onScreen: false }), true);
  assert.equal(bellsWhen({ ...looking, windowFocused: false }), true);
  assert.equal(bellsWhen({ ...looking, documentHidden: true }), true);
});
