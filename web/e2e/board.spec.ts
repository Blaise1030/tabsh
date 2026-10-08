// The board, end to end (the agent is `true`, so the real `claude` never
// starts; the launch line is covered by the daemon's tests): a new card waits
// in Backlog with the board still open, and dragging it to In progress starts
// its agent (and a drop types nothing into a terminal); one made from another
// column starts at once; a status set through the daemon's API (as `tabsh status` does) moves it and
// colours its tab; dragging moves it on; a name with markup stays text; tags
// picked as chips show on the card; the folder is searched as it's typed.
// A new card is titled by its prompt, so cards are found by their prompts.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { cdInTerminal, expect, newTab, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

const card = (page: Page, name: string) => page.locator('.board-card').filter({ hasText: name });
const col = (page: Page, status: string) => page.locator(`.board-col[data-status="${status}"]`);

// Opens the board on its own: with a tab open it shows that tab in its
// drawer, so this closes the drawer, giving the columns the whole width.
async function boardAlone(page: Page): Promise<void> {
  await page.locator('#board-btn').click();
  await page.locator('#drawer-close').click();
  await expect(page.locator('#frame')).toBeHidden();
}

// Fills in and submits the New card dialog, by default with an agent that
// exits at once.
async function newCard(page: Page, prompt: string, cwd: string, command = 'true'): Promise<void> {
  await page.locator('#new-card input[name="cwd"]').fill(cwd);
  await page.locator('#new-card textarea[name="prompt"]').fill(prompt);
  await page.locator('#new-card input[name="command"]').fill(command);
  await page.locator('#new-card button[type="submit"]').click();
}

// These cards need the columns, not the setup screen.
test.beforeEach(async ({ page, daemon }) => setOnboarded(page, daemon, true));

// The daemon is shared by the worker's later specs, some of which count tabs:
// leave it with no sessions.
test.afterEach(async ({ page, daemon }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
});

test('cards move through the board', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Fix login', project);

  // Still on the board, with the card waiting in Backlog and its tab not
  // selected.
  await expect(col(page, 'backlog').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();
  await expect(page.locator('#tabs .tab:has-text("Fix login")')).toHaveAttribute('aria-selected', 'false');

  await card(page, 'Fix login').dragTo(col(page, 'in_progress').locator('.board-cards'));
  await expect(col(page, 'in_progress').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();

  const id = await card(page, 'Fix login').getAttribute('data-id');
  const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { status: 'needs_input', note: 'Claude needs your permission to use Bash' },
  });
  expect(res.status()).toBe(200);
  await expect(col(page, 'needs_input').locator('.board-card').filter({ hasText: 'Fix login' })).toContainText(
    'needs your permission',
  );
  await expect(page.locator(`#tabs .tab:has-text("Fix login") .tab-status`)).toHaveAttribute(
    'data-status',
    'needs_input',
  );

  await card(page, 'Fix login').dragTo(col(page, 'completed').locator('.board-cards'));
  await expect(col(page, 'completed').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();

  // Dropping a card on the Archive section archives it.
  await card(page, 'Fix login').dragTo(page.locator('.board-col.archive'));
  await expect(col(page, 'completed').locator('.board-card')).toHaveCount(0);
  const toggle = page.locator('.archive-toggle');
  await expect(toggle).toContainText('Archive 1');
  await toggle.click();
  await expect(page.locator('.board-col.archive .board-card').filter({ hasText: 'Fix login' })).toBeVisible();
});

test("a card made from In progress's + starts its agent at once", async ({ page, daemon, project }) => {
  const mark = join(project, 'launched');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'in_progress').locator('header .btn').click();
  // The agent `touch`es a file (and one named for the prompt), so it shows it
  // ran.
  await newCard(page, 'Right away', project, 'touch launched');
  await expect(col(page, 'in_progress').locator('.board-card').filter({ hasText: 'Right away' })).toBeVisible();
  await expect.poll(() => existsSync(mark), { timeout: 10_000 }).toBe(true);
});

test("dragging a card doesn't type its id into the active terminal", async ({ page, daemon, project }) => {
  const mark = join(project, 'dragged');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Drag me', project, 'touch dragged');
  // Its own tab is the active one, so a stray paste would land before its
  // launch line.
  await card(page, 'Drag me').click(); // opens it in the drawer
  await expect(page.locator('.drawer-title')).toHaveText('Drag me');
  await page.locator('#drawer-close').click();
  await card(page, 'Drag me').dragTo(col(page, 'needs_input').locator('.board-cards'));
  await card(page, 'Drag me').dragTo(col(page, 'in_progress').locator('.board-cards'));
  await expect.poll(() => existsSync(mark), { timeout: 10_000 }).toBe(true);
});

test('a completed card has an Archive button', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Ship it', project);
  const id = await card(page, 'Ship it').getAttribute('data-id');
  await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { status: 'completed', source: 'user' },
  });
  await expect(col(page, 'completed').locator('.board-card').filter({ hasText: 'Ship it' })).toBeVisible();
  await card(page, 'Ship it').getByRole('button', { name: 'Archive' }).click();
  await expect(col(page, 'completed').locator('.board-card')).toHaveCount(0);
  await expect(page.locator('.archive-toggle')).toContainText('Archive 1');
});

test('the board hides the tabs, and shows the open tab in its drawer', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(page.locator('#tabs')).toBeVisible();
  const tab = await page.locator('#tabs .tab[aria-selected="true"]').textContent();
  await page.locator('#board-btn').click();
  await expect(page.locator('#board')).toBeVisible();
  for (const id of ['#tabs', '#explorer-btn', '#tab-group-btn']) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('#settings-btn')).toBeVisible();
  // The tab that was open stays in view, in the drawer.
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect(page.locator('.drawer-title')).toHaveText(tab ?? '');
  // Closed, the board has the whole page: no workspace.
  await page.locator('#drawer-close').click();
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('#board-btn').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#tabs')).toBeVisible();
});

test('a card opens its terminal in a drawer beside the board', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'In a drawer', project);
  await card(page, 'In a drawer').click();
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect(page.locator('.drawer-title')).toHaveText('In a drawer');
  await expect(page.locator('#terms')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('drawer')).toBe('1');

  // The file explorer opens inside the drawer.
  await page.locator('.drawer-bar').getByRole('button', { name: 'Toggle file explorer' }).click();
  await expect(page.locator('#explorer')).toBeVisible();

  // Dragging the divider resizes it.
  const before = (await page.locator('#frame').boundingBox())?.width ?? 0;
  const d = await page.locator('#drawer-divider').boundingBox();
  await page.mouse.move((d?.x ?? 0) + 1, (d?.y ?? 0) + 200);
  await page.mouse.down();
  await page.mouse.move((d?.x ?? 0) - 150, (d?.y ?? 0) + 200, { steps: 5 });
  await page.mouse.up();
  expect((await page.locator('#frame').boundingBox())?.width ?? 0).toBeGreaterThan(before + 100);

  // Back closes it; closing leaves the board alone.
  await page.goBack();
  await expect(page.locator('#explorer')).toBeHidden();
  await page.locator('#drawer-close').click();
  await expect(page.locator('#frame')).toBeHidden();
  await expect(page.locator('#board')).toBeVisible();

  // A click on the board's empty space closes it; a card's click opens it.
  await card(page, 'In a drawer').click();
  await expect(page.locator('#frame')).toBeVisible();
  await page.locator('#board').click({ position: { x: 300, y: 600 } });
  await expect(page.locator('#frame')).toBeHidden();
  await expect(page.locator('#board')).toBeVisible();

  // Expanding goes to the terminals.
  await card(page, 'In a drawer').click();
  await page.locator('#drawer-expand').click();
  await expect(page.locator('#board')).toBeHidden();
  await expect(page.locator('#tabs .tab[aria-selected="true"]')).toHaveText(/In a drawer/);
});

test("a card's Move menu sets its status, on the board and in the drawer", async ({ page, daemon, project }) => {
  const shownMenu = page.locator('.move-menu [data-popover][aria-hidden="false"]');
  const item = (name: string) => shownMenu.locator('[role^="menuitem"]').filter({ hasText: name });
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Move me', project);

  await card(page, 'Move me').locator('.card-move').click();
  await expect(item('Backlog')).toHaveAttribute('aria-disabled', 'true');
  await item('Completed').click();
  await expect(shownMenu).toHaveCount(0);
  await expect(col(page, 'completed').locator('.board-card').filter({ hasText: 'Move me' })).toBeVisible();
  await expect(page.locator('#board')).toBeVisible(); // the click didn't open the card

  // Escape closes it without a move.
  await card(page, 'Move me').locator('.card-move').click();
  await expect(shownMenu).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(shownMenu).toHaveCount(0);

  await card(page, 'Move me').click();
  await expect(page.locator('.drawer-move')).toContainText('Completed');
  await page.locator('.drawer-move').click();
  await item('Archive').click();
  await expect(col(page, 'completed').locator('.board-card')).toHaveCount(0);
  await expect(page.locator('.archive-toggle')).toContainText('Archive 1');

  // Delete session closes it: its card and its tab go.
  await page.locator('#drawer-close').click();
  await page.locator('.archive-toggle').click();
  await card(page, 'Move me').locator('.card-move').click();
  await item('Delete session').click();
  await expect(card(page, 'Move me')).toHaveCount(0);
  await expect(page.locator('.archive-toggle')).toContainText('Archive 0');
});

test('dragging a card does not light the file drop', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Drag me', project);
  await card(page, 'Drag me').hover();
  await page.mouse.down();
  const to = await col(page, 'in_progress').locator('.board-cards').boundingBox();
  await page.mouse.move((to?.x ?? 0) + 20, (to?.y ?? 0) + 20, { steps: 5 });
  await expect(page.locator('#drop-glow')).not.toHaveClass(/active/);
  await page.mouse.up();
  await expect(col(page, 'in_progress').locator('.board-card').filter({ hasText: 'Drag me' })).toBeVisible();
});

test('only Backlog and In progress offer a new card', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  for (const status of ['backlog', 'in_progress']) await expect(col(page, status).locator('header .btn')).toHaveCount(1);
  for (const status of ['needs_input', 'completed']) await expect(col(page, status).locator('header .btn')).toHaveCount(0);
  const heights = await page.locator('.board-col > header').evaluateAll((hs) => hs.map((h) => h.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
});

test('a long note is clamped, with Show more', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await boardAlone(page);
  for (const name of ['Short', 'Long']) {
    await col(page, 'backlog').locator('header .btn').click();
    await newCard(page, name, project);
  }
  // A note as a hook sets it; titles are cut at 60 characters, two lines at most.
  const id = await card(page, 'Long').getAttribute('data-id');
  await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { status: 'needs_input', note: 'Waiting on you '.repeat(30) },
  });
  const more = card(page, 'Long').locator('.card-more');
  await expect(more).toHaveText('Show more');
  await expect(card(page, 'Short').locator('.card-more')).toHaveCount(0);
  const clamped = (await card(page, 'Long').boundingBox())?.height ?? 0;
  await more.click();
  await expect(more).toHaveText('Show less');
  await expect(page.locator('#frame')).toBeHidden(); // the click didn't open the card
  expect((await card(page, 'Long').boundingBox())?.height ?? 0).toBeGreaterThan(clamped);
});

test('tags picked as chips show on the card, and are offered next time', async ({ page, daemon, project }) => {
  const tag = page.locator('#new-card-tag');
  const chips = page.locator('#new-card-chips .tag-badge');
  const rows = page.locator('#new-card-tag-options [role="option"]');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await page.locator('#new-card input[name="cwd"]').fill(project);
  await page.locator('#new-card textarea[name="prompt"]').fill('Tag me');
  await tag.fill('bug');
  await expect(rows).toHaveText(['Create "bug"']);
  await tag.press('Enter'); // a chip, not the card
  await expect(page.locator('#new-card-form')).toBeVisible();
  await expect(tag).toHaveValue('');
  await tag.pressSequentially('ui,docs,');
  await expect(chips).toHaveText(['bug', 'ui', 'docs'].map((t) => new RegExp(`^${t}`)));
  await tag.press('Backspace'); // the empty box takes the last chip off
  await chips.filter({ hasText: 'bug' }).getByRole('button', { name: 'Remove bug' }).click();
  await tag.fill('perf'); // typed but not yet a chip: still counts
  await page.locator('#new-card button[type="submit"]').click();

  await expect(card(page, 'Tag me').locator('.tag-badge')).toHaveText(['ui', 'perf']);
  await col(page, 'backlog').locator('header .btn').click();
  await expect(chips).toHaveCount(0);
  // The tags in use, offered as a list to pick several from.
  await tag.focus();
  await expect(rows).toHaveText(['perf', 'ui']);
  await rows.filter({ hasText: 'ui' }).click();
  await expect(rows.filter({ hasText: 'ui' })).toHaveAttribute('aria-selected', 'true');
  await tag.press('ArrowDown');
  await tag.press('Enter'); // perf, the first row
  await expect(chips).toHaveText([/^ui/, /^perf/]);
  await tag.press('Enter'); // and off again
  await expect(chips).toHaveText([/^ui/]);
  await tag.fill('P');
  await expect(rows).toHaveText(['Create "P"', 'perf']); // "perf" holds a p
  await tag.press('Escape'); // the list closes, not the dialog
  await expect(page.locator('#new-card-tag-options')).toBeHidden();
  await expect(page.locator('#new-card-form')).toBeVisible();
});

test('the folder is searched as it is typed, and Tab goes into the highlighted one', async ({
  page,
  daemon,
  project,
}) => {
  mkdirSync(join(project, 'src', 'app'));
  const folder = page.locator('#new-card input[name="cwd"]');
  const options = page.locator('#new-card-folders [role="option"]');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await folder.fill(`${project}/`);
  // Its folders, not its files, nor `.git` until a `.` is typed.
  await expect(options).toHaveText(['docs', 'src', 'target'].map((d) => `${project}/${d}`));
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await folder.press('ArrowDown');
  await folder.press('Tab');
  await expect(folder).toHaveValue(`${project}/src/`);
  await expect(options).toHaveText([`${project}/src/app`]);
  await folder.press('Escape'); // the list closes, not the dialog
  await expect(page.locator('#new-card-folders')).toBeHidden();
  await expect(page.locator('#new-card-form')).toBeVisible();
  await folder.press('ArrowDown'); // opens the list again
  await expect(options).toHaveText([`${project}/src/app`]);
  await folder.press('Enter'); // picks it, doesn't create the card
  await expect(folder).toHaveValue(`${project}/src/app`);
  await expect(page.locator('#new-card-folders')).toBeHidden();
  await page.locator('#new-card textarea[name="prompt"]').fill('In app');
  await page.locator('#new-card button[type="submit"]').click();

  await expect(card(page, 'In app')).toBeVisible();
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
  });
  const made = ((await list.json()) as { name: string; cwd: string | null }[]).find((s) => s.name === 'In app');
  expect(made?.cwd).toBe(join(project, 'src', 'app'));
});

test("the group's tag starts as a chip, and taking it off leaves the card untagged", async ({
  page,
  daemon,
  project,
}) => {
  const grouping = (label: string) => page.locator(`#palette [role="menuitem"][data-filter="${label}"]`);
  await openApp(page, daemon);
  // The active tab, tagged, with tabs grouped by tag: a new card joins its group.
  await page.locator('#tabs .tab[aria-selected="true"]').click({ button: 'right' });
  await page.locator('.tab-menu input[aria-label="New tag"]').fill('deploy');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#tab-group-btn').click();
  await grouping('By tag').click();

  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  const chips = page.locator('#new-card-chips .tag-badge');
  await expect(chips).toHaveText([/^deploy/]);
  await chips.getByRole('button', { name: 'Remove deploy' }).click();
  await expect(chips).toHaveCount(0);
  await page.locator('#new-card input[name="cwd"]').fill(project);
  await page.locator('#new-card textarea[name="prompt"]').fill('No group');
  await page.locator('#new-card button[type="submit"]').click();
  await expect(card(page, 'No group')).toBeVisible();
  await expect(card(page, 'No group').locator('.tag-badge')).toHaveCount(0);

  await page.locator('#board-btn').click();
  await page.locator('#tab-group-btn').click();
  await grouping('No grouping').click();
});

test('a card name with markup is shown as text', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, "printf '\\033]0;<b>bold</b>\\007'");
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('<b>bold</b>');
  }).toPass({ timeout: 10_000 });
  await page.locator('#board-btn').click();
  await expect(card(page, '<b>bold</b>').locator('.card-title')).toHaveText('<b>bold</b>');
  await expect(page.locator('.board-card b')).toHaveCount(0);
});

// A drop within a column reorders its cards and leaves none marked as
// dragged, even without a dragend.
test('a new card goes on top; cards reorder within a column', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  for (const name of ['First card', 'Second card']) {
    await col(page, 'backlog').locator('header .btn').click();
    await newCard(page, name, project);
    await expect(card(page, name)).toBeVisible();
  }
  const titles = col(page, 'backlog').locator('.board-card .card-title');
  // The order of the two among the column's cards (the first terminal is there too).
  const secondFirst = async () => {
    const names = await titles.allTextContents();
    return names.indexOf('Second card') < names.indexOf('First card');
  };
  // New cards go first in their column, so they're seen without scrolling.
  expect(await secondFirst()).toBe(true);
  expect((await titles.allTextContents())[0]).toBe('Second card');

  // As where a browser loses dragend once the dragged node has moved (Firefox
  // bug 460801): the drop alone must end the drag.
  await page.evaluate(() => window.addEventListener('dragend', (e) => e.stopImmediatePropagation(), true));
  await card(page, 'First card').dragTo(card(page, 'Second card'), { targetPosition: { x: 10, y: 2 } });
  await expect.poll(secondFirst).toBe(false);
  await expect(page.locator('.board-card.dragging')).toHaveCount(0);
  await expect(page.locator('.drop-before, .drop-end')).toHaveCount(0);
});

// The open board follows its cards: a terminal renamed while it's shown
// renames its card at once, not at the next 30 s refresh.
test('a card follows its terminal while the board is open', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'Ready');
  await typeInTerminal(page, "sleep 2; printf '\\033]0;Renamed later\\007'");
  await page.keyboard.press('Enter');
  await page.locator('#board-btn').click();
  const renamed = col(page, 'backlog').locator('.board-card').filter({ hasText: 'Renamed later' });
  await expect(renamed.locator('.card-title')).toHaveText('Renamed later', { timeout: 10_000 });
  await expect(page.locator('#board')).toBeVisible();
  await expect(renamed.locator('.card-meta').last()).toHaveText('now'); // its time in status
});

test("an archived card's tab leaves the strip, grouped or not", async ({ page, daemon, project }) => {
  const oldTab = page.locator('#tabs .tab:not(.mirror)').filter({ hasText: 'Old work' });
  const grouping = (label: string) => page.locator(`#palette [role="menuitem"][data-filter="${label}"]`);
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Old work', project);
  await page.locator('#board-btn').click(); // the board stays open after a new card, its tabs hidden
  await expect(oldTab).toBeVisible();
  await newTab(page); // another tab is active: an active archived tab stays shown

  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
  });
  const old = ((await list.json()) as { id: string; name: string }[]).find((s) => s.name === 'Old work');
  expect(old).toBeTruthy();
  await page.request.patch(`${daemon.baseUrl}/api/sessions/${old?.id}/status`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { status: 'archived', source: 'user' },
  });
  await expect(oldTab).toBeHidden();

  // Grouped by repo, it is in no group and stays hidden.
  await page.locator('#tab-group-btn').click();
  await grouping('By repo').click();
  await expect(page.locator('#tabs .tab-group').first()).toBeVisible();
  await expect(oldTab).toBeHidden();
  await expect(oldTab).not.toHaveAttribute('data-group', /.*/);

  await page.locator('#tab-group-btn').click();
  await grouping('No grouping').click();
  await expect(page.locator('#tabs .tab-group')).toHaveCount(0);
});

// Until it's onboarded, the board offers to set up the agent's hooks instead
// of showing columns; skipping stores the flag, so a reload shows columns.
// (Set up isn't clicked: it would start the real `claude`.)
test('the board shows its setup screen until skipped', async ({ page, daemon }) => {
  await setOnboarded(page, daemon, false);
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await expect(page.locator('.board-onboarding')).toBeVisible();
  await expect(page.locator('.board-onboarding')).toContainText('Set up with Claude Code');
  await expect(page.locator('.board-col')).toHaveCount(0);

  const saved = page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'PUT');
  await page.locator('.board-onboarding button', { hasText: 'Skip' }).click();
  await saved;
  await expect(page.locator('.board-onboarding')).toHaveCount(0);
  await expect(page.locator('.board-col[data-status="backlog"]')).toBeVisible();

  await page.goto('about:blank'); // a fresh load, not just a new fragment
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await expect(page.locator('.board-col[data-status="backlog"]')).toBeVisible();
  await expect(page.locator('.board-onboarding')).toHaveCount(0);
});
