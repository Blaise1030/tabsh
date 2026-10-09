// A busy tab off screen: its socket is parked (only the on-screen terminal
// attaches), so the page hears its output through the board events stream
// instead. While it floods, the active tab stays usable; the parked tab
// shows unread and rings on a BEL; activating it replays what it printed.
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');
const selectedName = (page: Page) => page.locator('#tabs .tab:not(.mirror)[aria-selected="true"] .tab-name');

async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

// Has the active tab's shell rename its tab (OSC 0), and waits until it has:
// proof that typing reaches the shell and its output comes back.
async function renameByShell(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await typeInTerminal(page, `printf '\\033]0;${name}\\007'`);
    await page.keyboard.press('Enter');
    await expect(selectedName(page)).toHaveText(name, { timeout: 2_000 });
  }).toPass({ timeout: 10_000 });
}

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('a parked tab flooding output shows unread, rings, and catches up when activated', async ({ page, daemon }) => {
  // Two shells, a timed flood and a replay: more than the default budget.
  test.setTimeout(120_000);
  // Touched by B's shell as its flood starts, and once it has printed everything.
  const started = test.info().outputPath('flood-started');
  const done = test.info().outputPath('flood-done');
  mkdirSync(path.dirname(done), { recursive: true });
  await openApp(page, daemon);
  await renameByShell(page, 'tab-a');
  await newTab(page);
  await renameByShell(page, 'tab-b');
  const a = tabs(page).filter({ hasText: 'tab-a' });
  const b = tabs(page).filter({ hasText: 'tab-b' });

  // B waits until it's parked, then floods for several seconds (well past
  // its scrollback), rings once with a bare BEL, and ends by renaming itself.
  await typeInTerminal(
    page,
    `sleep 3; touch '${started}'; for i in $(seq 1 40); do seq 1 20000; sleep 0.2; done; ` +
      `printf 'done\\a\\n'; sleep 1; printf '\\033]0;flood-tail\\007'; touch '${done}'`,
  );
  await page.keyboard.press('Enter');
  await a.click();
  await expect(a).toHaveAttribute('aria-selected', 'true');
  await expect(b).not.toHaveClass(/\bunread\b/);
  await expect(b).not.toHaveClass(/\bbell\b/);

  // While B floods: A takes input, and the board opens and closes.
  await expect.poll(() => existsSync(started), { timeout: 15_000 }).toBe(true);
  await renameByShell(page, 'tab-a-typed');
  await page.locator('#board-btn').click();
  await expect(page.locator('#tabs')).toBeHidden();
  await page.locator('#board-btn').click();
  await expect(page.locator('#tabs')).toBeVisible();
  await renameByShell(page, 'tab-a-back');
  await expect(b).toHaveClass(/\bunread\b/);
  expect(existsSync(done), 'the A interactions ran during the flood').toBe(false);

  // Once its flood has finished (however long a loaded machine takes), parked
  // B has heard its bell.
  await expect.poll(() => existsSync(done), { timeout: 60_000 }).toBe(true);
  await expect(b).toHaveClass(/\bbell\b/);

  // Activating B replays its flood: the tab takes the title, unread and bell
  // clear, and it takes input.
  await b.click();
  await expect(selectedName(page)).toHaveText('flood-tail', { timeout: 15_000 });
  const active = tabs(page).filter({ hasText: 'flood-tail' });
  await expect(active).not.toHaveClass(/\bunread\b/);
  await expect(active).not.toHaveClass(/\bbell\b/);
  await renameByShell(page, 'tab-b-typed');
});
