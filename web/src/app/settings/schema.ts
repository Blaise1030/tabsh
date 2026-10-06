// The settings stored on the daemon, and how a stored object is cleaned up.
import { FONT_SIZES, FONTS, THEMES, TYPING_SOUNDS } from './catalog.ts';
import { comboProblem, type KeyId, keybindings } from './keys.ts';

// The explorer sidebar's width, in px.
export const EXPLORER_WIDTH = { min: 200, max: 640, default: 260 };

export interface Settings {
  theme: string;
  font: string;
  fontSize: number;
  typingSound: string;
  paneWidth: number;
  explorerOpen: boolean;
  explorerWidth: number; // px
  keyPalette: string;
  keyNextTab: string;
  keyPrevTab: string;
  keyToggleExplorer: string;
  keySearchFiles: string;
  keyFilterTabs: string;
}

export function defaults(isMac: boolean): Settings {
  const keys = keybindings(isMac);
  return {
    theme: 'tabsh',
    font: 'menlo',
    fontSize: 13,
    typingSound: 'mx-black-pbt',
    paneWidth: 0.5,
    explorerOpen: false,
    explorerWidth: EXPLORER_WIDTH.default,
    keyPalette: keys.keyPalette.presets[0],
    keyNextTab: keys.keyNextTab.presets[0],
    keyPrevTab: keys.keyPrevTab.presets[0],
    keyToggleExplorer: keys.keyToggleExplorer.presets[0],
    keySearchFiles: keys.keySearchFiles.presets[0],
    keyFilterTabs: keys.keyFilterTabs.presets[0],
  };
}

// Drops unknown values (e.g. a theme removed in a later version).
export function cleanSettings(stored: Record<string, unknown>, isMac: boolean): Settings {
  const d = defaults(isMac);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const theme = str(stored.theme);
  // A combo this OS can't use (e.g. one saved from another OS's browser),
  // or one an earlier action already has, gives way to a free preset.
  const keys = keybindings(isMac);
  const chosen: Record<KeyId, string> = {
    keyPalette: '',
    keyNextTab: '',
    keyPrevTab: '',
    keyToggleExplorer: '',
    keySearchFiles: '',
    keyFilterTabs: '',
  };
  const key = (id: KeyId) => {
    const want = str(stored[id]);
    const free = (c: string) => comboProblem(c, id, chosen, isMac) === null;
    chosen[id] = free(want) ? want : free(d[id]) ? d[id] : (keys[id].presets.find(free) ?? d[id]);
    return chosen[id];
  };
  return {
    theme: THEMES[theme] ? theme : theme === 'webterm' ? 'tabsh' : d.theme,
    font: FONTS[str(stored.font)] ? str(stored.font) : d.font,
    fontSize:
      typeof stored.fontSize === 'number' && FONT_SIZES.includes(stored.fontSize) ? stored.fontSize : d.fontSize,
    typingSound: TYPING_SOUNDS[str(stored.typingSound)] ? str(stored.typingSound) : d.typingSound,
    paneWidth:
      typeof stored.paneWidth === 'number' && stored.paneWidth >= 0.2 && stored.paneWidth <= 0.8
        ? stored.paneWidth
        : d.paneWidth,
    explorerOpen: typeof stored.explorerOpen === 'boolean' ? stored.explorerOpen : d.explorerOpen,
    explorerWidth:
      typeof stored.explorerWidth === 'number' &&
      stored.explorerWidth >= EXPLORER_WIDTH.min &&
      stored.explorerWidth <= EXPLORER_WIDTH.max
        ? stored.explorerWidth
        : d.explorerWidth,
    keyPalette: key('keyPalette'),
    keyNextTab: key('keyNextTab'),
    keyPrevTab: key('keyPrevTab'),
    keyToggleExplorer: key('keyToggleExplorer'),
    keySearchFiles: key('keySearchFiles'),
    keyFilterTabs: key('keyFilterTabs'),
  };
}
