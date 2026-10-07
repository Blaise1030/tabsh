// The command palette, end to end: Basecoat's command menu caches its items,
// so after a page change the arrow keys and the filter must work on the new
// page's items, not the old page's.
import type { Page } from '@playwright/test';
import { expect, openApp, test } from './fixture.ts';

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
