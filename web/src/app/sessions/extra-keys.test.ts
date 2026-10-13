import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyInput, withCtrl } from './extra-keys.ts';

test('Esc and Tab type their control codes', () => {
  assert.equal(keyInput('esc', false), '\x1b');
  assert.equal(keyInput('tab', true), '\t');
});

test('Enter is a carriage return and Space a space', () => {
  assert.equal(keyInput('enter', false), '\r');
  assert.equal(keyInput('space', true), ' ');
});

test('a symbol types itself', () => {
  assert.equal(keyInput('|', true), '|');
  assert.equal(keyInput('~', false), '~');
});

test('arrows follow the cursor-key mode', () => {
  assert.equal(keyInput('up', false), '\x1b[A');
  assert.equal(keyInput('left', false), '\x1b[D');
  assert.equal(keyInput('down', true), '\x1bOB');
  assert.equal(keyInput('right', true), '\x1bOC');
});

test('Ctrl turns a letter, either case, into its control code', () => {
  assert.equal(withCtrl('c'), '\x03');
  assert.equal(withCtrl('C'), '\x03');
  assert.equal(withCtrl('a'), '\x01');
  assert.equal(withCtrl('['), '\x1b');
  assert.equal(withCtrl(' '), '\x00');
  assert.equal(withCtrl('?'), '\x7f');
});

test('Ctrl leaves other input alone', () => {
  assert.equal(withCtrl('1'), '1');
  assert.equal(withCtrl('ab'), 'ab');
  assert.equal(withCtrl('\x1b[A'), '\x1b[A');
});
