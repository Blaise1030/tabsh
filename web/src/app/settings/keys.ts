// Keybindings. Each action offers a few preset combos, and any other combo
// can be recorded as long as `comboProblem` allows it: nothing bound to a
// key the browser keeps (⌘T, Ctrl+Tab…) or one the shell relies on, and no
// combo for two actions, so they never clash. A combo is
// `modifier+…+code`; matching on `code` means Shift doesn't turn `]` into
// `}` first.

export type KeyId =
  | 'keyPalette'
  | 'keyNextTab'
  | 'keyPrevTab'
  | 'keyToggleExplorer'
  | 'keySearchFiles'
  | 'keyGroupTabs'
  | 'keyToggleBoard'
  | 'keyNewCard'
  | 'keyBack'
  | 'keyForward';
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
    keyToggleExplorer: {
      name: 'Toggle file explorer',
      keywords: 'files sidebar tree folders project',
      presets: isMac ? ['meta+shift+KeyE', 'ctrl+shift+KeyE'] : ['ctrl+shift+KeyE', 'alt+shift+KeyE'],
    },
    keySearchFiles: {
      name: 'Search files',
      keywords: 'find filter name tree explorer sidebar',
      presets: isMac ? ['meta+shift+KeyF', 'ctrl+shift+KeyF'] : ['ctrl+shift+KeyF', 'alt+shift+KeyF'],
    },
    keyGroupTabs: {
      name: 'Group tabs',
      keywords: 'group filter tags repos projects collapse',
      presets: isMac ? ['meta+shift+KeyY', 'ctrl+shift+KeyY'] : ['ctrl+shift+KeyY', 'alt+shift+KeyY'],
    },
    keyToggleBoard: {
      name: 'Toggle board',
      keywords: 'kanban cards tasks overview status list layout',
      presets: isMac ? ['meta+KeyB', 'meta+shift+KeyB'] : ['ctrl+shift+KeyB', 'alt+shift+KeyB'],
    },
    // ⌘N and ⌘⇧N belong to the browser; ⌃⇧N is the terminal's on other systems.
    keyNewCard: {
      name: 'New card',
      keywords: 'create add kanban board issue prompt',
      presets: isMac ? ['meta+shift+KeyC', 'ctrl+shift+KeyN'] : ['alt+shift+KeyN', 'ctrl+shift+KeyO'],
    },
    // ⌃- is readline's undo, so the Mac default is ⌃⇧-.
    keyBack: {
      name: 'Go back',
      keywords: 'history previous last navigate',
      presets: isMac ? ['ctrl+shift+Minus', 'meta+BracketLeft'] : ['alt+shift+ArrowLeft', 'ctrl+alt+shift+ArrowLeft'],
    },
    keyForward: {
      name: 'Go forward',
      keywords: 'history next navigate',
      presets: isMac
        ? ['ctrl+shift+Equal', 'meta+BracketRight']
        : ['alt+shift+ArrowRight', 'ctrl+alt+shift+ArrowRight'],
    },
  };
}

// Keys a combo can end with, besides letters, digits and F1–F12.
const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};
const MODS = ['ctrl', 'alt', 'shift', 'meta'] as const;
const MAC_MODS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
// The order modifiers are written in a combo (labels use MODS'), so the
// same keys always make the same string.
const COMBO_ORDER = ['ctrl', 'meta', 'alt', 'shift'] as const;

function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$|^Digit[0-9]$/.test(code)) return code.slice(-1);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return KEY_NAMES[code];
}

// `words` spells the modifiers out, for search and for non-Mac labels.
export function keyLabel(combo: string, isMac: boolean, words = !isMac): string {
  const parts = combo.split('+');
  const key = keyName(parts.pop() ?? '') ?? '?';
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

type KeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

// The combo a key press makes, or null for a lone modifier (still being held).
export function comboFromEvent(e: KeyEvent): string | null {
  if (/^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(e.code)) return null;
  const mods = COMBO_ORDER.filter((m) => e[`${m}Key`]);
  return [...mods, e.code].join('+');
}

// Combos the page sees but that belong to the browser, the OS or the
// terminal's copy and paste. (⌘T, ⌘W, Ctrl+Tab and the like never reach
// the page, so they can't be recorded at all.)
const RESERVED_MAC = new Set([
  ...'ACVXZQWTNHMRLFPS'.split('').map((k) => `meta+Key${k}`),
  'meta+shift+KeyZ',
  'meta+shift+KeyT',
  'meta+shift+KeyN',
  'meta+shift+KeyW',
  'meta+alt+KeyI',
  'meta+alt+KeyJ',
  ...'123456789'.split('').map((d) => `meta+Digit${d}`),
]);
const RESERVED_OTHER = new Set('CVITNWJRPQ'.split('').map((k) => `ctrl+shift+Key${k}`));

// Why `combo` can't be bound to `id`, or null if it can. `saved` holds
// every action's current combo.
export function comboProblem(combo: string, id: KeyId, saved: Record<KeyId, string>, isMac: boolean): string | null {
  const parts = combo.split('+');
  const code = parts.pop() ?? '';
  if (!keyName(code)) return "That key can't be used in a shortcut";
  if (parts.some((p) => !MODS.includes(p as (typeof MODS)[number]))) return "That key can't be used in a shortcut";
  const has = (m: string) => parts.includes(m);
  if (has('meta') && !isMac) return 'The Windows key belongs to the system';
  // Ctrl+letter and Alt+letter are the shell's own (Ctrl-C, Alt-B…).
  if (!has('meta') && !(has('shift') && (has('ctrl') || has('alt')))) {
    return isMac ? 'Add ⌘, or Shift with ⌃ or ⌥' : 'Add Shift with Ctrl or Alt';
  }
  if ((isMac ? RESERVED_MAC : RESERVED_OTHER).has(combo)) return 'Your browser or terminal already uses that';
  const names = keybindings(isMac);
  for (const other of Object.keys(names) as KeyId[]) {
    if (other !== id && saved[other] === combo) return `Already used by ${names[other].name}`;
  }
  return null;
}
