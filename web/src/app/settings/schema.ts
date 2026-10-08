// The settings stored on the daemon, and how a stored object is cleaned up.
import { FONT_SIZES, FONTS, THEMES, TYPING_SOUNDS } from './catalog.ts';
import { comboProblem, type KeyId, keybindings } from './keys.ts';

// The explorer sidebar's width, in px.
export const EXPLORER_WIDTH = { min: 200, max: 640, default: 260 };

// How the tab strip groups tabs: not at all, by repo, or by tag.
export const TAB_GROUPINGS = ['none', 'repo', 'tag'] as const;
export type TabGrouping = (typeof TAB_GROUPINGS)[number];

// A coding agent the New card dialog starts: `command` with `{prompt}` for
// the card's first prompt, and `resume`, typed after tabsh restarts, with
// `{session}` for the conversation its hooks reported ('' for none).
export interface Provider {
  name: string;
  command: string;
  resume: string;
}

export const DEFAULT_PROVIDERS: Provider[] = [
  { name: 'Claude Code', command: 'claude {prompt}', resume: 'claude --resume {session}' },
  { name: 'Codex', command: 'codex {prompt}', resume: 'codex resume {session}' },
  { name: 'Gemini CLI', command: 'gemini -i {prompt}', resume: 'gemini --resume {session}' },
];

export const MAX_PROVIDERS = 12;

// Stored providers, cleaned: named, with a command, names unique. Settings
// from before providers keep their recent agent commands as providers.
function cleanProviders(stored: Record<string, unknown>): Provider[] {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (!Array.isArray(stored.providers)) {
    const old = Array.isArray(stored.agentCommands) ? stored.agentCommands.map(text) : [];
    const extra = [...new Set(old)]
      .filter((c) => c && !DEFAULT_PROVIDERS.some((p) => p.command === c))
      .map((c) => ({ name: c, command: c, resume: '' }));
    return [...DEFAULT_PROVIDERS, ...extra].slice(0, MAX_PROVIDERS);
  }
  const list: Provider[] = [];
  for (const p of stored.providers as Record<string, unknown>[]) {
    const [name, command] = [text(p?.name), text(p?.command)];
    if (!name || !command || list.some((q) => q.name === name)) continue;
    list.push({ name, command, resume: text(p.resume) });
  }
  return list.length ? list.slice(0, MAX_PROVIDERS) : DEFAULT_PROVIDERS;
}

// Why `name` can't name provider `index` of `list` (-1: a new one), or null.
export function providerNameProblem(list: Provider[], index: number, name: string): string | null {
  if (!name.trim()) return 'A provider needs a name';
  if (list.some((p, i) => i !== index && p.name === name.trim())) return 'Another provider has that name';
  return null;
}

export interface Settings {
  theme: string;
  font: string;
  fontSize: number;
  typingSound: string;
  paneWidth: number;
  drawerWidth: number; // the board's drawer, as a share of the page's width
  explorerOpen: boolean;
  explorerWidth: number; // px
  tabGrouping: TabGrouping;
  keyPalette: string;
  keyNextTab: string;
  keyPrevTab: string;
  keyToggleExplorer: string;
  keySearchFiles: string;
  keyGroupTabs: string;
  keyToggleBoard: string;
  keyBack: string;
  keyForward: string;
  providers: Provider[];
  agentProvider: string; // the provider New card offers first: the last one used
  boardOnboarded: boolean; // the board's setup screen was dealt with (set up or skipped)
}

export function defaults(isMac: boolean): Settings {
  const keys = keybindings(isMac);
  return {
    theme: 'tabsh',
    font: 'menlo',
    fontSize: 13,
    typingSound: 'mx-black-pbt',
    paneWidth: 0.5,
    drawerWidth: 0.5,
    explorerOpen: false,
    explorerWidth: EXPLORER_WIDTH.default,
    tabGrouping: 'none',
    keyPalette: keys.keyPalette.presets[0],
    keyNextTab: keys.keyNextTab.presets[0],
    keyPrevTab: keys.keyPrevTab.presets[0],
    keyToggleExplorer: keys.keyToggleExplorer.presets[0],
    keySearchFiles: keys.keySearchFiles.presets[0],
    keyGroupTabs: keys.keyGroupTabs.presets[0],
    keyToggleBoard: keys.keyToggleBoard.presets[0],
    keyBack: keys.keyBack.presets[0],
    keyForward: keys.keyForward.presets[0],
    providers: DEFAULT_PROVIDERS,
    agentProvider: DEFAULT_PROVIDERS[0].name,
    boardOnboarded: false,
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
    keyGroupTabs: '',
    keyToggleBoard: '',
    keyBack: '',
    keyForward: '',
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
    drawerWidth:
      typeof stored.drawerWidth === 'number' && stored.drawerWidth >= 0.25 && stored.drawerWidth <= 0.85
        ? stored.drawerWidth
        : d.drawerWidth,
    explorerOpen: typeof stored.explorerOpen === 'boolean' ? stored.explorerOpen : d.explorerOpen,
    explorerWidth:
      typeof stored.explorerWidth === 'number' &&
      stored.explorerWidth >= EXPLORER_WIDTH.min &&
      stored.explorerWidth <= EXPLORER_WIDTH.max
        ? stored.explorerWidth
        : d.explorerWidth,
    tabGrouping: TAB_GROUPINGS.find((g) => g === stored.tabGrouping) ?? d.tabGrouping,
    keyPalette: key('keyPalette'),
    keyNextTab: key('keyNextTab'),
    keyPrevTab: key('keyPrevTab'),
    keyToggleExplorer: key('keyToggleExplorer'),
    keySearchFiles: key('keySearchFiles'),
    keyGroupTabs: key('keyGroupTabs'),
    keyToggleBoard: key('keyToggleBoard'),
    keyBack: key('keyBack'),
    keyForward: key('keyForward'),
    ...(() => {
      const providers = cleanProviders(stored);
      const chosen = providers.find((p) => p.name === stored.agentProvider) ?? providers[0];
      return { providers, agentProvider: chosen.name };
    })(),
    boardOnboarded: stored.boardOnboarded === true,
  };
}
