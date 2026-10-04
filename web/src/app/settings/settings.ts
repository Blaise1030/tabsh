// The current settings: what's stored on the daemon, what's on screen, and
// applying them. Other modules react through onApply and onSaved.
import { daemonFetch } from '../daemon/client.ts';
import { isMac } from '../ui/dom.ts';
import { FONTS, type Font, fontStack, THEMES } from './catalog.ts';
import { keybindings } from './keys.ts';
import { cleanSettings, defaults, type Settings } from './schema.ts';

export type { Settings } from './schema.ts';

export const KEYBINDINGS = keybindings(isMac);

export const current: { saved: Settings; applied: Settings } = {
  saved: defaults(isMac), // what's stored on the server
  applied: defaults(isMac), // what's on screen (differs while previewing)
};

const applyListeners: ((s: Settings) => void)[] = [];
const savedListeners: ((s: Settings) => void)[] = [];
// Runs after each apply that wasn't overtaken by a newer one.
export function onApply(fn: (s: Settings) => void): void {
  applyListeners.push(fn);
}
// Runs when the stored settings change.
export function onSaved(fn: (s: Settings) => void): void {
  savedListeners.push(fn);
}

// While the palette previews a setting, settings loaded from the daemon
// are stored but not shown.
let previewing = false;
export function setPreviewing(on: boolean): void {
  previewing = on;
}

export const terminalOptions = (s: Settings) => ({
  theme: THEMES[s.theme].colors,
  fontFamily: fontStack(FONTS[s.font]),
  fontSize: s.fontSize,
});

// Web fonts must be fully loaded before xterm measures character cells.
const fontLoads: Record<string, Promise<void>> = {};
function loadFont(f: Font): Promise<void> {
  const family = f.google;
  if (!family) return Promise.resolve();
  fontLoads[f.name] ??= new Promise<void>((resolve) => {
    const done = () => resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=block`;
    link.onload = () =>
      Promise.all([document.fonts.load(`400 16px "${f.name}"`), document.fonts.load(`700 16px "${f.name}"`)]).then(
        done,
        done,
      );
    link.onerror = done; // offline: fall back to the stack's next font
    document.head.append(link);
  });
  return fontLoads[f.name];
}

let applySeq = 0;
export async function applySettings(s: Settings): Promise<void> {
  // Ignore stale applies when previews change faster than fonts load.
  const seq = ++applySeq;
  await loadFont(FONTS[s.font]);
  if (seq !== applySeq) return;
  current.applied = { ...s };
  const theme = THEMES[s.theme];
  const root = document.documentElement;
  root.style.setProperty('--term-bg', theme.colors.background);
  root.style.setProperty('--term-fg', theme.colors.foreground);
  root.classList.add('themed');
  root.classList.toggle('dark', !theme.light);
  for (const fn of applyListeners) fn(s);
}

export async function loadSettings(): Promise<void> {
  const res = await daemonFetch('/api/settings');
  if (!res.ok) return;
  current.saved = cleanSettings(await res.json(), isMac);
  for (const fn of savedListeners) fn(current.saved);
  if (!previewing) await applySettings(current.saved);
}

export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current.saved = { ...current.saved, [key]: value };
  for (const fn of savedListeners) fn(current.saved);
  applySettings(current.saved);
  daemonFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(current.saved),
  }).catch(() => {});
}
