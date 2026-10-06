// Switching the tab filter from the palette, end to end: the filter button
// and its shortcut open the palette on its filter page; highlighting a repo
// or a tag previews the strip live, Enter keeps the filter, closing without
// a pick restores it, and "All tabs" clears it.
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// Name the active tab through the shell, the one DOM effect of output.
async function nameTab(page: Page, name: string): Promise<void> {
  await typeInTerminal(page, `printf '\\033]0;${name}\\007'`);
  await page.keyboard.press('Enter');
}

// Tag a tab from its right-click menu: type the tag, Enter adds it, Escape
// closes the menu.
async function tagTab(page: Page, tabName: string, tag: string): Promise<void> {
  await page.locator('#tabs .tab').filter({ hasText: tabName }).click({ button: 'right' });
  const menu = page.locator('.tab-menu[aria-label="Tab tags"]');
  await expect(menu).toBeVisible();
  await menu.locator('input[aria-label="New tag"]').fill(tag);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

const tab = (page: Page, name: string) => page.locator('#tabs .tab').filter({ hasText: name });
const item = (page: Page, name: string) => page.locator('#palette [role="menuitem"]').filter({ hasText: name });
// The palette dialog itself has no box (its .command child does), so its
// state is read from `open` rather than visibility.
const paletteOpen = (page: Page) => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open);
const paletteClosed = (page: Page) => expect.poll(() => paletteOpen(page)).toBe(false);
const paletteOpened = (page: Page) => expect.poll(() => paletteOpen(page)).toBe(true);

test('the palette switches the strip between repos and tags', async ({ page, daemon, twins }) => {
  const button = page.locator('#tab-filter-btn');
  const input = page.locator('#palette-input');
  const { alpha, beta } = twins;

  await openApp(page, daemon);
  await cdInTerminal(page, alpha, 'alpha-tab');
  await newTab(page);
  await cdInTerminal(page, beta, 'beta-tab');
  await newTab(page);
  await cdInTerminal(page, beta, 'work-tab');
  await tagTab(page, 'work-tab', 'work');
  // A tab's repo label is read when it activates, so walk the tabs once to
  // refresh them after their `cd`s — and leave beta-tab the active one.
  await tab(page, 'work-tab').click();
  await tab(page, 'alpha-tab').click();
  await tab(page, 'beta-tab').click();

  await test.step('the filter button opens the palette on its filter page', async () => {
    // The repo label lands with the activation's refresh; reopen if the page
    // was built before it did.
    await expect(async () => {
      if (await paletteOpen(page)) {
        await page.keyboard.press('Escape'); // back to the root page
        await page.keyboard.press('Escape'); // closed
        await paletteClosed(page);
      }
      await button.click();
      await expect(item(page, 'alpha')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await paletteOpened(page);
    await expect(input).toHaveAttribute('placeholder', /Filter tabs/);
    await expect(item(page, 'All tabs')).toBeVisible();
    await expect(item(page, 'beta')).toBeVisible();
    await expect(item(page, 'work')).toBeVisible();
    await expect(tab(page, 'work-tab')).toBeVisible();
  });

  await test.step('highlighting a repo or tag previews the strip', async () => {
    await page.keyboard.press('ArrowDown'); // All tabs → alpha
    await expect(tab(page, 'alpha-tab')).toBeVisible();
    await expect(tab(page, 'work-tab')).toBeHidden();
    await page.keyboard.press('ArrowDown'); // → beta
    await expect(tab(page, 'alpha-tab')).toBeHidden();
    await expect(tab(page, 'work-tab')).toBeVisible();
    await page.keyboard.press('ArrowDown'); // → work
    await expect(tab(page, 'alpha-tab')).toBeHidden();
    await expect(tab(page, 'work-tab')).toBeVisible();
    await page.keyboard.press('ArrowUp'); // back to beta
  });

  await test.step('Enter keeps the highlighted filter', async () => {
    await page.keyboard.press('Enter');
    await paletteClosed(page);
    await expect(tab(page, 'alpha-tab')).toBeHidden();
    await expect(tab(page, 'beta-tab')).toBeVisible();
    await expect(tab(page, 'work-tab')).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('the shortcut reopens the page at the current filter', async () => {
    await page.locator('.term.active').click();
    await page.keyboard.press('ControlOrMeta+Shift+KeyY');
    await paletteOpened(page);
    await expect(input).toHaveAttribute('placeholder', /Filter tabs/);
    await expect(item(page, 'beta')).toHaveAttribute('data-checked', 'true');
  });

  await test.step('typing picks a tag, replacing the filter', async () => {
    await page.keyboard.type('work');
    await page.keyboard.press('Enter');
    await paletteClosed(page);
    await expect(tab(page, 'alpha-tab')).toBeHidden();
    await expect(tab(page, 'work-tab')).toBeVisible(); // the active tab always stays
  });

  await test.step('closing without a pick restores the kept filter', async () => {
    await page.keyboard.press('ControlOrMeta+Shift+KeyY');
    await expect(item(page, 'work')).toHaveAttribute('data-checked', 'true');
    await page.keyboard.press('ArrowUp'); // → beta
    await page.keyboard.press('ArrowUp'); // → alpha, a preview that hides work-tab
    await expect(tab(page, 'work-tab')).toBeHidden();
    await page.keyboard.press('Escape'); // back to the root page
    await page.keyboard.press('Escape'); // closed: the kept filter returns
    await paletteClosed(page);
    await expect(tab(page, 'work-tab')).toBeVisible();
    await expect(tab(page, 'alpha-tab')).toBeHidden();
  });

  await test.step('"All tabs" clears the filter', async () => {
    await button.click();
    await item(page, 'All tabs').click();
    await paletteClosed(page);
    await expect(tab(page, 'alpha-tab')).toBeVisible();
    await expect(tab(page, 'beta-tab')).toBeVisible();
    await expect(tab(page, 'work-tab')).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});
