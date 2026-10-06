import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comboFromEvent, comboProblem, keybindings, keyLabel, matchesKey } from './keys.ts';

test('keyLabel', () => {
  assert.equal(keyLabel('meta+KeyK', true), '⌘K');
  assert.equal(keyLabel('ctrl+shift+BracketRight', true), '⌃⇧]');
  assert.equal(keyLabel('ctrl+shift+BracketRight', false), 'Ctrl+Shift+]');
  assert.equal(keyLabel('meta+KeyK', true, true), 'Cmd+K');
  assert.equal(keyLabel('ctrl+shift+Digit5', false), 'Ctrl+Shift+5');
  assert.equal(keyLabel('meta+alt+F7', true), '⌥⌘F7');
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

const press = (code: string, mods: string[] = []) => ({
  code,
  ctrlKey: mods.includes('ctrl'),
  shiftKey: mods.includes('shift'),
  altKey: mods.includes('alt'),
  metaKey: mods.includes('meta'),
});
test('comboFromEvent writes presets the way they are spelled', () => {
  assert.equal(comboFromEvent(press('ShiftLeft', ['shift'])), null);
  assert.equal(comboFromEvent(press('MetaRight', ['meta'])), null);
  for (const mac of [true, false]) {
    for (const k of Object.values(keybindings(mac))) {
      for (const combo of k.presets) {
        const parts = combo.split('+');
        assert.equal(comboFromEvent(press(parts.pop() as string, parts)), combo);
      }
    }
  }
});
test('comboProblem allows only combos the shell and browser leave free', () => {
  const mac = keybindings(true);
  const saved = {
    keyPalette: 'meta+KeyK',
    keyNextTab: 'ctrl+shift+BracketRight',
    keyPrevTab: 'ctrl+shift+BracketLeft',
    keyToggleExplorer: 'meta+shift+KeyE',
    keySearchFiles: 'meta+shift+KeyF',
    keyFilterTabs: 'meta+shift+KeyY',
  };
  const ok = (combo: string, isMac = true) => comboProblem(combo, 'keyPalette', saved, isMac) === null;
  assert.ok(ok('meta+KeyY'));
  assert.ok(ok('ctrl+shift+KeyY'));
  assert.ok(ok('meta+shift+Digit5'));
  assert.ok(ok('alt+shift+F7', false));
  assert.ok(!ok('ctrl+KeyC')); // the shell's
  assert.ok(!ok('alt+KeyB')); // the shell's
  assert.ok(!ok('shift+KeyA')); // typing
  assert.ok(!ok('KeyA'));
  assert.ok(!ok('meta+KeyC')); // copy
  assert.ok(!ok('meta+Digit1')); // browser tab
  assert.ok(!ok('ctrl+shift+KeyC', false)); // terminal copy
  assert.ok(!ok('meta+shift+KeyY', false)); // the Windows key
  assert.ok(!ok('meta+Enter'));
  assert.equal(
    comboProblem('ctrl+shift+BracketRight', 'keyPalette', saved, true),
    `Already used by ${mac.keyNextTab.name}`,
  );
  // Rebinding an action to its own combo is fine.
  assert.equal(comboProblem('ctrl+shift+BracketRight', 'keyNextTab', saved, true), null);
});
test('every preset passes comboProblem', () => {
  for (const mac of [true, false]) {
    const k = keybindings(mac);
    const saved = {
      keyPalette: '',
      keyNextTab: '',
      keyPrevTab: '',
      keyToggleExplorer: '',
      keySearchFiles: '',
      keyFilterTabs: '',
    };
    for (const id of Object.keys(k) as (keyof typeof k)[]) {
      for (const combo of k[id].presets) assert.equal(comboProblem(combo, id, saved, mac), null, combo);
    }
  }
});
test('toggling the explorer has a default combo that no other action shares', () => {
  for (const mac of [true, false]) {
    const k = keybindings(mac);
    const [first] = k.keyToggleExplorer.presets;
    assert.equal(first, mac ? 'meta+shift+KeyE' : 'ctrl+shift+KeyE');
    for (const [id, other] of Object.entries(k)) {
      if (id !== 'keyToggleExplorer') assert.ok(!other.presets.includes(first), id);
    }
  }
});
test('searching files has a default combo that no other action shares', () => {
  for (const mac of [true, false]) {
    const k = keybindings(mac);
    const [first] = k.keySearchFiles.presets;
    assert.equal(first, mac ? 'meta+shift+KeyF' : 'ctrl+shift+KeyF');
    for (const [id, other] of Object.entries(k)) {
      if (id !== 'keySearchFiles') assert.ok(!other.presets.includes(first), id);
    }
  }
});
test('filtering tabs has a default combo that no other action shares', () => {
  for (const mac of [true, false]) {
    const k = keybindings(mac);
    const [first] = k.keyFilterTabs.presets;
    assert.equal(first, mac ? 'meta+shift+KeyY' : 'ctrl+shift+KeyY');
    for (const [id, other] of Object.entries(k)) {
      if (id !== 'keyFilterTabs') assert.ok(!other.presets.includes(first), id);
    }
  }
});
