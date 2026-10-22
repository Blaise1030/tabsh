// The app page's startup: pair with the daemon, wire the features
// together, then restore the tabs.

import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { initBoardEvents } from './board/events.ts';
import { initMoveMenu } from './board/move-menu.tsx';
import { initNotify } from './board/notify.ts';
import { initBoard, leaveTermsOnPhone } from './board/view.tsx';
import { daemonFetch, waitForDaemon } from './daemon/client.ts';
import { LOCAL_APP, MIXED_BLOCKED } from './daemon/config.ts';
import { keepsTokenInAddress } from './daemon/parse.ts';
import { adoptToken } from './daemon/token.ts';
import { initExplorer } from './explorer/explorer.ts';
import { initFilePane, loadedPane, restoreFiles } from './files/open.tsx';
import { rememberedFiles } from './files/remember.ts';
import { startRouter } from './nav/router.ts';
import { initPalette } from './palette/palette.tsx';
import { initPwa } from './pwa/register.ts';
import { initBell } from './sessions/bell.ts';
import { initTabGroups } from './sessions/groups.tsx';
import {
  allTerms,
  initTabRouting,
  initTermRouting,
  newSession,
  newTabAt,
  onScreen,
  savedActive,
  sendSize,
  store,
  sync,
} from './sessions/store.ts';
import { initTabStrip } from './sessions/tabs.ts';
import { initTabLabels } from './sessions/tags.tsx';
import { syncTerminalVisibility } from './sessions/terminal.tsx';
import { FONTS, fontStack, prefersLight, THEMES } from './settings/catalog.ts';
import { applySettings, current, loadSettings, onApply, terminalOptions } from './settings/settings.ts';
import { initChime } from './sound/chime.ts';
import { initTypingSound } from './sound/typing.ts';
import { App } from './ui/app.tsx';
import { initDivider, initDrawerDivider } from './ui/divider.ts';
import { initDrop } from './ui/drop.ts';
import { initKeyboardInset } from './ui/keyboard.ts';
import { initWelcome } from './welcome/view.ts';

render(App, document.getElementById('app')!);

// The pairing link puts the token in the fragment; take it before anything
// talks to the daemon, and clear it except on another device.
const launched = adoptToken(location.hash);
if (location.hash && !keepsTokenInAddress(location.hostname))
  history.replaceState(null, '', location.pathname + location.search);
// A link with the token comes from a running daemon (it opens one at
// startup), so it's safe to go straight to its copy. Without one the
// daemon may be down, and the gate explains how to start it.
if (MIXED_BLOCKED && launched) location.replace(LOCAL_APP);
initPwa();

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
    layout: () => onScreen() && sendSize(onScreen()!),
    newTabAt,
    focusTerminal: () => onScreen()?.term.focus(),
    paste(sessionId, text) {
      const s = store.sessions.find((x) => x.id === sessionId);
      if (!s || s.closed) return 'closed';
      // Without bracketed paste a shell runs each pasted line as a command,
      // and the text holds lines quoted from a file.
      if (!s.term.modes.bracketedPasteMode) return 'unsafe';
      s.term.paste(text);
      s.term.focus();
      return 'pasted';
    },
  },
  () => store.active?.id ?? null,
);
addEventListener('beforeunload', (e) => {
  if (!loadedPane()?.hasUnsaved()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers
});

// The features' wiring runs under one owner, so their effects have a root.
createRoot(() => {
  initTabRouting();
  initTermRouting();
  initBell();
  initTabStrip();
  initTabLabels();
  initTabGroups();
  initExplorer();
  initBoard();
  initMoveMenu();
  initNotify();
  initChime();
  initTypingSound();
  initPalette();
  initDivider();
  initDrawerDivider();
  initDrop();
  initKeyboardInset();

  // Applied settings restyle every terminal and the file pane (theme and font).
  onApply((s) => {
    const opts = terminalOptions(s);
    for (const { term } of allTerms()) Object.assign(term.options, opts);
    loadedPane()?.applyTheme();
    const shown = onScreen();
    if (shown) sendSize(shown);
  });
  // Follow the system's light/dark switch live while the tabsh theme is on.
  prefersLight?.addEventListener('change', () => current.applied.theme === 'tabsh' && applySettings(current.applied));

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-new-session]')) b.onclick = newSession;
  // A phone resizes in bursts (the keyboard sliding in, the address bar
  // collapsing, a turn): the terminal is fitted once it settles.
  let resizeTimer = 0;
  new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const s = onScreen();
      if (s) requestAnimationFrame(() => sendSize(s));
    }, 150);
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
    // The tour waits for the settings, so it only opens for someone the app
    // hasn't met (welcomeSeen false on the daemon).
    initWelcome();
    // A failed sync mustn't keep the router from starting (go() queues until it
    // has); the next window focus syncs again.
    await sync().catch(console.error);
    initBoardEvents();
    if (!store.sessions.length) await newSession().catch(console.error);
    const tab = (store.sessions.find((s) => s.id === activeId) ?? store.sessions[0])?.id ?? null;
    await startRouter({
      tab,
      // Where the app opens when the URL doesn't say (the welcome tour's pick);
      // a view query wins, as the URL merges over this fallback.
      view: current.saved.startView,
      // The tab's remembered file opens as part of the startup place, which
      // doesn't take the keyboard. A URL naming another tab drops it.
      file: (tab && rememberedFiles()[tab]) || null,
      explorer: current.saved.explorerOpen,
    });
    leaveTermsOnPhone();
    // The router has picked the active tab: attach its socket (sessions opened
    // during sync had no active tab yet, so they stayed parked).
    syncTerminalVisibility();
    restoreFiles(store.sessions.map((s) => s.id));
  })();
});
