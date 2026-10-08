// What the settings offer: terminal themes, fonts, sizes, typing sounds and
// the sounds a card makes when it needs input or completes.

export interface ThemeColors extends AnsiColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}
export interface Theme {
  name: string;
  system?: boolean;
  light?: boolean;
  colors: ThemeColors;
}
export interface Font {
  name: string;
  stack?: string;
  google?: string;
}

const ANSI_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
type AnsiColors = Record<(typeof ANSI_NAMES)[number], string>;
// The 16 ANSI colours, in order.
const ansi = (...colors: string[]): AnsiColors =>
  Object.fromEntries(ANSI_NAMES.map((name, i) => [name, colors[i]])) as AnsiColors;

const solarizedAnsi = ansi(
  '#073642',
  '#dc322f',
  '#859900',
  '#b58900',
  '#268bd2',
  '#d33682',
  '#2aa198',
  '#eee8d5',
  '#002b36',
  '#cb4b16',
  '#586e75',
  '#657b83',
  '#839496',
  '#6c71c4',
  '#93a1a1',
  '#fdf6e3',
);

// The site's own palette, shared with the landing page (web/src/pages/index.astro).
// `tabsh` follows the system's light/dark setting, like the landing page does.
export const TABSH_COLORS: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    background: '#141414',
    foreground: '#e6e6e6',
    cursor: '#e6e6e6',
    selectionBackground: '#3a3a3a',
    ...ansi(
      '#2e3436',
      '#cc0000',
      '#4e9a06',
      '#c4a000',
      '#3465a4',
      '#75507b',
      '#06989a',
      '#d3d7cf',
      '#555753',
      '#ef2929',
      '#8ae234',
      '#fce94f',
      '#729fcf',
      '#ad7fa8',
      '#34e2e2',
      '#eeeeec',
    ),
  },
  light: {
    background: '#f7f7f7',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    selectionBackground: '#d6d6d6',
    ...ansi(
      '#24292f',
      '#cf222e',
      '#116329',
      '#4d2d00',
      '#0969da',
      '#8250df',
      '#1b7c83',
      '#6e7781',
      '#57606a',
      '#a40e26',
      '#1a7f37',
      '#633c01',
      '#218bff',
      '#a475f9',
      '#3192aa',
      '#8c959f',
    ),
  },
};
export const prefersLight: MediaQueryList | null = globalThis.matchMedia?.('(prefers-color-scheme: light)') ?? null;

export const THEMES: Record<string, Theme> = {
  tabsh: {
    name: 'tabsh (match system)',
    system: true,
    get light() {
      return prefersLight?.matches ?? false;
    },
    get colors() {
      return TABSH_COLORS[prefersLight?.matches ? 'light' : 'dark'];
    },
  },
  'default-dark': {
    name: 'Default Dark',
    colors: {
      background: '#0a0a0a',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
      selectionBackground: '#3a3a3a',
      ...ansi(
        '#2e3436',
        '#cc0000',
        '#4e9a06',
        '#c4a000',
        '#3465a4',
        '#75507b',
        '#06989a',
        '#d3d7cf',
        '#555753',
        '#ef2929',
        '#8ae234',
        '#fce94f',
        '#729fcf',
        '#ad7fa8',
        '#34e2e2',
        '#eeeeec',
      ),
    },
  },
  'one-dark': {
    name: 'One Dark',
    colors: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      selectionBackground: '#3e4451',
      ...ansi(
        '#282c34',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#abb2bf',
        '#5c6370',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#ffffff',
      ),
    },
  },
  dracula: {
    name: 'Dracula',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      ...ansi(
        '#21222c',
        '#ff5555',
        '#50fa7b',
        '#f1fa8c',
        '#bd93f9',
        '#ff79c6',
        '#8be9fd',
        '#f8f8f2',
        '#6272a4',
        '#ff6e6e',
        '#69ff94',
        '#ffffa5',
        '#d6acff',
        '#ff92df',
        '#a4ffff',
        '#ffffff',
      ),
    },
  },
  nord: {
    name: 'Nord',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      ...ansi(
        '#3b4252',
        '#bf616a',
        '#a3be8c',
        '#ebcb8b',
        '#81a1c1',
        '#b48ead',
        '#88c0d0',
        '#e5e9f0',
        '#4c566a',
        '#bf616a',
        '#a3be8c',
        '#ebcb8b',
        '#81a1c1',
        '#b48ead',
        '#8fbcbb',
        '#eceff4',
      ),
    },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      ...ansi(
        '#15161e',
        '#f7768e',
        '#9ece6a',
        '#e0af68',
        '#7aa2f7',
        '#bb9af7',
        '#7dcfff',
        '#a9b1d6',
        '#414868',
        '#f7768e',
        '#9ece6a',
        '#e0af68',
        '#7aa2f7',
        '#bb9af7',
        '#7dcfff',
        '#c0caf5',
      ),
    },
  },
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    colors: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b70',
      ...ansi(
        '#45475a',
        '#f38ba8',
        '#a6e3a1',
        '#f9e2af',
        '#89b4fa',
        '#f5c2e7',
        '#94e2d5',
        '#bac2de',
        '#585b70',
        '#f38ba8',
        '#a6e3a1',
        '#f9e2af',
        '#89b4fa',
        '#f5c2e7',
        '#94e2d5',
        '#a6adc8',
      ),
    },
  },
  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      ...ansi(
        '#282828',
        '#cc241d',
        '#98971a',
        '#d79921',
        '#458588',
        '#b16286',
        '#689d6a',
        '#a89984',
        '#928374',
        '#fb4934',
        '#b8bb26',
        '#fabd2f',
        '#83a598',
        '#d3869b',
        '#8ec07c',
        '#ebdbb2',
      ),
    },
  },
  // VS Code's built-in Monokai.
  monokai: {
    name: 'Monokai',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: '#49483e',
      ...ansi(
        '#333333',
        '#c4265e',
        '#86b42b',
        '#b3b42b',
        '#6a7ec8',
        '#8c6bc8',
        '#56adbc',
        '#e3e3dd',
        '#666666',
        '#f92672',
        '#a6e22e',
        '#e2e22e',
        '#819aff',
        '#ae81ff',
        '#66d9ef',
        '#f8f8f2',
      ),
    },
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    colors: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      selectionBackground: '#073642',
      ...solarizedAnsi,
    },
  },
  'solarized-light': {
    name: 'Solarized Light',
    light: true,
    colors: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#eee8d5',
      ...solarizedAnsi,
    },
  },
  'github-light': {
    name: 'GitHub Light',
    light: true,
    colors: {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#0969da',
      selectionBackground: '#b6e3ff',
      ...ansi(
        '#24292f',
        '#cf222e',
        '#116329',
        '#4d2d00',
        '#0969da',
        '#8250df',
        '#1b7c83',
        '#6e7781',
        '#57606a',
        '#a40e26',
        '#1a7f37',
        '#633c01',
        '#218bff',
        '#a475f9',
        '#3192aa',
        '#8c959f',
      ),
    },
  },
};

// `google` fonts are fetched from Google Fonts the first time they're used.
export const FONTS: Record<string, Font> = {
  menlo: { name: 'Menlo', stack: 'Menlo, Monaco, "Courier New", monospace' },
  monaco: { name: 'Monaco', stack: 'Monaco, Menlo, "Courier New", monospace' },
  'geist-mono': { name: 'Geist Mono', google: 'Geist+Mono' },
  'jetbrains-mono': { name: 'JetBrains Mono', google: 'JetBrains+Mono' },
  'fira-code': { name: 'Fira Code', google: 'Fira+Code' },
  'source-code-pro': { name: 'Source Code Pro', google: 'Source+Code+Pro' },
  'ibm-plex-mono': { name: 'IBM Plex Mono', google: 'IBM+Plex+Mono' },
  'roboto-mono': { name: 'Roboto Mono', google: 'Roboto+Mono' },
  'courier-new': { name: 'Courier New', stack: '"Courier New", Courier, monospace' },
};
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
export const TYPING_SOUNDS: Record<string, string> = {
  'mx-black-pbt': 'Cherry MX Black (PBT)',
  'mx-blue': 'Cherry MX Blue',
  'holy-panda': 'Holy Panda',
  'gateron-black-ink': 'Gateron Black Ink',
  off: 'Off',
};

// Chimes for a card's notifications, synthesized in sound/chime.ts.
export const CARD_SOUNDS: Record<string, string> = {
  ping: 'Ping',
  arpeggio: 'Arpeggio',
  ding: 'Ding',
  pop: 'Pop',
  marimba: 'Marimba',
  blip: 'Blip',
  off: 'Off',
};

export const fontStack = (f: Font): string => f.stack ?? `"${f.name}", Menlo, monospace`;
