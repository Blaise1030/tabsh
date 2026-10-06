// The tab filter, end to end: the filter button and its shortcut open the
// palette on its filter page, where highlighting a repo or tag previews the
// strip live, Enter keeps the filter, closing without a pick restores it, and
// "All tabs" clears it. The kept filter survives a reload, a tab opened under
// it joins it, the next/previous tab keys stay inside it, and a new tab under
// a repo filter starts in that repo. The daemon is shared by the worker, so
// earlier specs' tabs may be open: positions are counted from the tabs each
// test opens.
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

const tab = (page: Page, name: string) => page.locator('#tabs .tab').filter({ hasText: name });
const item = (page: Page, name: string) => page.locator('#palette [role="menuitem"]').filter({ hasText: name });
// The palette dialog itself has no box (its .command child does), so its
// state is read from `open` rather than visibility.
const paletteOpen = (page: Page) => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open);
const paletteClosed = (page: Page) => expect.poll(() => paletteOpen(page)).toBe(false);
const paletteOpened = (page: Page) => expect.poll(() => paletteOpen(page)).toBe(true);

// Move the palette's highlight to an item. Earlier specs on this worker's
// daemon may have left a repo of their own in between (explorer-actions leaves
// `src`), so step until it is there rather than counting.
async function highlight(page: Page, name: string, key: 'ArrowDown' | 'ArrowUp'): Promise<void> {
  const target = item(page, name);
  for (let step = 0; step < 10; step++) {
    if (await expect(target).toHaveClass(/active/, { timeout: 300 }).then(() => true, () => false)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toHaveClass(/active/);
}

// Name the active tab through the shell, the one DOM effect of output.
async function nameTab(page: Page, name: string): Promise<void> {
  await typeInTerminal(page, `printf '\\033]0;${name}\\007'`);
  await page.keyboard.press('Enter');
}

// Tag a tab from its right-click menu: type the tag, Enter adds it, Escape
// closes the menu.
async function tagTab(page: Page, tabName: string, tag: string): Promise<void> {
  await tab(page, tabName).click({ button: 'right' });
  const menu = page.locator('.tab-menu[aria-label="Tab tags"]');
  await expect(menu).toBeVisible();
  await menu.locator('input[aria-label="New tag"]').fill(tag);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

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
    await highlight(page, 'work', 'ArrowDown');
    await expect(tab(page, 'alpha-tab')).toBeHidden();
    await expect(tab(page, 'work-tab')).toBeVisible();
    await highlight(page, 'beta', 'ArrowUp'); // back to beta
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
    await highlight(page, 'alpha', 'ArrowUp'); // a preview that hides work-tab
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

test('the filter survives a reload, new tabs join it, and tab keys skip what it hides', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  const tabs = page.locator('#tabs .tab');
  const first = tabs.nth(0);
  const tagged = (await tabs.count()) - 1;

  // Tag the new tab and filter by its tag from the palette: the others hide.
  await tabs.nth(tagged).click({ button: 'right' });
  await page.getByPlaceholder('New tag…').fill('work');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#tab-filter-btn').click();
  await item(page, 'work').click();
  await expect(first).toBeHidden();

  // A reload keeps it. (Not openApp: it waits on the first tab, now hidden.)
  await page.reload();
  await expect(tabs.nth(tagged)).toBeVisible();
  await expect(page.locator('#tab-filter-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toBeHidden();

  // A new tab gets the tag, so it stays shown once another tab is active.
  await newTab(page);
  const added = tagged + 1;
  await tabs.nth(tagged).click();
  await expect(tabs.nth(added)).toBeVisible();
  await expect(first).toBeHidden();

  // Cycling goes between the two shown tabs, never through a hidden one.
  for (const want of [added, tagged, added]) {
    await page.keyboard.press('Control+Shift+BracketRight');
    await expect(tabs.nth(want)).toHaveAttribute('aria-selected', 'true');
  }
  await page.keyboard.press('Control+Shift+BracketLeft');
  await expect(tabs.nth(tagged)).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('aria-selected', 'false');
});

test('a new tab under a repo filter starts in that repo', async ({ page, daemon, twins }) => {
  await openApp(page, daemon);
  // Earlier specs' tabs may sit in another `alpha`: count from here. The page
  // is built when opened, so it is reopened until the count moves — and
  // closed again: the palette is modal, and would block the next click.
  // Exactly `alpha`: on Linux a deleted folder reads as `alpha (deleted)`.
  const alpha = item(page, 'alpha').filter({ has: page.locator('span', { hasText: /^alpha$/ }) });
  const alphaCount = async () => {
    await page.keyboard.press('Escape'); // the root page, or nothing to close
    await page.locator('#tab-filter-btn').click();
    const n = (await alpha.count()) ? Number(await alpha.locator('[data-shortcut]').textContent()) : 0;
    if (await paletteOpen(page)) {
      await page.keyboard.press('Escape'); // back to the root page
      await page.keyboard.press('Escape'); // closed
      await paletteClosed(page);
    }
    return n;
  };
  const before = await alphaCount();

  // The active tab's repo is re-read every few seconds.
  await newTab(page);
  await cdInTerminal(page, twins.alpha, 'in-alpha');
  await expect.poll(alphaCount, { timeout: 10_000 }).toBe(before + 1);
  await page.locator('#tab-filter-btn').click(); // the filter page, with alpha
  await alpha.click(); // picks the repo filter, closing the palette

  // The new tab starts in `alpha`, so it is one more under it.
  await newTab(page);
  await expect.poll(alphaCount, { timeout: 10_000 }).toBe(before + 2);
});
