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
import { expect, newTab, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

const card = (page: Page, name: string) => page.locator('.board-card').filter({ hasText: name });
const col = (page: Page, status: string) => page.locator(`.board-col[data-status="${status}"]`);

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
  await page.locator('#board-btn').click();
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

test("a card made from another column's + starts its agent at once", async ({ page, daemon, project }) => {
  const mark = join(project, 'launched');
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'needs_input').locator('header .btn').click();
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
  await card(page, 'Drag me').click();
  await expect(page.locator('#tabs .tab:has-text("Drag me")')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#board-btn').click();
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

test("an archived card's tab leaves the strip, grouped or not", async ({ page, daemon, project }) => {
  const oldTab = page.locator('#tabs .tab:not(.mirror)').filter({ hasText: 'Old work' });
  const grouping = (label: string) => page.locator(`#palette [role="menuitem"][data-filter="${label}"]`);
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await newCard(page, 'Old work', project);
  await expect(oldTab).toBeVisible();
  await page.locator('#board-btn').click(); // the board stays open after a new card
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
