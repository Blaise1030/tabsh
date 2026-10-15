import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linesFor, MAX_FONT, MIN_FONT, pinchFont, spanBetween, wordAt } from './gestures.ts';

test('a pinch scales the font by the fingers’ spread, within bounds', () => {
  assert.equal(pinchFont(14, 100, 100), 14);
  assert.equal(pinchFont(14, 100, 50), MIN_FONT);
  assert.equal(MIN_FONT, 11, 'a phone keeps a readable floor');
  assert.equal(pinchFont(12, 100, 125), 15);
  assert.equal(pinchFont(20, 100, 300), MAX_FONT);
  assert.equal(pinchFont(14, 0, 50), MAX_FONT, 'a zero start gap does not divide by zero');
});

test('travel becomes whole lines, the rest carried over', () => {
  assert.deepEqual(linesFor(10, 16), [0, 10]);
  assert.deepEqual(linesFor(40, 16), [2, 8]);
  assert.deepEqual(linesFor(-40, 16), [-2, -8]);
});

test('the word under a column runs between blanks', () => {
  const line = 'git commit -m fix  ';
  assert.deepEqual(wordAt(line, 0), [0, 3]);
  assert.deepEqual(wordAt(line, 6), [4, 6]);
  assert.deepEqual(wordAt(line, 11), [11, 2]);
  assert.equal(wordAt(line, 3), null);
  assert.equal(wordAt(line, 40), null);
});

test('a span selects inclusively, in either direction, across rows', () => {
  assert.deepEqual(spanBetween({ col: 2, row: 5 }, { col: 6, row: 5 }, 80), [2, 5, 5]);
  assert.deepEqual(spanBetween({ col: 6, row: 5 }, { col: 2, row: 5 }, 80), [2, 5, 5]);
  assert.deepEqual(spanBetween({ col: 70, row: 1 }, { col: 3, row: 2 }, 80), [70, 1, 14]);
  assert.deepEqual(spanBetween({ col: 3, row: 2 }, { col: 70, row: 1 }, 80), [70, 1, 14]);
});
