// The board, end to end (the agent is `true`, so the real `claude` never
// starts; the launch line is covered by the daemon's tests): a new card waits
// in Backlog with the board still open, and dragging it to In progress starts
// its agent; a status set through the daemon's API (as `tabsh status` does) moves it and
// colours its tab; dragging moves it on; a name with markup stays text.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { cdInTerminal, expect, newTab, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

const card = (page: Page, name: string) => page.locator('.board-card').filter({ hasText: name });
const col = (page: Page, status: string) => page.locator(`.board-col[data-status="${status}"]`);

// Fills in and submits the New card dialog, with an agent that exits at once.
async function newCard(page: Page, name: string, cwd: string): Promise<void> {
  await page.locator('#new-card input[name="name"]').fill(name);
  await page.locator('#new-card input[name="cwd"]').fill(cwd);
  await page.locator('#new-card textarea[name="prompt"]').fill('Go');
  await page.locator('#new-card input[name="command"]').fill('true');
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
test('cards reorder within a column', async ({ page, daemon, project }) => {
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
  expect(await secondFirst()).toBe(false);

  // As where a browser loses dragend once the dragged node has moved (Firefox
  // bug 460801): the drop alone must end the drag.
  await page.evaluate(() => window.addEventListener('dragend', (e) => e.stopImmediatePropagation(), true));
  await card(page, 'Second card').dragTo(card(page, 'First card'), { targetPosition: { x: 10, y: 2 } });
  await expect.poll(secondFirst).toBe(true);
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
