// Keybindings. Each action offers a few preset combos rather than recording
// any key, so nothing can be bound to a key the browser keeps (⌘T,
// Ctrl+Tab…) or one the shell relies on. No combo is offered for two
// actions, so they never clash. A combo is `modifier+…+code`; matching on
// `code` means Shift doesn't turn `]` into `}` first.

export type KeyId = 'keyPalette' | 'keyNextTab' | 'keyPrevTab';
export interface Keybinding {
  name: string;
  keywords: string;
  presets: string[];
}

export function keybindings(isMac: boolean): Record<KeyId, Keybinding> {
  return {
    keyPalette: {
      name: 'Open settings',
      keywords: 'command palette menu',
      presets: isMac
        ? ['meta+KeyK', 'meta+shift+KeyK', 'ctrl+shift+Space']
        : ['ctrl+shift+KeyK', 'ctrl+shift+Space', 'ctrl+shift+Semicolon'],
    },
    keyNextTab: {
      name: 'Next tab',
      keywords: 'switch cycle right forward',
      presets: [
        'ctrl+shift+BracketRight',
        'ctrl+shift+ArrowRight',
        'ctrl+shift+Period',
        ...(isMac ? ['meta+shift+ArrowRight'] : []),
      ],
    },
    keyPrevTab: {
      name: 'Previous tab',
      keywords: 'switch cycle left back',
      presets: [
        'ctrl+shift+BracketLeft',
        'ctrl+shift+ArrowLeft',
        'ctrl+shift+Comma',
        ...(isMac ? ['meta+shift+ArrowLeft'] : []),
      ],
    },
  };
}

const KEY_NAMES: Record<string, string> = {
  KeyK: 'K',
  Space: 'Space',
  Semicolon: ';',
  BracketLeft: '[',
  BracketRight: ']',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
};
const MODS = ['ctrl', 'alt', 'shift', 'meta'] as const;
const MAC_MODS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };

// `words` spells the modifiers out, for search and for non-Mac labels.
export function keyLabel(combo: string, isMac: boolean, words = !isMac): string {
  const parts = combo.split('+');
  const key = KEY_NAMES[parts.pop() ?? ''];
  const mods = MODS.filter((m) => parts.includes(m));
  const wordMods = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: isMac ? 'Cmd' : 'Meta' };
  return words ? [...mods.map((m) => wordMods[m]), key].join('+') : mods.map((m) => MAC_MODS[m]).join('') + key;
}

export function matchesKey(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  combo: string,
): boolean {
  const parts = combo.split('+');
  return (
    e.code === parts.at(-1) &&
    e.ctrlKey === parts.includes('ctrl') &&
    e.shiftKey === parts.includes('shift') &&
    e.altKey === parts.includes('alt') &&
    e.metaKey === parts.includes('meta')
  );
}
