// The settings stored on the daemon, and how a stored object is cleaned up.
import { CARD_SOUNDS, FONT_SIZES, FONTS, THEMES, TYPING_SOUNDS } from './catalog.ts';
import { comboProblem, type KeyId, keybindings } from './keys.ts';

// The explorer sidebar's width, in px.
export const EXPLORER_WIDTH = { min: 200, max: 640, default: 260 };

// How the tab strip groups tabs: not at all, by repo, or by tag.
export const TAB_GROUPINGS = ['none', 'repo', 'tag'] as const;
export type TabGrouping = (typeof TAB_GROUPINGS)[number];
// The board as status columns side by side, or as one list of rows grouped
// under its statuses (as Linear's list view).
export const BOARD_LAYOUTS = ['columns', 'list'] as const;
export type BoardLayout = (typeof BOARD_LAYOUTS)[number];
// The view the app opens on: the welcome tour's terms, or straight to the board.
export const START_VIEWS = ['terms', 'board'] as const;
export type StartView = (typeof START_VIEWS)[number];

// A coding agent the New card dialog starts: `command` with `{prompt}` for
// the card's first prompt, and `resume`, typed after tabsh restarts, with
// `{session}` for the conversation ('' for none). `{session}` in `command`
// too means tabsh names the conversation, so it resumes without hooks.
// `acp`, when present, is the command that speaks ACP for a UI-mode card.
export interface Provider {
  name: string;
  command: string;
  resume: string;
  acp?: string;
}

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    name: 'Claude Code',
    command: 'claude {prompt}',
    resume: 'claude --resume {session}',
    acp: 'npx --yes @agentclientprotocol/claude-agent-acp',
  },
  {
    name: 'Codex',
    command: 'codex {prompt}',
    resume: 'codex resume {session}',
    acp: 'npx --yes @agentclientprotocol/codex-acp',
  },
  // Cursor's CLI is `agent`. `--resume=<id>` continues one chat.
  {
    name: 'Cursor CLI',
    command: 'agent {prompt}',
    resume: 'agent --resume={session}',
    acp: 'cursor-agent acp',
  },
  {
    name: 'OpenCode',
    command: 'opencode --session ses_{session} --prompt {prompt}',
    resume: 'opencode --session ses_{session}',
    acp: 'opencode acp',
  },
];

// The stock list before Cursor CLI replaced Gemini CLI and OpenCode. An
// install that never edited its agents picks up the new list.
const PREVIOUS_PROVIDERS: Provider[] = [
  { name: 'Claude Code', command: 'claude {prompt}', resume: 'claude --resume {session}' },
  { name: 'Codex', command: 'codex {prompt}', resume: 'codex resume {session}' },
  { name: 'Gemini CLI', command: 'gemini -i {prompt}', resume: 'gemini --resume {session}' },
  {
    name: 'OpenCode',
    command: 'opencode --session ses_{session} --prompt {prompt}',
    resume: 'opencode --session ses_{session}',
  },
];

// The stock list before providers carried an ACP command (and before
// OpenCode returned to the defaults). An install still on it picks up the
// new list, ACP commands included.
const PRE_ACP_PROVIDERS: Provider[] = [
  { name: 'Claude Code', command: 'claude {prompt}', resume: 'claude --resume {session}' },
  { name: 'Codex', command: 'codex {prompt}', resume: 'codex resume {session}' },
  { name: 'Cursor CLI', command: 'agent {prompt}', resume: 'agent --resume={session}' },
];

export const MAX_PROVIDERS = 12;

export const AGENT_MODES = ['tui', 'ui'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

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
    const provider: Provider = { name, command, resume: text(p.resume) };
    const acp = text(p.acp);
    if (acp) provider.acp = acp;
    list.push(provider);
  }
  if (!list.length) return DEFAULT_PROVIDERS;
  const isStock = (stock: Provider[]) =>
    list.length === stock.length &&
    list.every(
      (p, i) =>
        p.name === stock[i].name &&
        p.command === stock[i].command &&
        p.resume === stock[i].resume &&
        (p.acp ?? '') === (stock[i].acp ?? ''),
    );
  const stock = isStock(PREVIOUS_PROVIDERS) || isStock(PRE_ACP_PROVIDERS);
  return stock ? DEFAULT_PROVIDERS : list.slice(0, MAX_PROVIDERS);
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
  needsInputSound: string; // played when a card starts needing input
  completedSound: string; // played when a card completes
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
  keyNewCard: string;
  keyBack: string;
  keyForward: string;
  providers: Provider[];
  agentProvider: string; // the provider New card offers first: the last one used
  agentMode: AgentMode; // TUI or UI for the next New card
  boardOnboarded: boolean; // the board's setup screen was dealt with (set up or skipped)
  boardLayout: BoardLayout;
  welcomeSeen: boolean; // the welcome tour was seen (finished, skipped or closed)
  startView: StartView; // where the app opens when no view is in the URL
}

export function defaults(isMac: boolean): Settings {
  const keys = keybindings(isMac);
  return {
    theme: 'tabsh',
    font: 'menlo',
    fontSize: 13,
    typingSound: 'mx-black-pbt',
    needsInputSound: 'ping',
    completedSound: 'arpeggio',
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
    keyNewCard: keys.keyNewCard.presets[0],
    keyBack: keys.keyBack.presets[0],
    keyForward: keys.keyForward.presets[0],
    providers: DEFAULT_PROVIDERS,
    agentProvider: DEFAULT_PROVIDERS[0].name,
    agentMode: 'tui',
    boardOnboarded: false,
    boardLayout: 'columns',
    welcomeSeen: false,
    startView: 'terms',
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
    keyNewCard: '',
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
    needsInputSound: CARD_SOUNDS[str(stored.needsInputSound)] ? str(stored.needsInputSound) : d.needsInputSound,
    completedSound: CARD_SOUNDS[str(stored.completedSound)] ? str(stored.completedSound) : d.completedSound,
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
    keyNewCard: key('keyNewCard'),
    keyBack: key('keyBack'),
    keyForward: key('keyForward'),
    ...(() => {
      const providers = cleanProviders(stored);
      const chosen = providers.find((p) => p.name === stored.agentProvider) ?? providers[0];
      const agentMode = AGENT_MODES.find((m) => m === stored.agentMode) ?? d.agentMode;
      return { providers, agentProvider: chosen.name, agentMode };
    })(),
    boardOnboarded: stored.boardOnboarded === true,
    boardLayout: BOARD_LAYOUTS.find((l) => l === stored.boardLayout) ?? d.boardLayout,
    welcomeSeen: stored.welcomeSeen === true,
    startView: START_VIEWS.find((v) => v === stored.startView) ?? d.startView,
  };
}
