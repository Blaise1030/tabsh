// The BEL rule: once a tab's agent has spoken in this page (a hook state
// arrived), a BEL from that tab is the agent, not the shell — while the
// agent runs, a BEL asks for you (orange dot, favicon/title badge) until
// the daemon's next state replaces it; while idle, a BEL is nothing, so
// zsh's prompt beeps can't mark the tab. A tab whose agent never spoke
// keeps today's bell. The ask is display-only: nothing is posted back.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// A tab by its place in the strip: 0 is the auto-opened first terminal (A),
// 1 the first one the spec creates (B), 2 the second (C).
const tab = (page: Page, i: number) => page.locator('#tabs .tab').nth(i);
const label = (page: Page) => page.locator('#tabs .tab[aria-selected="true"] span');

// Run a shell command in the active terminal. Ctrl-C first keeps any retry
// (a keystroke landing before the tab's socket opens) on a fresh prompt
// line; the daemon's own binary is spelled out because a login shell on
// some systems (CI's bash) rebuilds PATH from /etc/profile.
const run = (daemon: Daemon, page: Page, cmd: string) =>
  expect(async () => {
    await typeInTerminal(page, `\u0003${cmd}`);
    await page.keyboard.press('Enter');
  }).toPass({ timeout: 10_000 });

const hook = (daemon: Daemon, page: Page, state: string) => run(daemon, page, `${daemon.bin} hook ${state}`);

// Ring the bell, then rename the tab. The rename is the DOM effect proving
// the BEL byte was already scanned (the stream is ordered), which bounds
// every "nothing changed" assertion after it.
const bell = (daemon: Daemon, page: Page, mark: string) =>
  run(daemon, page, `printf '\\a'; printf '\\033]0;${mark}\\007'`);

// Headless chromium keeps every page focused and visible (bringToFront
// changes neither), so the focus API is stubbed to "looked away" around a
// real blur event — the listeners, the rules and the favicon/title updates
// exercised here are the app's own (the trick of hook-state.spec.ts).
const watch = (page: Page, focused: boolean) =>
  page.evaluate(
    (f) => {
      Object.defineProperty(document, 'hasFocus', { value: () => f, configurable: true });
      window.dispatchEvent(new Event(f ? 'focus' : 'blur'));
    },
    focused,
  );

test('a bell from a running agent asks for you; from an idle one, nothing', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page); // tab B, where the "agent" runs
  await tab(page, 1).click(); // work in B and stay there
  await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');

  // The agent is running — the hook state means the tab has spoken — and
  // rings (Goose/Auggie/Crush/Amp have no "waiting for you" event): the
  // spinner gives way to the orange dot, a working agent that rings is
  // asking for you. While you watch the tab, the dot shows but no badge.
  await hook(daemon, page, 'running');
  await expect(tab(page, 1)).toHaveClass(/running/);
  await bell(daemon, page, 'asked');
  await expect(label(page)).toHaveText('asked');
  await expect(tab(page, 1)).toHaveClass(/needs/);
  await expect(tab(page, 1)).not.toHaveClass(/running/);
  await expect(page).not.toHaveTitle(/^🔔/);

  // Look away: the same ask badges the favicon and title; look back: the
  // badge goes, the dot stays.
  await watch(page, false);
  await expect(page).toHaveTitle(/^🔔/);
  await expect(page.locator('#favicon')).toHaveAttribute('href', /%3Ccircle/);
  await watch(page, true);
  await expect(page).not.toHaveTitle(/^🔔/);
  await expect(tab(page, 1)).toHaveClass(/needs/);

  // The daemon's next state replaces the display-level ask: idle after
  // running is the ✓ done.
  await hook(daemon, page, 'idle');
  await expect(tab(page, 1)).toHaveClass(/done/);
  await expect(tab(page, 1)).not.toHaveClass(/needs/);

  // A BEL while idle is nothing at all — no dot, no bell pulse, no badge
  // even once you look away. The rename bounds it: the BEL was scanned.
  await bell(daemon, page, 'stray');
  await expect(label(page)).toHaveText('stray');
  await expect(tab(page, 1)).toHaveClass(/done/);
  await expect(tab(page, 1)).not.toHaveClass(/needs/);
  await expect(tab(page, 1)).not.toHaveClass(/bell/);
  await watch(page, false);
  await expect(page).not.toHaveTitle(/^🔔/);
  await watch(page, true);

  // Tab C never had hook activity: today's bell behaviour, unchanged. A
  // BEL while you look away pulses the tab and badges; coming back clears.
  await newTab(page); // tab C
  await expect(tab(page, 2)).toHaveAttribute('aria-selected', 'true');
  await watch(page, false); // the bell only rings while you're not watching
  await bell(daemon, page, 'plain-bell');
  await expect(label(page)).toHaveText('plain-bell');
  await expect(tab(page, 2)).toHaveClass(/bell/);
  await expect(page).toHaveTitle(/^🔔/);
  await watch(page, true);
  await expect(tab(page, 2)).not.toHaveClass(/bell/);
  await expect(page).not.toHaveTitle(/^🔔/);
});
