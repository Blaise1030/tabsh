// The file explorer, end to end: open the sidebar in a project, see its
// files (ignored ones left out, names rendered as text), open one in the file
// pane, keep the sidebar's state across a reload, and see "too many files"
// where there is no project to show.
import { cdInTerminal, expect, newTab, openApp, test } from './fixture.ts';

const MARKUP = '<img src=x onerror=alert(1)>.txt';

test('the explorer shows the tab\'s project and opens a file in the pane', async ({ page, daemon, project, crowd }) => {
  // A file name that ran script would raise an alert.
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const settingsSaved = () =>
    page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'PUT');
  const toggleKey = 'ControlOrMeta+Shift+E';

  await openApp(page, daemon);
  // Inside src/: the tree is still rooted at the repo.
  await cdInTerminal(page, `${project}/src`, 'in-src');

  await test.step('the button opens the sidebar on the repo root', async () => {
    await page.locator('#explorer-btn').click();
    await expect(page.locator('#explorer')).toBeVisible();
    for (const name of ['README.md', 'src', 'docs', '.env.example']) await expect(row(name)).toBeVisible();
    await expect(row('target')).toHaveCount(0);
    await expect(row('main.rs')).toHaveCount(0); // src is closed
  });

  await test.step('a name that is markup shows as text', async () => {
    await expect(row(MARKUP)).toBeVisible();
    const img = await page.locator('file-tree-container').evaluate((host) => host.shadowRoot?.querySelector('img'));
    expect(img).toBeNull();
  });

  await test.step('clicking a file opens it in the pane', async () => {
    await row('src').click();
    await row('main.rs').click();
    await expect(page.locator('#pane')).toBeVisible();
    await expect(page.locator('#pane .pane-head')).toContainText('main.rs');
  });

  await test.step('the width survives a reload', async () => {
    const width = async () => (await page.locator('#explorer').boundingBox())!.width;
    const before = await width();
    const handle = (await page.locator('#explorer-divider').boundingBox())!;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + 0.5, y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 100, y, { steps: 5 });
    const saved = settingsSaved();
    await page.mouse.up();
    await saved;
    const after = await width();
    expect(after).toBeGreaterThan(before + 50);
    await page.reload();
    await expect(page.locator('#explorer')).toBeVisible();
    await expect(row('README.md')).toBeVisible();
    expect(Math.abs((await width()) - after)).toBeLessThan(4);
  });

  await test.step('the shortcut hides it, and that survives a reload', async () => {
    await page.locator('.term.active').click();
    const saved = settingsSaved();
    await page.keyboard.press(toggleKey);
    await saved;
    await expect(page.locator('#explorer')).toBeHidden();
    await page.reload();
    await expect(page.locator('#tabs .tab').first()).toBeVisible();
    await expect(page.locator('#explorer')).toBeHidden();
  });

  await test.step('a place with too many files shows a message, not a tree', async () => {
    await newTab(page);
    await cdInTerminal(page, crowd, 'in-crowd');
    await page.locator('#explorer-btn').click();
    await expect(page.locator('#explorer')).toContainText('Too many files');
    await expect(page.locator('#explorer file-tree-container')).toBeHidden();
  });

  expect(dialogs).toEqual([]);
});
