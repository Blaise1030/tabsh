// The agent-activity walking skeleton: `tabsh hook <state>` typed in a tab
// shows on that tab — a spinner while the agent runs, an orange dot (and
// the favicon/title badge while you're elsewhere) when it needs you, and a
// ✓ done that clears when you visit. The whole path is real: env vars →
// CLI → route → daemon state → WebSocket → page.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// A tab by its place in the strip: 0 is the auto-opened first terminal (A),
// 1 the one the spec creates (B).
const tab = (page: Page, i: number) => page.locator('#tabs .tab').nth(i);

// Run a hook command in the active terminal. Ctrl-C first keeps any retry
// (a keystroke landing before the tab's socket opens) on a fresh prompt
// line. The daemon's own binary is spelled out because a login shell on
// some systems (CI's bash) rebuilds PATH from /etc/profile and would drop
// the binary directory that startDaemon puts on it.
const hook = (daemon: Daemon, page: Page, state: string) =>
  expect(async () => {
    await typeInTerminal(page, `\u0003${daemon.bin} hook ${state}`);
    await page.keyboard.press('Enter');
  }).toPass({ timeout: 10_000 });

test('hook state shows on the tab it ran in', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page); // tab B
  await tab(page, 0).click(); // keep A active
  await expect(tab(page, 0)).toHaveAttribute('aria-selected', 'true');

  // Running: B's tab gets the spinner. (B is clicked to type in; the
  // marker shows whichever tab you're on.)
  await tab(page, 1).click();
  await hook(daemon, page, 'running');
  await expect(tab(page, 1)).toHaveClass(/running/);

  // Needs-input: B gets the orange dot, and while A is active the favicon
  // and title are badged.
  await hook(daemon, page, 'needs-input');
  await tab(page, 0).click(); // watch A: B needs you
  await expect(tab(page, 1)).toHaveClass(/needs/);
  await expect(page).toHaveTitle(/^🔔/);
  await expect(page.locator('#favicon')).toHaveAttribute('href', /%3Ccircle/);

  // Visiting B: the dot stays (it is the agent's state, not unread output;
  // it clears when the agent moves on), the badge does not.
  await tab(page, 1).click();
  await expect(tab(page, 1)).toHaveClass(/needs/);
  await expect(page).not.toHaveTitle(/^🔔/);

  // Running again: spinner, and no badge.
  await hook(daemon, page, 'running');
  await expect(tab(page, 1)).toHaveClass(/running/);
  await expect(page).not.toHaveTitle(/^🔔/);

  // Idle after running: ✓ done until the tab is visited.
  await hook(daemon, page, 'idle');
  await expect(tab(page, 1)).toHaveClass(/done/);
  await tab(page, 0).click(); // still done while you're away
  await expect(tab(page, 1)).toHaveClass(/done/);
  await tab(page, 1).click(); // visiting clears it
  await expect(tab(page, 1)).not.toHaveClass(/done/);

  // Needs-input in the tab you are watching, page focused: the dot, but no
  // badge on the title or favicon.
  await hook(daemon, page, 'needs-input');
  await expect(tab(page, 1)).toHaveClass(/needs/);
  await expect(page).not.toHaveTitle(/^🔔/);
  await expect(page.locator('#favicon')).not.toHaveAttribute('href', /%3Ccircle/);

  // The badge follows watching, not the frame's arrival: looking away from
  // that same needs-input tab lights it, coming back turns it off. Headless
  // chromium keeps every page focused and visible (bringToFront changes
  // neither), so the focus API is stubbed to "looked away" around a real
  // blur event — the listeners, the rules and the favicon/title updates
  // exercised here are the app's own.
  const watch = (focused: boolean) =>
    page.evaluate((f) => {
      Object.defineProperty(document, 'hasFocus', { value: () => f, configurable: true });
      window.dispatchEvent(new Event(f ? 'focus' : 'blur'));
    }, focused);
  await watch(false);
  await expect(page).toHaveTitle(/^🔔/);
  await expect(page.locator('#favicon')).toHaveAttribute('href', /%3Ccircle/);
  await watch(true);
  await expect(page).not.toHaveTitle(/^🔔/);
  await expect(tab(page, 1)).toHaveClass(/needs/); // the dot survives all of it
});
