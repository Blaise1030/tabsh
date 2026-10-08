import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSettings, DEFAULT_PROVIDERS, defaults, EXPLORER_WIDTH, providerNameProblem } from './schema.ts';

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
  assert.equal(cleanSettings({ needsInputSound: 'pop' }, true).needsInputSound, 'pop');
  assert.equal(cleanSettings({ completedSound: 'off' }, true).completedSound, 'off');
  assert.equal(cleanSettings({ completedSound: 'gone' }, true).completedSound, d.completedSound);
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
  assert.deepEqual(defaults(true).providers, DEFAULT_PROVIDERS);
  assert.equal(defaults(true).agentProvider, 'Claude Code');
});
test('the board shows its setup screen until it is marked as onboarded', () => {
  assert.equal(defaults(true).boardOnboarded, false);
  assert.equal(cleanSettings({ boardOnboarded: true }, true).boardOnboarded, true);
  assert.equal(cleanSettings({ boardOnboarded: 'yes' }, true).boardOnboarded, false);
});
test('cleanSettings fills keyBack and keyForward', () => {
  assert.equal(cleanSettings({}, true).keyBack, 'ctrl+shift+Minus');
  assert.equal(cleanSettings({}, true).keyForward, 'ctrl+shift+Equal');
  assert.equal(cleanSettings({}, false).keyBack, 'alt+shift+ArrowLeft');
  // A stored combo another action holds gives way to a free preset.
  const s = cleanSettings({ keyBack: 'meta+KeyK' }, true);
  assert.notEqual(s.keyBack, s.keyPalette);
  assert.equal(s.keyBack, 'ctrl+shift+Minus');
});
test('providers are cleaned: named, with a command, names unique', () => {
  const s = cleanSettings(
    {
      providers: [
        { name: ' Mine ', command: ' my-agent {prompt} ', resume: 'my-agent -r {session}' },
        { name: 'Mine', command: 'other' },
        { name: '', command: 'x' },
        { name: 'No command', command: '  ' },
        'junk',
        { name: 'Bare', command: 'bare', resume: 3 },
      ],
      agentProvider: 'Bare',
    },
    true,
  );
  assert.deepEqual(s.providers, [
    { name: 'Mine', command: 'my-agent {prompt}', resume: 'my-agent -r {session}' },
    { name: 'Bare', command: 'bare', resume: '' },
  ]);
  assert.equal(s.agentProvider, 'Bare');
  assert.equal(cleanSettings({ agentProvider: 'Gone' }, true).agentProvider, 'Claude Code');
  assert.deepEqual(cleanSettings({ providers: [] }, true).providers, DEFAULT_PROVIDERS);
});
test('recent agent commands from before providers become providers', () => {
  const s = cleanSettings({ agentCommands: ['aider {prompt}', 'claude {prompt}', 3, 'aider {prompt}'] }, true);
  assert.deepEqual(s.providers, [
    ...DEFAULT_PROVIDERS,
    { name: 'aider {prompt}', command: 'aider {prompt}', resume: '' },
  ]);
  assert.equal(Object.hasOwn(s, 'agentCommands'), false);
});
test('a provider name must be there and unique', () => {
  assert.equal(providerNameProblem(DEFAULT_PROVIDERS, -1, 'Aider'), null);
  assert.equal(providerNameProblem(DEFAULT_PROVIDERS, 0, ' Claude Code '), null, 'its own name');
  assert.equal(providerNameProblem(DEFAULT_PROVIDERS, -1, 'Codex'), 'Another provider has that name');
  assert.equal(providerNameProblem(DEFAULT_PROVIDERS, 1, '  '), 'A provider needs a name');
});
