// The sidebar's chrome follows the listing while it stays open: the root's
// name and path in the heading, and a message in place of the tree (an empty
// folder) that gives way to the tree again.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cdInTerminal, expect, openApp, test } from './fixture.ts';

test('the heading and message follow the listing while the sidebar is open', async ({ page, daemon, twins }) => {
  const empty = realpathSync(mkdtempSync(path.join(tmpdir(), 'tabsh-empty-')));
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const heading = page.locator('#explorer-root');
  const message = page.locator('#explorer-msg');
  const tree = page.locator('#explorer-tree');
  const within = { timeout: 3_000 };

  try {
    await openApp(page, daemon);
    await cdInTerminal(page, twins.alpha, 'in-alpha');
    await page.locator('#explorer-btn').click();
    await expect(page.locator('#explorer-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(row('alpha.md')).toBeVisible();
    await expect(heading).toHaveText('alpha');
    await expect(heading).toHaveAttribute('title', twins.alpha);
    await expect(message).toBeHidden();

    await test.step('an empty folder: the message replaces the tree', async () => {
      await cdInTerminal(page, empty, 'in-empty');
      await expect(message).toHaveText('This folder is empty', within);
      await expect(message).toBeVisible();
      await expect(tree).toBeHidden();
      await expect(heading).toHaveText(path.basename(empty));
      await expect(heading).toHaveAttribute('title', empty);
      await expect(page.locator('#explorer-note')).toBeHidden();
    });

    await test.step('back in a project: the tree replaces the message', async () => {
      await cdInTerminal(page, twins.beta, 'in-beta');
      await expect(row('beta.md')).toBeVisible(within);
      await expect(tree).toBeVisible();
      await expect(message).toBeHidden();
      await expect(heading).toHaveText('beta');
      await expect(heading).toHaveAttribute('title', twins.beta);
    });

    // The sidebar's state is a saved setting, shared with the next spec.
    await page.locator('#explorer-btn').click();
    await expect(page.locator('#explorer')).toBeHidden();
    await expect(page.locator('#explorer-divider')).toBeHidden();
    await expect(page.locator('#explorer-btn')).toHaveAttribute('aria-pressed', 'false');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
