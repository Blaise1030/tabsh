import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSettings, defaults, EXPLORER_WIDTH } from './schema.ts';

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
test('the explorer is closed at a default width, and a stored state is kept if valid', () => {
  const d = defaults(true);
  assert.equal(d.explorerOpen, false);
  assert.equal(d.explorerWidth, EXPLORER_WIDTH.default);
  assert.equal(cleanSettings({ explorerOpen: true }, true).explorerOpen, true);
  assert.equal(cleanSettings({ explorerOpen: 'yes' }, true).explorerOpen, false);
  assert.equal(cleanSettings({ explorerWidth: 300 }, true).explorerWidth, 300);
  assert.equal(cleanSettings({ explorerWidth: EXPLORER_WIDTH.min }, true).explorerWidth, EXPLORER_WIDTH.min);
  assert.equal(cleanSettings({ explorerWidth: EXPLORER_WIDTH.max }, true).explorerWidth, EXPLORER_WIDTH.max);
  assert.equal(cleanSettings({ explorerWidth: EXPLORER_WIDTH.min - 1 }, true).explorerWidth, d.explorerWidth);
  assert.equal(cleanSettings({ explorerWidth: EXPLORER_WIDTH.max + 1 }, true).explorerWidth, d.explorerWidth);
  assert.equal(cleanSettings({ explorerWidth: '300' }, true).explorerWidth, d.explorerWidth);
});
test('toggling the explorer defaults to its own combo', () => {
  assert.equal(defaults(true).keyToggleExplorer, 'meta+shift+KeyE');
  assert.equal(cleanSettings({ keyToggleExplorer: 'ctrl+shift+KeyE' }, false).keyToggleExplorer, 'ctrl+shift+KeyE');
});
test('searching files defaults to its own combo', () => {
  assert.equal(defaults(true).keySearchFiles, 'meta+shift+KeyF');
  assert.equal(defaults(false).keySearchFiles, 'ctrl+shift+KeyF');
  assert.equal(cleanSettings({ keySearchFiles: 'alt+shift+KeyF' }, false).keySearchFiles, 'alt+shift+KeyF');
  // A combo another action already has gives way to a free preset.
  assert.equal(
    cleanSettings({ keyToggleExplorer: 'ctrl+shift+KeyF', keySearchFiles: 'ctrl+shift+KeyF' }, false).keySearchFiles,
    'alt+shift+KeyF',
  );
});
test('grouping tabs defaults to its own combo', () => {
  assert.equal(defaults(true).keyGroupTabs, 'meta+shift+KeyY');
  assert.equal(defaults(false).keyGroupTabs, 'ctrl+shift+KeyY');
  assert.equal(cleanSettings({ keyGroupTabs: 'alt+shift+KeyY' }, false).keyGroupTabs, 'alt+shift+KeyY');
});

test('tab grouping is none, repo or tag, and none by default', () => {
  assert.equal(defaults(true).tabGrouping, 'none');
  assert.equal(cleanSettings({ tabGrouping: 'tag' }, true).tabGrouping, 'tag');
  assert.equal(cleanSettings({ tabGrouping: 'repo' }, true).tabGrouping, 'repo');
  assert.equal(cleanSettings({ tabGrouping: 'folder' }, true).tabGrouping, 'none');
});

test('agent commands are kept as a short list of strings', () => {
  assert.deepEqual(defaults(true).agentCommands, ['claude {prompt}']);
  assert.deepEqual(cleanSettings({ agentCommands: ['codex', 3, '', 'codex'] }, true).agentCommands, ['codex']);
  assert.deepEqual(cleanSettings({ agentCommands: 'nope' }, true).agentCommands, ['claude {prompt}']);
});
