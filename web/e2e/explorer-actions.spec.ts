// Acting on an explorer row, end to end: its menu pastes the row's quoted path
// at the prompt, pastes a `cd` for a folder (never pressing Enter), and opens a
// terminal in the folder. The menu opens from the keyboard too.
import { cdInTerminal, expect, openApp, test, typeInTerminal } from './fixture.ts';

test("a row's menu inserts its path, cds there and opens a tab there", async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const menu = page.getByRole('menu', { name: 'File actions' });
  const item = (name: string) => menu.getByRole('menuitem', { name, exact: true });
  const label = page.locator('#tabs .tab[aria-selected="true"] span');
  // The shell's reply: the tab's name, set by an escape sequence.
  const titleWithDir = `printf '\\033]0;%s\\007' "$(basename "$PWD")"`;

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await expect(row("my file's notes.md")).toBeVisible();

  await test.step('Insert path pastes the quoted path of a file', async () => {
    await typeInTerminal(page, 'test -f ');
    await row("my file's notes.md").click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Insert path', 'Open in new tab']);
    await item('Insert path').click();
    await expect(menu).toBeHidden();
    // Focus is back in the terminal: typing continues the same line.
    await page.keyboard.type(` && printf '\\033]0;ok\\007'`);
    await page.keyboard.press('Enter');
    await expect(label).toHaveText('ok');
  });

  await test.step('cd here pastes a cd that waits for Enter', async () => {
    await row('src').click({ button: 'right' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Insert path', 'cd here', 'Open in new tab']);
    await item('cd here').click();
    await expect(menu).toBeHidden();
    await page.keyboard.press('Enter');
    await page.keyboard.type(titleWithDir);
    await page.keyboard.press('Enter');
    await expect(label).toHaveText('src');
  });

  await test.step('Open in new tab opens a terminal in the folder', async () => {
    await expect(page.locator('#tabs .tab')).toHaveCount(1);
    await row('src').click({ button: 'right' });
    await item('Open in new tab').click();
    await expect(page.locator('#tabs .tab')).toHaveCount(2);
    // The new shell may not be listening yet: retry, like cdInTerminal.
    await expect(async () => {
      await typeInTerminal(page, `\u0003${titleWithDir}`);
      await page.keyboard.press('Enter');
      await expect(label).toHaveText('src', { timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
  });

  await test.step('the menu opens from the keyboard and Escape returns to the row', async () => {
    await row('src').click();
    await expect(row('src')).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(item('Insert path')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(item('Open in new tab')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Insert path')).toBeFocused(); // wraps
    await page.keyboard.press('End');
    await expect(item('Open in new tab')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(row('src')).toBeFocused();
  });

  await test.step('an action runs from the keyboard alone', async () => {
    await page.keyboard.press('Shift+F10');
    await expect(item('Insert path')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('cd here')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await page.keyboard.press('Enter');
    await page.keyboard.type(titleWithDir);
    await page.keyboard.press('Enter');
    await expect(label).toHaveText('src');
  });

  // The daemon is shared by the worker's specs, and the sidebar's state is a
  // saved setting: leave it closed, as it starts.
  const saved = page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'PUT');
  await page.locator('#explorer-btn').click();
  await saved;
});
