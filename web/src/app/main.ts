// The app page's startup: pair with the daemon, wire the features
// together, then restore the tabs.
import { daemonFetch, initGate, waitForDaemon } from './daemon/client.ts';
import { LOCAL_APP, MIXED_BLOCKED } from './daemon/config.ts';
import { adoptToken } from './daemon/token.ts';
import { initExplorer } from './explorer/explorer.ts';
import { initFilePane, loadedPane, restoreFiles } from './files/open.ts';
import { initPalette } from './palette/palette.ts';
import { initBell } from './sessions/bell.ts';
import { activate, newSession, newTabAt, savedActive, sendSize, store, sync } from './sessions/store.ts';
import { initTabStrip } from './sessions/tabs.ts';
import { initTabLabels } from './sessions/tags.ts';
import { FONTS, fontStack, prefersLight, THEMES } from './settings/catalog.ts';
import { applySettings, current, loadSettings, onApply, terminalOptions } from './settings/settings.ts';
import { initTypingSound } from './sound/typing.ts';
import { initAbout } from './ui/about.ts';
import { initDivider } from './ui/divider.ts';
import { initDrop } from './ui/drop.ts';

// The pairing link puts the token in the fragment; take it and clear it
// before anything talks to the daemon.
const launched = adoptToken(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// A link with the token comes from a running daemon (it opens one at
// startup), so it's safe to go straight to its copy. Without one the
// daemon may be down, and the gate explains how to start it.
if (MIXED_BLOCKED && launched) location.replace(LOCAL_APP);
initGate();

// What the file pane needs from the rest of the page.
initFilePane(
  {
    fetch: daemonFetch,
    theme() {
      const t = THEMES[current.applied.theme];
      const c = t.colors;
      return {
        background: c.background,
        foreground: c.foreground,
        cursor: c.cursor,
        selectionBackground: c.selectionBackground,
        light: !!t.light,
        fontFamily: fontStack(FONTS[current.applied.font]),
        fontSize: current.applied.fontSize,
      };
    },
    layout: () => store.active && sendSize(store.active),
    newTabAt,
    focusTerminal: () => store.active?.term.focus(),
  },
  () => store.active?.id ?? null,
);
addEventListener('beforeunload', (e) => {
  if (!loadedPane()?.hasUnsaved()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers
});

initBell();
initTabStrip();
initTabLabels();
initExplorer();
initTypingSound();
initPalette();
initDivider();
initAbout();
initDrop();

// Applied settings restyle every terminal and the file pane (theme and font).
onApply((s) => {
  const opts = terminalOptions(s);
  for (const { term } of store.sessions) Object.assign(term.options, opts);
  loadedPane()?.applyTheme();
  if (store.active) sendSize(store.active);
});
// Follow the system's light/dark switch live while the tabsh theme is on.
prefersLight?.addEventListener('change', () => current.applied.theme === 'tabsh' && applySettings(current.applied));

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-new-session]')) b.onclick = newSession;
new ResizeObserver(() => {
  const s = store.active;
  if (s) requestAnimationFrame(() => sendSize(s));
}).observe(document.getElementById('terms') as HTMLElement);
window.addEventListener('focus', () => {
  sync().catch(() => {});
  loadSettings().catch(() => {});
});

// Reattach to the server's sessions (shells survive reloads; after a
// daemon restart they come back in their old directory with old output).
(async () => {
  const activeId = savedActive();
  applySettings(current.saved); // theme the connection screen before the daemon answers
  await waitForDaemon();
  await loadSettings().catch(() => applySettings(current.saved));
  await sync();
  restoreFiles(store.sessions.map((s) => s.id));
  if (!store.sessions.length) return newSession();
  activate(store.sessions.find((s) => s.id === activeId) ?? store.sessions[0]);
})();
