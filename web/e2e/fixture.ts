// The e2e fixtures: a daemon per worker, plus the helpers every spec uses.
// The conventions (selectors, typing, auth) live in web/e2e/README.md.
import { test as base, expect, type Page } from '@playwright/test';
import { type Daemon, startDaemon } from './daemon.ts';

// One daemon — its own port and its own empty state dir — per worker, so
// specs never see each other's tabs. Tests within a worker run one at a time.
// (Playwright requires the empty destructuring in the fixture argument —
// biome's noEmptyPattern is off for e2e/ for this reason.)
const test = base.extend<Record<never, never>, { daemon: Daemon }>({
  daemon: [
    async ({}, use) => {
      const daemon = await startDaemon();
      await use(daemon);
      await daemon.cleanup();
    },
    { scope: 'worker' },
  ],
});

export { expect, test };

// Pair the page with the daemon and wait for the app: the token rides in the
// URL fragment, exactly as in the link the daemon prints, and the page clears
// it from the address bar before talking to the API.
export async function openApp(page: Page, daemon: Daemon): Promise<void> {
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
  await expect(page.locator('#tabs')).toBeVisible();
  // A fresh daemon has no sessions, so the app opens its first terminal by
  // itself once paired (main.ts). Waiting for it means the page is settled:
  // newTab's count math starts from a known place.
  await expect(page.locator('#tabs .tab').first()).toBeVisible();
}

// Click "new terminal" and wait for the tab strip and the terminal itself;
// the shell's prompt arrives over the socket a moment later.
// The app opens its first terminal by itself (main.ts); this clicks "new
// terminal" and waits for one MORE tab, so the helper stays honest however
// many tabs are already open.
export async function newTab(page: Page): Promise<void> {
  const tabs = page.locator('#tabs .tab');
  const before = await tabs.count();
  // Scoped to the tabbar: the empty state has a second new-terminal button.
  await page.locator('.tabbar [data-new-session]').click();
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.locator('.term.active')).toBeVisible();
}

// Focus a terminal and type. Clicking the terminal focuses xterm's hidden
// textarea; page.keyboard then sends real key events through the page, the
// socket and the PTY.
export async function typeInTerminal(page: Page, text: string): Promise<void> {
  await page.locator('.term.active').click();
  await page.keyboard.type(text);
}
