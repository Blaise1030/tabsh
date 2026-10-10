// A burst on the active tab is painted in coalesced frames: the chunks its
// socket receives within a frame reach xterm as one write. During the burst
// the page still switches tabs and opens the board; back on the flooded tab,
// the flood's tail is on screen.
//
// The proof here is the mechanism (write calls per received chunk), not a
// responsiveness metric. Measured against the base build in headless
// chromium (2026-10-10), none of these told the two apart: long tasks (none
// in either build), event-loop lag, max rAF gap (16.8ms in both), tab-click
// and board-open latency mid-flood, and time to paint the whole flood. xterm's
// own write buffer already parses in time slices, so the navigation half
// below passes on the base build too: it guards that coalescing doesn't
// break it.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');
const rows = (page: Page) => page.locator('.term.active .xterm-rows');

// The worker's daemon is shared: start from no tabs, so the app opens one
// and newTab makes the second.
async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}
test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

// Counts xterm writes from now on. xterm is a page global (a script tag), so
// wrapping its prototype counts every terminal's writes, open ones included.
async function countWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { Terminal: { prototype: { write: (...a: unknown[]) => void } }; __writes: number };
    w.__writes = 0;
    const write = w.Terminal.prototype.write;
    w.Terminal.prototype.write = function (this: unknown, ...a: unknown[]) {
      w.__writes++;
      return write.apply(this, a);
    };
  });
}
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: number }).__writes);

// Binary frames (terminal output) received on the page's sockets from now on.
function receivedChunks(page: Page): { n: number } {
  const seen = { n: 0 };
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string') seen.n++;
    });
  });
  return seen;
}

test('a burst on the active tab is written in coalesced frames and the page stays usable', async ({ page, daemon }) => {
  test.setTimeout(150_000); // two floods; a loaded machine paints them slowly
  const chunks = receivedChunks(page);
  await openApp(page, daemon);
  await newTab(page); // the flooded tab is the new one, named `ready`; the other is where we switch to
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, "printf '\\033]0;ready\\007'");
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('ready', { timeout: 2_000 });
  }).toPass({ timeout: 10_000 });

  await countWrites(page);
  const before = chunks.n;
  // A short, high-rate flood, then a tail line that isn't the command's own.
  await typeInTerminal(page, "seq 1 150000; echo flood-$((6*7))-done");
  await page.keyboard.press('Enter');
  await expect(rows(page)).toContainText('flood-42-done', { timeout: 60_000 });

  const got = chunks.n - before;
  const wrote = await writes(page);
  expect(got).toBeGreaterThan(50); // it was a burst, not one chunk
  expect(wrote).toBeLessThan(got / 2); // chunks within a frame became one write

  // Again, but navigate away mid-burst: switching tabs and the board respond.
  // Tabs by name, not position: a previous test's tab may still be going.
  const flooded = tabs(page).filter({ hasText: 'ready' });
  const other = tabs(page).filter({ hasNotText: 'ready' }).first();
  await typeInTerminal(page, "clear; seq 200001 600000; echo again-$((6*7))-done");
  await page.keyboard.press('Enter');
  // The second flood is painting: a row only it prints (the first stopped at
  // 150000; the command line is not a bare number).
  await expect(page.locator('.term.active .xterm-rows > div', { hasText: /^[2-6]\d{5}\s*$/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  await other.click();
  await expect(other).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
  await page.locator('#board-btn').click();
  await expect(page.locator('#board')).toBeVisible({ timeout: 2_000 });
  await page.goBack();
  await expect(page.locator('#board')).toBeHidden({ timeout: 2_000 });

  // Back on the flooded tab: it catches up, the tail on screen.
  await flooded.click();
  await expect(flooded).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toContainText('again-42-done', { timeout: 60_000 });
});
