// Tab groups, end to end: the group button and its shortcut open the palette
// on its grouping page, which previews each choice; by tag, each tag gets a
// label followed by its tabs, a tab with two tags shows under both, a
// label's click collapses its group (kept across a reload), the tab keys
// skip collapsed groups, a new tab joins the active tab's group, and a tab
// dragged into another tag's group trades tags; by repo, a new tab starts in
// the active tab's repo, and a tab dragged to another repo goes back. The daemon (and so the
// grouping setting) is shared by the worker, so each test puts grouping back
// to none, and earlier specs' tabs, all untagged, sit in "Untagged".
import type { Locator, Page } from '@playwright/test';
import { cdInTerminal, expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

const tab = (page: Page, name: string) => page.locator('#tabs .tab:not(.mirror)').filter({ hasText: name });
const chip = (page: Page, name: string) =>
  page.locator('#tabs .tab-group').filter({ has: page.locator('.tab-group-name', { hasText: new RegExp(`^${name}$`) }) });
const item = (page: Page, name: string) => page.locator(`#palette [role="menuitem"][data-filter="${name}"]`);
const paletteOpen = (page: Page) => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open);

// The names of the shown tabs (copies included) under a group, in order.
const inGroup = (page: Page, key: string) =>
  page
    .locator(`#tabs .tab[data-group="${key}"]:not([hidden])`)
    .evaluateAll((tabs) => tabs.map((t) => t.querySelector('.tab-name')?.textContent));

// Name the active tab through the shell, the one DOM effect of output. It
// waits for the shell's prompt first: a ^C while a login shell is still
// starting can end it.
async function nameTab(page: Page, name: string): Promise<void> {
  await expect(page.locator('.term.active .xterm-rows')).not.toHaveText(/^\s*$/, { timeout: 10_000 });
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, `printf '\\033]0;${name}\\007'`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab:not(.mirror)[aria-selected="true"] span')).toHaveText(name, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 10_000 });
}

// Tag a tab from its right-click menu: type each tag, Enter adds it, Escape
// closes the menu.
async function tagTab(page: Page, name: string, ...tags: string[]): Promise<void> {
  await tab(page, name).click({ button: 'right' });
  const menu = page.locator('.tab-menu[aria-label="Tab tags"]');
  await expect(menu).toBeVisible();
  for (const tag of tags) {
    await menu.locator('input[aria-label="New tag"]').fill(tag);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

// Drag `from` with the mouse and let it go over `to`, read again once the
// drag has started (the strip shifts as the tab leaves its place). `during`
// runs with the tab held over `to`. Earlier specs' tabs can overflow the
// strip, so both are scrolled into view first.
async function drag(page: Page, from: Locator, to: Locator, during?: () => Promise<void>): Promise<void> {
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const centre = async (l: Locator) => {
    const b = await l.boundingBox();
    if (!b) throw new Error('not on screen');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a = await centre(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y, { steps: 3 });
  for (let i = 0; i < 2; i++) {
    const b = await centre(to);
    await page.mouse.move(b.x, b.y, { steps: 10 });
  }
  await during?.();
  await page.mouse.up();
}

// Pick a grouping from the group button's palette page.
async function groupBy(page: Page, label: string): Promise<void> {
  if (await paletteOpen(page)) await page.keyboard.press('Escape');
  await page.locator('#tab-group-btn').click();
  await item(page, label).click();
  await expect.poll(() => paletteOpen(page)).toBe(false);
}

test.afterEach(async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await groupBy(page, 'No grouping');
});

test('by tag, each tag labels its tabs, collapsing hides them, and tab keys skip them', async ({ page, daemon }) => {
  test.slow(); // five tabs, a reload and six steps: more than the default 30s on a busy machine
  const button = page.locator('#tab-group-btn');
  await openApp(page, daemon);
  for (const name of ['one', 'two', 'three', 'four']) {
    await newTab(page);
    await nameTab(page, name);
  }
  await tagTab(page, 'one', 'red', 'blue');
  await tagTab(page, 'two', 'blue');
  await tagTab(page, 'three', 'green');
  await tagTab(page, 'four', 'green');
  await expect(page.locator('#tabs .tab-group')).toHaveCount(0);

  await test.step('the palette previews a grouping, and closing it puts the strip back', async () => {
    await page.locator('.term.active').click();
    await page.keyboard.press('ControlOrMeta+Shift+KeyY');
    await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /Group tabs/);
    await item(page, 'By tag').hover();
    await expect(chip(page, 'red')).toBeVisible();
    await page.keyboard.press('Escape'); // back to the root page
    await page.keyboard.press('Escape'); // closed
    await expect(page.locator('#tabs .tab-group')).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('by tag, a tab with two tags shows under both', async () => {
    await groupBy(page, 'By tag');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await inGroup(page, 'tag:red')).toEqual(['one']);
    expect(await inGroup(page, 'tag:blue')).toEqual(['one', 'two']);
    expect(await inGroup(page, 'tag:green')).toEqual(['three', 'four']);
    await expect(chip(page, 'Untagged')).toBeVisible();
  });

  await test.step('a label collapses its group, and a reload keeps it', async () => {
    await tab(page, 'one').click();
    await chip(page, 'blue').click();
    await chip(page, 'Untagged').click();
    // The active tab stays, wherever it shows.
    expect(await inGroup(page, 'tag:blue')).toEqual(['one']);
    await expect(chip(page, 'blue').locator('small')).toHaveText('2');
    await page.reload();
    await expect(chip(page, 'blue')).toHaveAttribute('aria-expanded', 'false');
    expect(await inGroup(page, 'tag:blue')).toEqual(['one']);
    await expect(tab(page, 'two')).toBeHidden();
  });

  await test.step('the tab keys walk the shown tabs, past collapsed groups', async () => {
    // Shown: red [one], blue [one, the active tab's copy], green [three, four].
    await tab(page, 'one').click();
    for (const [key, want] of [
      ['BracketRight', 'three'], // past one's copy under blue
      ['BracketRight', 'four'],
      ['BracketRight', 'one'], // wrapped, past the collapsed groups
      ['BracketLeft', 'four'],
    ]) {
      await page.keyboard.press(`Control+Shift+${key}`);
      await expect(tab(page, want)).toHaveAttribute('aria-selected', 'true');
    }
  });

  await test.step("a new tab joins the active tab's tag", async () => {
    await tab(page, 'three').click();
    await newTab(page);
    await nameTab(page, 'five');
    expect(await inGroup(page, 'tag:green')).toEqual(['three', 'four', 'five']);
  });
});

test("by repo, a new tab starts in the active tab's repo", async ({ page, daemon, twins }) => {
  await openApp(page, daemon);
  await groupBy(page, 'By repo');
  // Earlier specs' tabs may sit in another `alpha`: count from here.
  const alphas = () => page.locator('#tabs .tab:not(.mirror)[data-group="repo:alpha"]').count();
  const before = await alphas();

  await newTab(page);
  await cdInTerminal(page, twins.alpha, 'in-alpha');
  // The active tab's repo is re-read every few seconds.
  await expect.poll(alphas, { timeout: 10_000 }).toBe(before + 1);
  await newTab(page);
  await expect.poll(alphas, { timeout: 10_000 }).toBe(before + 2);
  await expect(chip(page, 'alpha')).toBeVisible();
});

test("a tab dragged into another tag's group trades tags; a copy moves only its place", async ({ page, daemon }) => {
  test.slow(); // three tabs and four drags
  await openApp(page, daemon);
  for (const name of ['red-1', 'blue-1', 'both']) {
    await newTab(page);
    await nameTab(page, name);
  }
  await tagTab(page, 'red-1', 'red');
  await tagTab(page, 'blue-1', 'blue');
  await tagTab(page, 'both', 'red', 'blue');
  await groupBy(page, 'By tag');
  expect(await inGroup(page, 'tag:red')).toEqual(['red-1', 'both']);

  await test.step('onto a label', async () => {
    await drag(page, tab(page, 'red-1'), chip(page, 'blue'));
    await expect.poll(() => inGroup(page, 'tag:red')).toEqual(['both']);
    expect(await inGroup(page, 'tag:blue')).toContain('red-1');
  });

  await test.step("among another group's tabs", async () => {
    await drag(page, tab(page, 'blue-1'), tab(page, 'both'));
    await expect.poll(() => inGroup(page, 'tag:red')).toContain('blue-1');
    expect(await inGroup(page, 'tag:blue')).not.toContain('blue-1');
  });

  await test.step('a copy onto "Untagged" takes off only the tag it was under', async () => {
    const copy = page.locator('#tabs .tab.mirror[data-group="tag:blue"]').filter({ hasText: 'both' });
    await drag(page, copy, chip(page, 'Untagged'));
    await expect.poll(() => inGroup(page, 'tag:blue')).not.toContain('both');
    expect(await inGroup(page, 'tag:red')).toContain('both');
  });
});

test('by repo, a tab dragged to another repo shows it cannot go, and goes back', async ({ page, daemon, twins }) => {
  test.slow(); // two shells to move and their repos to read
  await openApp(page, daemon);
  await newTab(page);
  await cdInTerminal(page, twins.alpha, 'in-alpha-drag');
  await newTab(page);
  await cdInTerminal(page, twins.beta, 'in-beta-drag');
  await groupBy(page, 'By repo');
  const alphaTab = tab(page, 'in-alpha-drag');
  // Each tab's repo is read when it activates.
  await alphaTab.click();
  await tab(page, 'in-beta-drag').click();
  await expect(alphaTab).toHaveAttribute('data-group', 'repo:alpha', { timeout: 10_000 });
  await expect(tab(page, 'in-beta-drag')).toHaveAttribute('data-group', 'repo:beta', { timeout: 10_000 });

  await drag(page, alphaTab, chip(page, 'beta'), async () => {
    await expect(alphaTab).toHaveClass(/no-drop/);
  });
  await expect(alphaTab).not.toHaveClass(/dragging/);
  await expect(alphaTab).toHaveAttribute('data-group', 'repo:alpha');
  await expect(page.locator('.tab-group-box[data-group="repo:alpha"] .tab').filter({ hasText: 'in-alpha-drag' })).toHaveCount(1);
});
