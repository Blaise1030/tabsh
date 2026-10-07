// Tabs as components, end to end: a tab's label follows its session's name,
// a closing tab collapses before it goes (its copies under other tags too),
// a rename mid-drag keeps the drag, and the page has no tab template (tabs
// are rendered from state). Each test starts from one tab: the daemon is
// shared by the worker.
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

// Renames tab `id` on the daemon, then syncs, as coming back to the window does.
async function rename(page: Page, daemon: Daemon, id: string, name: string): Promise<void> {
  const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { name },
  });
  expect(res.status()).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

// Picks a grouping from the group button's palette page.
async function groupBy(page: Page, label: string): Promise<void> {
  await page.locator('#tab-group-btn').click();
  await page.locator(`#palette [role="menuitem"][data-filter="${label}"]`).click();
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
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

test('closing a tagged tab removes its copies', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  await expect.poll(() => urlTab(page)).not.toBeNull();
  await rename(page, daemon, urlTab(page) as string, 'tagged');
  const tagged = page.locator('#tabs .tab').filter({ hasText: 'tagged' });
  await expect(tagged).toHaveCount(1);
  // Tagged `a` and `b`: grouped by tag, it shows twice, once as a copy.
  await tagged.click({ button: 'right' });
  const menu = page.locator('.tab-menu[aria-label="Tab tags"]');
  for (const tag of ['a', 'b']) {
    await menu.locator('input[aria-label="New tag"]').fill(tag);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // The grouping is the daemon's setting, shared by the worker: put it back.
  try {
    await groupBy(page, 'By tag');
    await expect(tagged).toHaveCount(2);
    await expect(tagged.and(page.locator('.mirror'))).toHaveCount(1);
    // Their groups empty as it closes, yet the tab and its copy both
    // collapse on screen (still there frames after `.leaving`) before they go.
    await page.locator('#tabs .tab').evaluateAll((all) => {
      const w = window as unknown as { collapsedOnScreen: string[] };
      w.collapsedOnScreen = [];
      for (const t of all) {
        if (!t.textContent?.includes('tagged')) continue;
        const kind = t.classList.contains('mirror') ? 'copy' : 'tab';
        const seen = new MutationObserver(() => {
          if (!t.classList.contains('leaving')) return;
          seen.disconnect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => t.isConnected && w.collapsedOnScreen.push(kind)),
          );
        });
        seen.observe(t, { attributes: true, attributeFilter: ['class'] });
      }
    });
    const tab = tagged.and(page.locator(':not(.mirror)'));
    await tab.hover();
    await tab.getByRole('button', { name: 'Close terminal' }).click();
    await expect(tagged).toHaveCount(0, { timeout: 1_000 });
    expect(
      (await page.evaluate(() => (window as unknown as { collapsedOnScreen: string[] }).collapsedOnScreen)).sort(),
    ).toEqual(['copy', 'tab']);
  } finally {
    await groupBy(page, 'No grouping');
  }
});

test('a rename mid-drag keeps the drag', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  await expect(tabs(page)).toHaveCount(2);
  await expect.poll(() => urlTab(page)).not.toBeNull();
  const id = urlTab(page) as string; // the new tab, second on the strip
  const [first, second] = [tabs(page).nth(0), tabs(page).nth(1)];
  const node = await second.elementHandle();
  const from = await second.boundingBox();
  if (!from) throw new Error('not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 4 });
  await expect(second).toHaveClass(/dragging/);
  // Renamed while held: the same node keeps following the pointer.
  await rename(page, daemon, id, 'renamed-mid-drag');
  await expect.poll(() => node?.evaluate((t) => t.querySelector('.tab-name')?.textContent)).toBe('renamed-mid-drag');
  expect(await node?.evaluate((t) => t.isConnected && t.classList.contains('dragging'))).toBe(true);
  const to = await first.boundingBox();
  if (!to) throw new Error('not on screen');
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(tabs(page).first().locator('.tab-name')).toHaveText('renamed-mid-drag');
  await expect(tabs(page).first()).not.toHaveClass(/dragging/);
  const headers = { Authorization: `Bearer ${daemon.token}` };
  await expect
    .poll(async () => ((await (await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers })).json()) as { id: string }[])[0]?.id)
    .toBe(id);
});

test('regrouping moves tabs without growing them in again', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator('#tabs .tab.entering')).toHaveCount(0);
  // From here, note any tab that starts growing in.
  await page.evaluate(() => {
    const w = window as unknown as { grew: number };
    w.grew = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        const nodes = r.type === 'childList' ? [...r.addedNodes] : [r.target];
        for (const n of nodes)
          if (n instanceof Element) w.grew += [n, ...n.querySelectorAll('*')].filter((e) => e.matches('.tab.entering')).length;
      }
    }).observe(document.getElementById('tabs') as HTMLElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  try {
    await groupBy(page, 'By repo');
    await expect(page.locator('#tabs .tab-group').first()).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
  } finally {
    await groupBy(page, 'No grouping');
  }
  await expect(page.locator('#tabs .tab-group')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { grew: number }).grew)).toBe(0);
});

test('no tab-template in the page', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(page.locator('#tab-template')).toHaveCount(0);
});

test('the empty state stays hidden while tabs are restored', async ({ page, daemon }) => {
  await openApp(page, daemon);
  // From before the page's own scripts: note any moment #empty is shown.
  await page.addInitScript(() => {
    const w = window as unknown as { emptyShown: boolean };
    w.emptyShown = false;
    new MutationObserver(() => {
      const empty = document.getElementById('empty');
      if (empty && !empty.hidden) w.emptyShown = true;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  });
  await page.reload();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as unknown as { emptyShown: boolean }).emptyShown)).toBe(false);
});
