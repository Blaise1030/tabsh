// The command palette, end to end: Basecoat's command menu caches its items,
// so after a page change the arrow keys and the filter must work on the new
// page's items, not the old page's.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { dropSessions, expect, openApp, test } from './fixture.ts';

const items = (page: Page) => page.locator('#palette-menu [role="menuitem"]');
const shown = (page: Page) => page.locator('#palette-menu [role="menuitem"]:not([aria-hidden="true"])');
const active = (page: Page) => page.locator('#palette-menu [role="menuitem"].active');

test('arrow keys work after changing page', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await page.locator('#settings-btn').click();
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
  await page.locator('#palette-input').fill('theme');
  await expect(active(page)).toHaveAttribute('data-filter', 'Theme…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /Search themes/);
  // The page starts on the current theme, the first item.
  await expect(active(page)).toHaveAttribute('data-filter', await items(page).nth(0).getAttribute('data-filter') ?? '');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const third = await items(page).nth(2).getAttribute('data-filter');
  expect(third).toBeTruthy();
  await expect(active(page)).toHaveCount(1);
  await expect(active(page)).toHaveAttribute('data-filter', third as string);

  await page.locator('#palette-input').pressSequentially('solarized');
  await expect(shown(page)).toHaveCount(2);
  await expect(shown(page).nth(0)).toHaveAttribute('data-filter', 'Solarized Dark');
  await expect(shown(page).nth(1)).toHaveAttribute('data-filter', 'Solarized Light');
});

const sessionRows = (page: Page) => page.locator('#palette-menu [role="menuitem"][data-session]:not([aria-hidden="true"])');
const paletteOpen = (page: Page) => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open);
const urlTab = (page: Page) => new URL(page.url()).searchParams.get('tab');

// A named card, made on the daemon; the app picks it up from the board events.
async function namedSession(page: Page, daemon: Daemon, name: string): Promise<string> {
  const res = await page.request.post(`${daemon.baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { name },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await expect(page.locator(`#tabs .tab:not(.mirror)`, { hasText: name })).toHaveCount(1);
  return id;
}

// The palette's default keybinding: ⌘K on a Mac, Ctrl+Shift+K elsewhere.
async function openPaletteWithKeys(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+Shift+K');
  await expect.poll(() => paletteOpen(page)).toBe(true);
}

test.describe('sessions in the palette', () => {
  test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
  test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

  test('typing part of a title lists that session, and Enter goes to it', async ({ page, daemon }) => {
    await openApp(page, daemon);
    const login = await namedSession(page, daemon, 'fix login bug');
    await namedSession(page, daemon, 'write release notes');
    await openPaletteWithKeys(page);
    await page.locator('#palette-input').fill('login');
    await expect(sessionRows(page)).toHaveCount(1);
    await expect(sessionRows(page).first()).toHaveAttribute('data-filter', 'fix login bug');
    await expect(active(page)).toHaveAttribute('data-session', login);
    await page.keyboard.press('Enter');
    await expect.poll(() => paletteOpen(page)).toBe(false);
    await expect.poll(() => urlTab(page)).toBe(login);
    await expect(page.locator('#tabs .tab:not(.mirror)[aria-selected="true"]')).toContainText('fix login bug');
  });

  test('> and part of a title lists only the sessions it matches', async ({ page, daemon }) => {
    await openApp(page, daemon);
    await namedSession(page, daemon, 'fix login bug');
    await namedSession(page, daemon, 'login page theme');
    await namedSession(page, daemon, 'write release notes');
    await openPaletteWithKeys(page);
    await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /> for sessions/);
    await page.locator('#palette-input').fill('>login');
    await expect(shown(page)).toHaveCount(2);
    await expect(sessionRows(page)).toHaveCount(2);
    // Without the prefix, settings match too.
    await page.locator('#palette-input').fill('theme');
    await expect(sessionRows(page)).toHaveCount(1);
    await expect(shown(page).filter({ hasNot: page.locator('[data-session]') })).not.toHaveCount(0);
    await expect(shown(page).nth(0)).toHaveAttribute('data-filter', 'login page theme');
    await page.locator('#palette-input').fill('>theme');
    await expect(shown(page)).toHaveCount(1);
  });

  test('with an empty search the recent sessions come first', async ({ page, daemon }) => {
    await openApp(page, daemon);
    const a = await namedSession(page, daemon, 'alpha');
    const b = await namedSession(page, daemon, 'bravo');
    await page.locator('#tabs .tab:not(.mirror)', { hasText: 'alpha' }).click();
    await expect.poll(() => urlTab(page)).toBe(a);
    await page.locator('#tabs .tab:not(.mirror)', { hasText: 'bravo' }).click();
    await expect.poll(() => urlTab(page)).toBe(b);
    await openPaletteWithKeys(page);
    // Sessions lead the list: the one visited before this one first.
    await expect(shown(page).first()).toHaveAttribute('data-session', a);
    await expect(sessionRows(page)).toHaveCount(3);
    await expect(sessionRows(page).last()).toHaveAttribute('data-session', b);
    await page.keyboard.press('Enter');
    await expect.poll(() => urlTab(page)).toBe(a);
  });

  test('on the board, going to a session opens its card in the drawer', async ({ page, daemon }) => {
    await openApp(page, daemon);
    const login = await namedSession(page, daemon, 'fix login bug');
    const url = new URL(page.url());
    url.searchParams.set('view', 'board');
    url.searchParams.delete('tab');
    await page.goto(url.toString());
    await expect(page.locator('#board')).toBeVisible();
    await openPaletteWithKeys(page);
    await page.locator('#palette-input').fill('>login');
    await page.keyboard.press('Enter');
    await expect.poll(() => urlTab(page)).toBe(login);
    await expect.poll(() => new URL(page.url()).searchParams.get('drawer')).toBe('1');
    await expect(page.locator('#board')).toBeVisible();
  });
});
