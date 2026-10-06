// The explorer follows the disk: files and folders created, renamed and
// deleted from the shell show up in the open tree within a moment, open
// folders stay open, ignored paths never appear, and a huge change or a
// .gitignore edit re-fetches the whole tree.
import { cdInTerminal, expect, openApp, test, typeInTerminal } from './fixture.ts';

test('the tree stays current as files change on disk', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const within = { timeout: 3_000 };
  const run = async (command: string) => {
    await typeInTerminal(page, command);
    await page.keyboard.press('Enter');
  };

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await expect(row('src')).toBeVisible();
  await row('src').click();
  await expect(row('main.rs')).toBeVisible();

  await test.step('a new file appears under the open folder', async () => {
    await run('touch src/new.rs');
    await expect(row('new.rs')).toBeVisible(within);
    await expect(row('main.rs')).toBeVisible();
  });

  await test.step('a new folder brings its children', async () => {
    await run('mkdir -p lib/deep && touch lib/deep/x.ts');
    await expect(row('lib')).toBeVisible(within);
    await row('lib').click();
    await row('deep').click();
    await expect(row('x.ts')).toBeVisible();
  });

  await test.step('a rename is a removal and an addition', async () => {
    await run('mv src/new.rs src/renamed.rs');
    await expect(row('renamed.rs')).toBeVisible(within);
    await expect(row('new.rs')).toHaveCount(0);
  });

  await test.step('a deleted folder goes with its children', async () => {
    await run('rm -r lib');
    await expect(row('lib')).toHaveCount(0, within);
  });

  await test.step('ignored paths never appear', async () => {
    await run('touch target/ignored.txt && touch src/marker.txt');
    await expect(row('marker.txt')).toBeVisible(within);
    await expect(row('target')).toHaveCount(0);
  });

  await test.step('a .gitignore edit re-fetches the tree', async () => {
    await expect(row('docs')).toBeVisible();
    await run("echo 'docs/' >> .gitignore");
    await expect(row('docs')).toHaveCount(0, within);
    await expect(row('main.rs')).toBeVisible(); // src is still open
  });

  await test.step('a huge change re-fetches the tree and keeps open folders', async () => {
    // One process makes them all within a window: more than a batch carries.
    await run('touch $(seq -f bulk%g 1 1500)');
    await expect(row('bulk1')).toBeVisible({ timeout: 10_000 });
    // The tree draws only the rows in view: scroll to the end of the list.
    await expect(async () => {
      await page.locator('file-tree-container').evaluate((host) => {
        for (const el of host.shadowRoot?.querySelectorAll('div') ?? []) el.scrollTop = el.scrollHeight;
      });
      await expect(row('bulk1500')).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.locator('file-tree-container').evaluate((host) => {
      for (const el of host.shadowRoot?.querySelectorAll('div') ?? []) el.scrollTop = 0;
    });
    await expect(row('main.rs')).toBeVisible();
  });

  // The sidebar's state is a saved setting, shared with the next spec.
  await page.locator('#explorer-btn').click();
  await expect(page.locator('#explorer')).toBeHidden();
});
