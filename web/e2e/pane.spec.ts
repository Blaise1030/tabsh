// The file pane, end to end: a theme change re-themes the open file in
// place, keeping its one frame or editor, the unsaved dot and the edit.
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, openApp, test } from './fixture.ts';

const shown = (page: Page) => page.locator('#pane .pane-view:not([hidden])');

// Picks `name` from the palette's theme page.
async function pickTheme(page: Page, name: string): Promise<void> {
  await page.locator('#settings-btn').click();
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
  await page.locator('#palette-input').fill('theme');
  await expect(page.locator('#palette-menu [role="menuitem"].active')).toHaveAttribute('data-filter', 'Theme…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /Search themes/);
  await page.locator('#palette-input').fill(name);
  await expect(page.locator('#palette-menu [role="menuitem"].active')).toHaveAttribute('data-filter', name);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
}

// One frame or one editor, never both or two.
async function oneBody(page: Page): Promise<void> {
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page).locator('.pane-frame, .cm-editor')).toHaveCount(1);
}

test('a theme change keeps the edit and the dirty dot', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const toggle = () => shown(page).locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await row('README.md').click();
  await expect(shown(page).locator('.pane-head')).toContainText('README.md');
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);

  // Edit: the source in CodeMirror, then a change.
  await toggle().click();
  await expect(shown(page).locator('.cm-content')).toBeVisible();
  await shown(page).locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('typed here');
  await expect(shown(page).locator('.pane-dot')).toBeVisible();

  await pickTheme(page, 'Solarized Light');
  await oneBody(page);
  await expect(shown(page).locator('.cm-editor')).toHaveCount(1);
  await expect(shown(page).locator('.pane-dot')).toBeVisible();
  await expect(shown(page).locator('.cm-content')).toContainText('typed here');

  // The preview of the edited text, re-themed in its one frame.
  await toggle().click();
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);
  await expect(shown(page).frameLocator('.pane-frame').locator('body')).toContainText('typed here');
  await pickTheme(page, 'Solarized Dark');
  await oneBody(page);
  await expect(shown(page).frameLocator('.pane-frame').locator('body')).toContainText('typed here');
  await expect(shown(page).locator('.pane-dot')).toBeVisible();

  await toggle().click();
  await oneBody(page);
  await expect(shown(page).locator('.cm-content')).toContainText('typed here');
  await expect(shown(page).locator('.pane-dot')).toBeVisible();
});
