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
