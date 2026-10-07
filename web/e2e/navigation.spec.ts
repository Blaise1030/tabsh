// URL navigation, end to end: a tab switch is a navigation, so Back and
// Forward walk the tabs, a reload keeps the tab, and a `?tab=` that names no
// tab, or a tab closed elsewhere, falls back to a shown tab with the URL
// fixed by a replace. Each test starts from one tab: the daemon is shared by
// the worker.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test } from './fixture.ts';

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');
const urlTab = (page: Page) => new URL(page.url()).searchParams.get('tab');
// The strip's index of the selected tab.
const selected = (page: Page) =>
  tabs(page).evaluateAll((els) => els.findIndex((t) => t.getAttribute('aria-selected') === 'true'));

// Waits until the selected tab is the `i`th and the URL names it, then
// returns its id.
async function onTab(page: Page, i: number): Promise<string> {
  await expect(tabs(page).nth(i)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => urlTab(page)).not.toBeNull();
  return urlTab(page) as string;
}

async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('Back and Forward walk the tabs', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  const b = await onTab(page, 1);
  await tabs(page).nth(0).click();
  const a = await onTab(page, 0);
  expect(a).not.toBe(b);

  await page.goBack();
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(urlTab(page)).toBe(b);

  await page.goForward();
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  expect(urlTab(page)).toBe(a);
});

test('a reload keeps the tab', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  await tabs(page).nth(0).click();
  const a = await onTab(page, 0);
  const url = page.url();

  await page.reload();
  await expect(tabs(page)).toHaveCount(2);
  await onTab(page, 0);
  expect(page.url()).toBe(url);
  expect(urlTab(page)).toBe(a);
});

test('an unknown tab falls back to a shown tab', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await page.goto(`${daemon.baseUrl}/app/?tab=nope`);
  await expect(tabs(page).first()).toBeVisible();
  await expect.poll(() => selected(page)).toBeGreaterThanOrEqual(0);
  await expect.poll(() => urlTab(page)).not.toBe('nope');
  await onTab(page, await selected(page));
});

test('a tab closed elsewhere is replaced, not pushed', async ({ page, daemon }) => {
  await openApp(page, daemon);
  const a = await onTab(page, 0);
  await newTab(page);
  const b = await onTab(page, 1);

  const headers = { Authorization: `Bearer ${daemon.token}` };
  await page.request.delete(`${daemon.baseUrl}/api/sessions/${b}`, { headers });
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => urlTab(page)).toBe(a);

  // B's entry was replaced, so Back lands on a place that still exists.
  await page.goBack();
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => urlTab(page)).toBe(a);
});
