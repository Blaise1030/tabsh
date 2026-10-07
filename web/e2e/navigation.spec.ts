// URL navigation, end to end: a tab switch is a navigation, so Back and
// Forward walk the tabs, a reload keeps the tab, and a `?tab=` that names no
// tab, or a tab closed elsewhere, falls back to a shown tab with the URL
// fixed by a replace. Each test starts from one tab: the daemon is shared by
// the worker.
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { cdInTerminal, expect, newTab, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

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

test('the board is a place', async ({ page, daemon }) => {
  await setOnboarded(page, daemon, true);
  await openApp(page, daemon);
  await newTab(page);
  await onTab(page, 1);
  await page.locator('#board-btn').click();
  await expect(page.locator('#board')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#board')).toBeHidden();
  await page.goBack();
  await onTab(page, 0);
  await expect(page.locator('#terms')).toBeVisible();
  await expect(page.locator('#board')).toBeHidden();
  await page.goForward();
  await onTab(page, 1);
  await page.goForward();
  await expect(page.locator('#board')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('board');
});

// Files: the active tab's file and line are part of the place.
const pane = (page: Page) => page.locator('#pane');
const urlFile = (page: Page) => new URL(page.url()).searchParams.get('file');
const urlLine = (page: Page) => new URL(page.url()).searchParams.get('line');

// Has the shell print `shown` on a line of its own (`typed` is how the
// command spells it, so the command's own line doesn't match), then
// Cmd/Ctrl-clicks it: a terminal link, opened through go().
async function openLink(page: Page, typed: string, shown: string): Promise<void> {
  await typeInTerminal(page, `echo ${typed}`);
  await page.keyboard.press('Enter');
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = page.locator('.term.active .xterm-rows > div', { hasText: new RegExp(`^${escaped}\\s*$`) }).last();
  await expect(row).toBeVisible();
  const name = shown.split(':')[0].split('/').pop() as string;
  await expect(async () => {
    await row.hover({ position: { x: 8, y: 6 } });
    await row.click({ position: { x: 8, y: 6 }, modifiers: ['ControlOrMeta'] });
    await expect(page.locator('#pane .pane-head')).toContainText(name, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

test('a file and line survive a reload', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, "src/main.rs':1'", 'src/main.rs:1');
  // The resolved path, so a reload after a `cd` reopens the same file.
  await expect.poll(() => urlFile(page)).toBe(`${project}/src/main.rs`);
  expect(urlLine(page)).toBe('1');
  const url = page.url();

  await page.reload();
  await expect(pane(page)).toBeVisible();
  await expect(page.locator('#pane .pane-head')).toContainText('main.rs');
  expect(page.url()).toBe(url);
});

test('Back closes the file, Forward reopens it', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, 'src/main.rs', 'src/main.rs');
  await expect.poll(() => urlFile(page)).toBe(`${project}/src/main.rs`);

  await page.goBack();
  await expect(pane(page)).toBeHidden();
  expect(urlFile(page)).toBeNull();

  await page.goForward();
  await expect(page.locator('#pane .pane-head')).toContainText('main.rs');
  expect(urlFile(page)).toBe(`${project}/src/main.rs`);
});

test('unsaved edits ask before Back', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, 'src/main.rs', 'src/main.rs');
  await expect.poll(() => urlFile(page)).toBe(`${project}/src/main.rs`);
  const url = page.url();
  await page.locator('#pane .cm-content').click();
  await page.keyboard.press('ControlOrMeta+E');
  await page.keyboard.press('End');
  await page.keyboard.type('// edited');
  await expect(page.locator('#pane .pane-dot')).toBeVisible();

  const asked: string[] = [];
  page.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.evaluate(() => navigation.back().finished.catch(() => {}));
  await expect.poll(() => asked.length).toBe(1);
  await expect(page.locator('#pane .cm-content')).toContainText('// edited');
  await expect.poll(() => page.url()).toBe(url);

  await page.evaluate(() => (navigation.canGoForward ? navigation.forward().finished.catch(() => {}) : undefined));
  await expect(page.locator('#pane .cm-content')).toContainText('// edited');
  expect(page.url()).toBe(url);
});

test('rapid Back keeps the latest', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, 'README.md', 'README.md');
  await expect.poll(() => urlFile(page)).toBe(`${project}/README.md`);
  await openLink(page, 'src/main.rs', 'src/main.rs');
  await expect.poll(() => urlFile(page)).toBe(`${project}/src/main.rs`);

  // The second Back starts while the first is still loading README.
  await page.evaluate(async () => {
    await navigation.back().committed;
    await navigation.back().finished.catch(() => {});
  });
  await expect(pane(page)).toBeHidden();
  expect(urlFile(page)).toBeNull();
});

test('a deleted file is dropped quietly', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, 'README.md', 'README.md');
  await expect.poll(() => urlFile(page)).toBe(`${project}/README.md`);
  await page.locator('#pane .pane-head button[aria-label="Close file"]').click();
  await expect(pane(page)).toBeHidden();
  expect(urlFile(page)).toBeNull();
  rmSync(path.join(project, 'README.md'));

  await page.goBack();
  await expect.poll(() => urlFile(page)).toBeNull();
  await expect(pane(page)).toBeHidden();
});

test('steps an overtaken Back never ran still run', async ({ page, daemon, project }) => {
  await setOnboarded(page, daemon, true);
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await openLink(page, 'README.md', 'README.md');
  await expect.poll(() => urlFile(page)).toBe(`${project}/README.md`);
  await page.locator('#board-btn').click();
  await expect(page.locator('#board')).toBeVisible();
  // A URL that keeps the board and names another file.
  const q = new URLSearchParams(new URL(page.url()).search);
  q.set('file', `${project}/src/main.rs`);
  await page.evaluate((s) => navigation.navigate(`?${s}`).finished, q.toString());
  await expect(page.locator('#pane .pane-head')).toContainText('main.rs');

  // The first Back (to README, board open) is overtaken while README loads;
  // the second (board closed) must still show README.
  await page.evaluate(async () => {
    await navigation.back().committed;
    await navigation.back().finished.catch(() => {});
  });
  await expect(page.locator('#board')).toBeHidden();
  expect(urlFile(page)).toBe(`${project}/README.md`);
  await expect(page.locator('#pane .pane-head')).toContainText('README.md');
});

test('a tab switch overtaken mid-load is still undone', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  const a = await onTab(page, 0);
  await newTab(page);
  const b = await onTab(page, 1);
  // B shows README, then back on A, with no file.
  await page.evaluate((u) => navigation.navigate(u).finished, `?tab=${b}&file=${encodeURIComponent(`${project}/README.md`)}`);
  await expect(page.locator('#pane .pane-head')).toContainText('README.md');
  await tabs(page).nth(0).click();
  await onTab(page, 0);
  await expect(pane(page)).toBeHidden();

  // To B with another file, and Back to A before that file loads.
  await page.evaluate(
    async (u) => {
      await navigation.navigate(u).committed;
      await navigation.back().finished.catch(() => {});
    },
    `?tab=${b}&file=${encodeURIComponent(`${project}/src/main.rs`)}`,
  );
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  expect(urlTab(page)).toBe(a);
  expect(urlFile(page)).toBeNull();
  await expect(pane(page)).toBeHidden();

  // B kept README, and a switch to it puts README in the URL.
  await tabs(page).nth(1).click();
  await expect.poll(() => urlFile(page)).toBe(`${project}/README.md`);
  await expect(page.locator('#pane .pane-head')).toContainText('README.md');
});
