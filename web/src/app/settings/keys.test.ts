import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keybindings, keyLabel, matchesKey } from './keys.ts';

test('keyLabel', () => {
  assert.equal(keyLabel('meta+KeyK', true), '⌘K');
  assert.equal(keyLabel('ctrl+shift+BracketRight', true), '⌃⇧]');
  assert.equal(keyLabel('ctrl+shift+BracketRight', false), 'Ctrl+Shift+]');
  assert.equal(keyLabel('meta+KeyK', true, true), 'Cmd+K');
});
test('matchesKey compares code and every modifier', () => {
  const e = { code: 'KeyK', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
  assert.ok(matchesKey(e, 'meta+KeyK'));
  assert.ok(!matchesKey({ ...e, shiftKey: true }, 'meta+KeyK'));
  assert.ok(!matchesKey(e, 'ctrl+KeyK'));
});
test('presets differ by platform and never repeat across actions', () => {
  for (const mac of [true, false]) {
    const all = Object.values(keybindings(mac)).flatMap((k) => k.presets);
    assert.equal(new Set(all).size, all.length);
  }
  assert.equal(keybindings(true).keyPalette.presets[0], 'meta+KeyK');
  assert.equal(keybindings(false).keyPalette.presets[0], 'ctrl+shift+KeyK');
});
