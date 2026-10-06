// Searching the explorer by name, end to end: `/` opens the search field from
// a focused row, typing filters to matches and their folders, Enter opens the
// focused match in the pane, Escape restores the tree with its open folders,
// live updates still reach a filtered tree, and the palette's "Search files"
// opens the sidebar and the field.
import { cdInTerminal, expect, openApp, test, typeInTerminal } from './fixture.ts';

test('search filters the tree by name, opens a match and restores the tree', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const field = page.locator('#explorer').getByPlaceholder('Search…');
  const open = page.locator('#explorer [data-file-tree-search-container]'); // stays in the DOM, closed
  const within = { timeout: 3_000 };

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await expect(row('docs')).toBeVisible();
  await row('docs').click(); // open, so that Escape has folders to restore
  await expect(row('docs')).toHaveAttribute('aria-expanded', 'true');

  await test.step('/ opens the search field from a focused row', async () => {
    await row('README.md').focus();
    await page.keyboard.press('/');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');
  });

  await test.step('typing filters to matches and their folders', async () => {
    await page.keyboard.type('main');
    await expect(row('main.rs')).toBeVisible();
    await expect(row('src')).toBeVisible();
    await expect(row('README.md')).toHaveCount(0);
    await expect(row('.env.example')).toHaveCount(0);
  });

  await test.step('Enter opens the focused match in the pane', async () => {
    await page.keyboard.press('Enter');
    await expect(page.locator('#pane')).toBeVisible();
    await expect(page.locator('#pane .pane-head')).toContainText('main.rs');
  });

  await test.step('Escape clears the search and keeps the open folders', async () => {
    await row('src').focus();
    await page.keyboard.press('/');
    await expect(field).toBeFocused();
    await page.keyboard.type('read');
    await expect(row('docs')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(open).toHaveAttribute('data-open', 'false');
    await expect(row('README.md')).toBeVisible();
    await expect(row('docs')).toHaveAttribute('aria-expanded', 'true');
  });

  await test.step('live updates still apply while searching', async () => {
    // A blur closes the search, so the file is made by a command that waits:
    // typed in the terminal first, landing while the search is open.
    await typeInTerminal(page, 'sleep 2 && touch src/new-file.rs');
    await page.keyboard.press('Enter');
    await row('src').focus();
    await page.keyboard.press('/');
    await page.keyboard.type('new');
    await expect(row('main.rs')).toHaveCount(0);
    await expect(row('new-file.rs')).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');
  });

  await test.step('the palette opens the sidebar with the field focused', async () => {
    await page.keyboard.press('ControlOrMeta+Shift+KeyE');
    await expect(page.locator('#explorer')).toBeHidden();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Search files' }).click();
    await expect(page.locator('#explorer')).toBeVisible();
    await expect(field).toBeFocused();
  });

  // The daemon is shared by the worker's specs, and the sidebar's state is a
  // saved setting: leave it closed, as it starts.
  const saved = page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'PUT');
  await page.locator('#explorer-btn').click();
  await saved;
});
