import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSettings, defaults } from './schema.ts';

test('cleanSettings keeps valid values and drops unknown ones', () => {
  const d = defaults(true);
  assert.deepEqual(cleanSettings({}, true), d);
  assert.equal(cleanSettings({ theme: 'nord' }, true).theme, 'nord');
  assert.equal(cleanSettings({ theme: 'gone' }, true).theme, 'tabsh');
  assert.equal(cleanSettings({ theme: 'webterm' }, true).theme, 'tabsh');
  assert.equal(cleanSettings({ fontSize: 17 }, true).fontSize, 13);
  assert.equal(cleanSettings({ paneWidth: 0.9 }, true).paneWidth, 0.5);
  assert.equal(cleanSettings({ paneWidth: 0.3 }, true).paneWidth, 0.3);
  assert.equal(cleanSettings({ typingSound: 'off' }, true).typingSound, 'off');
});
test('a keybinding saved on another OS falls back to this OS default', () => {
  assert.equal(cleanSettings({ keyPalette: 'meta+KeyK' }, false).keyPalette, 'ctrl+shift+KeyK');
  assert.equal(cleanSettings({ keyPalette: 'meta+shift+KeyK' }, true).keyPalette, 'meta+shift+KeyK');
});
test('a recorded keybinding is kept if it is still allowed and free', () => {
  assert.equal(cleanSettings({ keyPalette: 'meta+KeyY' }, true).keyPalette, 'meta+KeyY');
  assert.equal(cleanSettings({ keyNextTab: 'ctrl+shift+KeyY' }, false).keyNextTab, 'ctrl+shift+KeyY');
  assert.equal(cleanSettings({ keyPalette: 'ctrl+KeyC' }, true).keyPalette, 'meta+KeyK');
  // Two actions on one combo: the later one gives way.
  const s = cleanSettings({ keyPalette: 'ctrl+shift+BracketRight' }, true);
  assert.equal(s.keyPalette, 'ctrl+shift+BracketRight');
  assert.equal(s.keyNextTab, 'ctrl+shift+ArrowRight');
});
