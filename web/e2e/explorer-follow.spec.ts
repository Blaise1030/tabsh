// The explorer follows the shell: `cd` into another project re-roots the
// tree, `cd` inside the project changes nothing, and switching to a tab in
// another project shows that project's tree.
import { cdInTerminal, expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

test('the tree follows the shell between projects and tabs', async ({ page, daemon, twins }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const within = { timeout: 3_000 };
  const run = async (command: string) => {
    await typeInTerminal(page, command);
    await page.keyboard.press('Enter');
  };

  await openApp(page, daemon);
  await cdInTerminal(page, twins.alpha, 'in-alpha');
  await page.locator('#explorer-btn').click();
  await expect(row('alpha.md')).toBeVisible();
  await expect(page.locator('#explorer-root')).toHaveText('alpha');

  await test.step('cd into another project re-roots the tree', async () => {
    await cdInTerminal(page, twins.beta, 'in-beta');
    await expect(row('beta.md')).toBeVisible(within);
    await expect(row('alpha.md')).toHaveCount(0);
    await expect(page.locator('#explorer-root')).toHaveText('beta');
  });

  await test.step('cd within the same repo changes nothing', async () => {
    await row('docs').click();
    await expect(row('guide.md')).toBeVisible();
    await run('mkdir sub && cd sub && printf "\\033]0;in-sub\\007"');
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('in-sub');
    await expect(row('sub')).toBeVisible(within);
    // Give a (wrong) re-fetch time to land: the open folder would have closed.
    await page.waitForTimeout(2_500);
    await expect(row('beta.md')).toBeVisible();
    await expect(row('guide.md')).toBeVisible();
  });

  await test.step('another tab in another project shows its own tree', async () => {
    await newTab(page);
    await cdInTerminal(page, twins.alpha, 'in-alpha-b');
    await expect(row('alpha.md')).toBeVisible(within);
    await expect(row('beta.md')).toHaveCount(0);
    await page.locator('#tabs .tab').first().click();
    await expect(row('beta.md')).toBeVisible(within);
    await expect(row('alpha.md')).toHaveCount(0);
  });

  await test.step('the socket moved with the root and still watches', async () => {
    await run('touch ../beta-2.md');
    await expect(row('beta-2.md')).toBeVisible(within);
  });

  // The sidebar's state is a saved setting, shared with the next spec.
  await page.locator('#explorer-btn').click();
  await expect(page.locator('#explorer')).toBeHidden();
});
