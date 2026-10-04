// The settings stored on the daemon, and how a stored object is cleaned up.
import { FONT_SIZES, FONTS, THEMES, TYPING_SOUNDS } from './catalog.ts';
import { comboProblem, type KeyId, keybindings } from './keys.ts';

export interface Settings {
  theme: string;
  font: string;
  fontSize: number;
  typingSound: string;
  paneWidth: number;
  keyPalette: string;
  keyNextTab: string;
  keyPrevTab: string;
}

export function defaults(isMac: boolean): Settings {
  const keys = keybindings(isMac);
  return {
    theme: 'tabsh',
    font: 'menlo',
    fontSize: 13,
    typingSound: 'mx-black-pbt',
    paneWidth: 0.5,
    keyPalette: keys.keyPalette.presets[0],
    keyNextTab: keys.keyNextTab.presets[0],
    keyPrevTab: keys.keyPrevTab.presets[0],
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
  const chosen: Record<KeyId, string> = { keyPalette: '', keyNextTab: '', keyPrevTab: '' };
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
    keyPalette: key('keyPalette'),
    keyNextTab: key('keyNextTab'),
    keyPrevTab: key('keyPrevTab'),
  };
}
