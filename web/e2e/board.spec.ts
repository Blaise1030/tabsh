// The board, end to end (the agent is `true`, so the real `claude` never
// starts; the launch line is covered by the daemon's tests): a new card waits
// in Backlog with the board still open, and dragging it to In progress starts
// its agent (and a drop types nothing into a terminal); one made from another
// column starts at once; a status set through the daemon's API (as `tabsh status` does) moves it and
// colours its tab; dragging moves it on; a name with markup stays text; tags
// ticked in the Tags panel show on the card; the folder is searched as it's typed;
// attached images reach the agent's prompt as paths.
// A new card is titled by its prompt, so cards are found by their prompts.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import {
  cdInTerminal,
  expect,
  newTab,
  openApp,
  setOnboarded,
  TEST_PROVIDERS,
  test,
  typeInTerminal,
} from './fixture.ts';

// A provider whose agent writes its prompt to a file.
const WRITES_PROMPT = "printf '%s' {prompt} > prompt.txt";

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
// exits at once (`command` names one of the providers `setOnboarded` sets).
async function newCard(page: Page, prompt: string, cwd: string, command = 'true'): Promise<void> {
  await page.locator('#new-card button[aria-label="Folder"]').click();
  await page.locator('#new-card input[name="cwd"]').fill(cwd);
  await page.locator('#new-card textarea[name="prompt"]').fill(prompt);
  await page.locator('#new-card button[aria-label="Agent"]').click();
  await page.locator('#new-card').getByRole('menuitemradio', { name: command, exact: true }).click();
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
  await expect(page.locator('#tabs')).toBeHidden();
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

  // Archived is a column like the others: dropping a card there archives it.
  await col(page, 'archived').scrollIntoViewIfNeeded(); // five columns overflow the viewport
  await card(page, 'Fix login').dragTo(col(page, 'archived').locator('.board-cards'));
  await expect(col(page, 'completed').locator('.board-card')).toHaveCount(0);
  await expect(col(page, 'archived').locator('.col-count')).toHaveText('1');
  await expect(col(page, 'archived').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();
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

test("a completed card is archived from its menu, and has no Archive button", async ({ page, daemon, project }) => {
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
  await expect(card(page, 'Ship it').getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await card(page, 'Ship it').locator('.card-move').click();
  await page.locator('.move-menu [data-popover][aria-hidden="false"] [role="menuitem"]').filter({ hasText: 'Archive' }).click();
  await expect(col(page, 'completed').locator('.board-card')).toHaveCount(0);
  await expect(col(page, 'archived').locator('.board-card').filter({ hasText: 'Ship it' })).toBeVisible();
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
  await expect(col(page, 'archived').locator('.col-count')).toHaveText('1');

  // An archived card has no buttons of its own; its menu restores it.
  await page.locator('#drawer-close').click();
  await expect(card(page, 'Move me').getByRole('button', { name: /Restore|Delete/ })).toHaveCount(0);
  await card(page, 'Move me').locator('.card-move').click();
  await item('Restore').click();
  await expect(col(page, 'backlog').locator('.board-card').filter({ hasText: 'Move me' })).toBeVisible();
  await card(page, 'Move me').locator('.card-move').click();
  await item('Archive').click();
  await expect(col(page, 'archived').locator('.board-card').filter({ hasText: 'Move me' })).toBeVisible();

  // Delete session closes it: its card and its tab go.
  await card(page, 'Move me').locator('.card-move').click();
  await item('Delete session').click();
  await expect(card(page, 'Move me')).toHaveCount(0);
  await expect(col(page, 'archived').locator('.col-count')).toHaveText('0');
});

test("a card's menu has a Tags submenu: tags made and toggled there show on the card", async ({
  page,
  daemon,
  project,
}) => {
  const submenu = page.locator('.tags-submenu:visible');
  const tagRow = (tag: string) => submenu.getByRole('checkbox', { name: tag });
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Tag from menu', project);

  await card(page, 'Tag from menu').locator('.card-move').click();
  await page.locator('.move-menu [data-popover][aria-hidden="false"] .tags-row').click();
  await expect(submenu).toBeVisible();
  await submenu.getByRole('textbox', { name: 'New tag' }).fill('bug');
  await submenu.getByRole('textbox', { name: 'New tag' }).press('Enter');
  await expect(card(page, 'Tag from menu').locator('.tag-badge')).toHaveText(['bug']);
  await expect(tagRow('bug')).toBeChecked();

  // Toggling keeps it open.
  await tagRow('bug').click();
  await expect(card(page, 'Tag from menu').locator('.tag-badge')).toHaveCount(0);
  await expect(tagRow('bug')).not.toBeChecked();
  await tagRow('bug').click();
  await expect(card(page, 'Tag from menu').locator('.tag-badge')).toHaveText(['bug']);
  await expect(page.locator('#frame')).toBeHidden(); // no click opened the card

  // Escape goes back; closing the menu closes it.
  await page.keyboard.press('Escape');
  await expect(submenu).toHaveCount(0);
});

test('a hook moving a card to Needs input or Completed notifies; a move on the board does not', async ({
  page,
  daemon,
  project,
}) => {
  // The browser's notifications, granted and recorded.
  await page.addInitScript(() => {
    const notes: string[][] = [];
    (window as unknown as { notes: string[][] }).notes = notes;
    class Stub {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string }) {
        notes.push([title, options?.body ?? '']);
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = Stub;
    // And the chimes, counted by the oscillators they start.
    const w = window as unknown as { oscillators: number };
    w.oscillators = 0;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.oscillators++;
      return make.call(this);
    };
  });
  const oscillators = () => page.evaluate(() => (window as unknown as { oscillators: number }).oscillators);
  const notes = () => page.evaluate(() => (window as unknown as { notes: string[][] }).notes);
  const hook = async (id: string | null, data: object) =>
    page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
      headers: { Authorization: `Bearer ${daemon.token}` },
      data,
    });
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Notify me', project);
  const id = await card(page, 'Notify me').getAttribute('data-id');

  await hook(id, { status: 'needs_input', note: 'Claude needs your permission' });
  await expect.poll(notes).toEqual([['Notify me', 'Needs your input: Claude needs your permission']]);
  expect(await oscillators()).toBeGreaterThan(0); // it chimed
  await hook(id, { status: 'in_progress' }); // not one that notifies
  await hook(id, { status: 'completed' });
  await expect.poll(notes).toHaveLength(2);
  expect((await notes())[1]).toEqual(['Notify me', 'Completed']);

  // A move made on the board doesn't.
  await card(page, 'Notify me').locator('.card-move').click();
  await page.locator('.move-menu [data-popover][aria-hidden="false"] [role^="menuitem"]').filter({ hasText: 'Needs input' }).click();
  await expect(col(page, 'needs_input').locator('.board-card').filter({ hasText: 'Notify me' })).toBeVisible();
  const chimed = await oscillators();
  await page.waitForTimeout(300);
  expect(await notes()).toHaveLength(2);
  expect(await oscillators()).toBe(chimed);
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

test('tags ticked in the Tags panel show on the card, and are offered next time', async ({ page, daemon, project }) => {
  const chip = page.locator('#new-card button[aria-label="Tags"]');
  const field = page.locator('#new-card input[aria-label="New tag"]');
  const rows = page.locator('#new-card .tags-submenu .menu-check');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await page.locator('#new-card button[aria-label="Folder"]').click();
  await page.locator('#new-card input[name="cwd"]').fill(project);
  await page.locator('#new-card textarea[name="prompt"]').fill('Tag me');
  await expect(chip).toHaveText('Tags');
  await chip.click();
  await expect(page.locator('#new-card .tags-submenu-empty')).toHaveText('No tags yet');
  await field.fill('bug');
  await field.press('Enter'); // a tag, ticked, not the card
  await expect(page.locator('#new-card-form')).toBeVisible();
  await field.fill('ui, docs'); // a list makes several
  await field.press('Enter');
  await expect(rows).toHaveText(['bug', 'docs', 'ui']);
  await expect(chip.locator('.tag-badge')).toHaveText(['bug', 'ui', 'docs']);
  await rows.filter({ hasText: 'docs' }).click(); // untick; the panel stays open
  await rows.filter({ hasText: 'bug' }).click();
  await expect(rows.filter({ hasText: 'bug' }).locator('input')).not.toBeChecked();
  await field.fill('perf'); // typed but not entered: still counts
  await page.locator('#new-card button[type="submit"]').click();

  await expect(card(page, 'Tag me').locator('.tag-badge')).toHaveText(['ui', 'perf']);
  await col(page, 'backlog').locator('header .btn').click();
  await expect(chip).toHaveText('Tags');
  // The tags in use, offered to tick several.
  await chip.click();
  await expect(rows).toHaveText(['perf', 'ui']);
  // The field is first; arrows move onto the checkboxes.
  await expect(field).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' '); // perf
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' '); // ui
  await expect(chip.locator('.tag-badge')).toHaveText(['perf', 'ui']);
  await page.keyboard.press('Escape'); // the panel closes, not the dialog
  await expect(rows.first()).toBeHidden();
  await expect(chip).toBeFocused();
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
  await page.locator('#new-card button[aria-label="Folder"]').click();
  await folder.fill(`${project}/`);
  // Its folders, not its files, nor `.git` until a `.` is typed.
  await expect(options).toHaveText(['docs', 'src', 'target'].map((d) => `${project}/${d}`));
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await folder.press('ArrowDown');
  await folder.press('Tab');
  await expect(folder).toHaveValue(`${project}/src/`);
  await expect(options).toHaveText([`${project}/src/app`]);
  await folder.press('Escape'); // the popover closes, not the dialog
  await expect(page.locator('#new-card-folders')).toBeHidden();
  await expect(folder).toBeHidden();
  await expect(page.locator('#new-card-form')).toBeVisible();
  await page.locator('#new-card button[aria-label="Folder"]').click(); // opens it again, listing what's typed
  await expect(options).toHaveText([`${project}/src/app`]);
  await folder.press('Enter'); // picks it, doesn't create the card
  await expect(folder).toHaveValue(`${project}/src/app`);
  await expect(page.locator('#new-card-folders')).toBeHidden();
  await expect(page.locator('#new-card button[aria-label="Folder"]')).toHaveText(`${project}/src/app`);
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
  const chips = page.locator('#new-card button[aria-label="Tags"] .tag-badge');
  await expect(chips).toHaveText(['deploy']);
  await page.locator('#new-card button[aria-label="Tags"]').click();
  const deploy = page.locator('#new-card .tags-submenu').getByRole('checkbox', { name: 'deploy' });
  await expect(deploy).toBeChecked();
  await deploy.click();
  await expect(chips).toHaveCount(0);
  await page.locator('#new-card button[aria-label="Folder"]').click();
  await page.locator('#new-card input[name="cwd"]').fill(project);
  await page.locator('#new-card textarea[name="prompt"]').fill('No group');
  await page.locator('#new-card button[type="submit"]').click();
  await expect(card(page, 'No group')).toBeVisible();
  await expect(card(page, 'No group').locator('.tag-badge')).toHaveCount(0);

  await page.locator('#board-btn').click();
  await page.locator('#tab-group-btn').click();
  await grouping('No grouping').click();
});

test('the board filters cards by tag and folder', async ({ page, daemon, twins }) => {
  const alphaTab = page.locator('#tabs .tab:not(.mirror)').filter({ hasText: 'Alpha' });
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Alpha', twins.alpha);
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Beta', twins.beta);
  await expect(page.locator('#tabs')).toBeHidden();
  await page.locator('#board-btn').click();

  await alphaTab.click({ button: 'right' });
  const menu = page.locator('.tab-menu[aria-label="Tab tags"]');
  await menu.locator('input[aria-label="New tag"]').fill('ship');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#board-btn').click();

  const filterBtn = page.locator('#board-filter-btn');
  await expect(filterBtn).toBeVisible();
  await filterBtn.click();
  const filters = page.locator('.board-filter-menu');
  const ship = filters.getByRole('checkbox', { name: 'ship' });
  await ship.check();
  await expect(card(page, 'Alpha')).toBeVisible();
  await expect(card(page, 'Beta')).toHaveCount(0);

  const alpha = await card(page, 'Alpha').locator('.card-meta span').first().textContent();
  await filters.getByRole('checkbox', { name: alpha ?? '' }).check();
  await expect(card(page, 'Beta')).toHaveCount(0);
  await ship.uncheck();
  await filters.getByRole('checkbox', { name: alpha ?? '' }).uncheck();
  const beta = await card(page, 'Beta').locator('.card-meta span').first().textContent();
  await filters.getByRole('checkbox', { name: beta ?? '' }).check();
  await expect(card(page, 'Alpha')).toHaveCount(0);
  await expect(card(page, 'Beta')).toBeVisible();
  await filters.getByRole('checkbox', { name: beta ?? '' }).uncheck();
  await expect(card(page, 'Alpha')).toBeVisible();
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
  await expect(oldTab).toBeHidden(); // the board stays open after a new card, its tabs hidden
  await page.locator('#board-btn').click();
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

test("images attached to a new card reach its agent's prompt as paths", async ({ page, daemon, project }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const providers = [...TEST_PROVIDERS, { name: WRITES_PROMPT, command: WRITES_PROMPT, resume: '' }];
  await page.request.put(`${daemon.baseUrl}/api/settings`, { headers, data: { ...now, providers } });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'in_progress').locator('header .btn').click();
  const dialog = page.locator('#new-card');
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: 'shot.png', mimeType: 'image/png', buffer: png },
    { name: 'other.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(dialog.locator('.nc-thumb img')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Remove other.png' }).click();
  await expect(dialog.locator('.nc-thumb img')).toHaveAttribute('alt', 'shot.png');
  // The agent writes its prompt to a file, so the test can read it.
  await newCard(page, 'Look at this', project, WRITES_PROMPT);
  await expect(card(page, 'Look at this')).toBeVisible();
  const out = join(project, 'prompt.txt');
  await expect.poll(() => existsSync(out) && readFileSync(out, 'utf8'), { timeout: 15_000 }).toMatch(/^Look at this\n\n\//);
  const paths = readFileSync(out, 'utf8').split('\n').slice(2);
  expect(paths).toHaveLength(1);
  expect(paths[0]).toMatch(/-shot\.png$/);
  expect(readFileSync(paths[0])).toEqual(png);
});

test("the column chip's menu picks where a new card goes, and Esc closes only the menu", async ({
  page,
  daemon,
  project,
}) => {
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'backlog').locator('header .btn').click();
  const chip = page.locator('#new-card button[aria-label="Column"]');
  const rows = page.locator('#new-card [role="menu"][aria-label="Column"] [role="menuitemradio"]');
  await expect(chip).toHaveText('Backlog');
  await chip.click();
  await expect(rows).toHaveText(['Backlog', 'In progress']);
  await expect(rows.first()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape'); // the menu closes, not the dialog
  await expect(rows.first()).toBeHidden();
  await expect(page.locator('#new-card-form')).toBeVisible();
  await chip.click();
  await rows.filter({ hasText: 'In progress' }).click();
  await expect(chip).toHaveText('In progress');
  await newCard(page, 'Straight in', project);
  await expect(col(page, 'in_progress').locator('.board-card').filter({ hasText: 'Straight in' })).toBeVisible();
});
