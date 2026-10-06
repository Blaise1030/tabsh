// The tab filter: it survives a reload, a tab opened under it joins it, and
// the next/previous tab keys stay inside it. The daemon is shared by the
// worker, so earlier specs' tabs may be open: positions are counted from
// the tabs this spec opens.
import { cdInTerminal, expect, newTab, openApp, test } from './fixture.ts';

test('the filter survives a reload, new tabs join it, and tab keys skip what it hides', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);
  const tabs = page.locator('#tabs .tab');
  const first = tabs.nth(0);
  const tagged = (await tabs.count()) - 1;

  // Tag the new tab and filter by its tag: the others hide.
  await tabs.nth(tagged).click({ button: 'right' });
  await page.getByPlaceholder('New tag…').fill('work');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#tab-filter-btn').click();
  await page.locator('.filter-menu label', { hasText: 'work' }).click();
  await page.keyboard.press('Escape');
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
  // Earlier specs' tabs may sit in another `alpha`: count from here. The menu
  // is built when opened, so it is reopened until the count moves.
  const alpha = page.locator('.filter-menu label', { hasText: 'alpha' });
  const alphaCount = async () => {
    await page.keyboard.press('Escape');
    await page.locator('#tab-filter-btn').click();
    return (await alpha.count()) ? Number(await alpha.locator('small').textContent()) : 0;
  };
  const before = await alphaCount();

  // The active tab's repo is re-read every few seconds.
  await newTab(page);
  await cdInTerminal(page, twins.alpha, 'in-alpha');
  await expect.poll(alphaCount, { timeout: 10_000 }).toBe(before + 1);
  await alpha.click();
  await page.keyboard.press('Escape');

  // The new tab starts in `alpha`, so it is one more under it.
  await newTab(page);
  await expect.poll(alphaCount, { timeout: 10_000 }).toBe(before + 2);
});
