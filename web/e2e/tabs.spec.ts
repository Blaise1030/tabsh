// Tabs as components, end to end: a tab's label follows its session's name,
// a closing tab collapses before it goes, and the page has no tab template
// (tabs are rendered from state). Each test starts from one tab: the daemon
// is shared by the worker.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test } from './fixture.ts';

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');
const urlTab = (page: Page) => new URL(page.url()).searchParams.get('tab');

async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('a renamed tab updates its label and title', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect.poll(() => urlTab(page)).not.toBeNull();
  const id = urlTab(page) as string;
  const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { name: 'renamed' },
  });
  expect(res.status()).toBe(204);
  // Coming back to the window syncs the tabs with the daemon.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const tab = tabs(page).first();
  await expect(tab.locator('.tab-name')).toHaveText('renamed');
  await expect(tab).toHaveAttribute('title', 'renamed');
});

test('a closing tab collapses then goes', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  await expect(tabs(page)).toHaveCount(2);
  const closing = tabs(page).first();
  // Held, so it can be checked after it leaves the page.
  const node = await closing.elementHandle();
  await closing.hover();
  await closing.getByRole('button', { name: 'Close terminal' }).click();
  await expect.poll(() => node?.evaluate((t) => t.classList.contains('leaving'))).toBe(true);
  await expect.poll(() => node?.evaluate((t) => t.isConnected), { timeout: 1_000 }).toBe(false);
  await expect(page.locator('#tabs .tab')).toHaveCount(1);
});

test('no tab-template in the page', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(page.locator('#tab-template')).toHaveCount(0);
});
