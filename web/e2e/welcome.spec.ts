// The welcome tour, end to end: on first load the intro stands over the app
// (the gate gone, the daemon answered), Escape leaves it up, Continue walks
// to the next screen, and Skip saves `welcomeSeen` and hides the tour — a
// reload with the flag set shows no dialog at all. The view screen's pick
// sets where a later visit opens (unless the URL says otherwise), and a theme
// picked before Skip still styles the page. Show welcome in the palette opens
// the tour again; skipping it from there leaves the page and the board alone.
import { expect, test, openApp, setOnboarded, TEST_PROVIDERS } from './fixture.ts';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { THEMES } from '../src/app/settings/catalog.ts';

// The settings API's auth header, for the reads and writes the specs make
// themselves.
const auth = (daemon: Daemon): { Authorization: string } => ({ Authorization: `Bearer ${daemon.token}` });

// Start a worker's daemon with the tour unseen and the board not onboarded,
// then open the app: the dialog stands over it. The layout is reset too — the
// daemon is the worker's, and a spec before this one may have changed it. The
// test providers keep a Set up click from starting a real agent.
async function firstVisit(page: Page, daemon: Daemon): Promise<void> {
  const headers = auth(daemon);
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const put = await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: {
      ...now,
      welcomeSeen: false,
      boardOnboarded: false,
      boardLayout: 'list',
      providers: TEST_PROVIDERS,
    },
  });
  expect(put.status()).toBe(204);
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
}

test('the intro stays up on Escape, and Skip hides it across reload', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const headers = auth(daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Welcome to Tabsh.');
  await expect(page.locator('#gate')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await expect(welcome).toContainText('Choose your workspace.');
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  // Skip's save is a fire-and-forget PUT: the reload mustn't beat it.
  const saved = async () =>
    (
      (await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json()) as {
        welcomeSeen: boolean;
      }
    ).welcomeSeen;
  await expect.poll(saved).toBe(true);
  await page.reload();
  await expect(welcome).toHaveCount(0);
});

test('Kanban is where a later visit opens, unless the URL says otherwise', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(page.locator('#gate')).toBeHidden();
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await welcome.getByRole('button', { name: 'Kanban' }).click();
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  const board = page.locator('#board');
  await expect(board).toBeVisible();
  await expect(board).not.toHaveClass(/\blist\b/);
  // Both saves are fire-and-forget PUTs; the later visit mustn't beat them.
  const headers = auth(daemon);
  const saved = async () => {
    const s = (await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json()) as {
      welcomeSeen: boolean;
      boardLayout: string;
    };
    return `${s.welcomeSeen} ${s.boardLayout}`;
  };
  await expect.poll(saved).toBe('true columns');
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
  await expect(board).toBeVisible();
  await page.goto(`${daemon.baseUrl}/app/?view=terms#token=${daemon.token}`);
  await expect(board).toBeHidden();
});

test('Continue on Agents leaves the board setup screen', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const headers = auth(daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(page.locator('#gate')).toBeHidden();
  for (const title of [
    'Choose your workspace.',
    'Theme.',
    'Font.',
    'Typing sound.',
    'Connect your agents.',
  ]) {
    await welcome.getByRole('button', { name: 'Continue' }).click();
    await expect(welcome).toContainText(title);
  }
  // Finishing without setup ends the tour, but doesn't deal with the board.
  await welcome.getByRole('button', { name: 'Finish without setup' }).click();
  await expect(welcome).toBeHidden();
  // Both saves are fire-and-forget PUTs; the reload mustn't beat them.
  const saved = async () => {
    const s = (await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json()) as {
      welcomeSeen: boolean;
      boardOnboarded: boolean;
    };
    return `${s.welcomeSeen} ${s.boardOnboarded}`;
  };
  await expect.poll(saved).toBe('true false');
  // Finishing lands in the split: the board's list and a terminal beside it.
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect(page.locator('.board-onboarding')).toContainText('Set up with Claude Code');
  await page.reload();
  await expect(welcome).toHaveCount(0);
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('.board-onboarding')).toBeVisible();
});

test('Set up on Agents opens its card and marks the board onboarded', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const headers = auth(daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(page.locator('#gate')).toBeHidden();
  for (const title of ['Choose your workspace.', 'Theme.', 'Font.', 'Typing sound.', 'Connect your agents.']) {
    await welcome.getByRole('button', { name: 'Continue' }).click();
    await expect(welcome).toContainText(title);
  }
  await welcome.getByRole('button', { name: 'Set up' }).click();
  await expect(welcome).toBeHidden();

  // The board is a list in split with the setup card's terminal beside it.
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#board')).toHaveClass(/\blist\b/);
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect(page.locator('#frame .drawer-title')).toHaveText('Set up tabsh hooks');
  await expect(page.locator('.board-onboarding')).toHaveCount(0);
  const setup = page.locator('#board .board-col[data-status="in_progress"] .board-card').filter({
    hasText: 'Set up tabsh hooks',
  });
  await expect(setup).toBeVisible();

  // One save dealt with the tour, the board and the chosen provider.
  const saved = async () => {
    const s = (await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json()) as {
      welcomeSeen: boolean;
      boardOnboarded: boolean;
      agentProvider: string;
    };
    return `${s.welcomeSeen} ${s.boardOnboarded} ${s.agentProvider}`;
  };
  await expect.poll(saved).toBe('true true true');

  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  const card = ((await list.json()) as { name: string; status: string }[]).find((s) => s.name === 'Set up tabsh hooks');
  expect(card?.status).toBe('in_progress');
});

test('a theme chosen before Skip is still the page theme', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue' }).click(); // the view screen
  await welcome.getByRole('button', { name: 'Continue' }).click(); // the theme screen
  await welcome.getByRole('button', { name: 'Nord' }).click();
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--term-bg').trim()))
    .toBe(THEMES.nord.colors.background);
  await page.locator('#board-btn').click();
  await expect(page.locator('.board-onboarding')).toContainText('Set up with Claude Code');
});

test('Show welcome does not clear the board or leave the page when skipped', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await setOnboarded(page, daemon, true);
  await page.reload();
  await page.locator('#settings-btn').click();
  await page.locator('#palette-input').fill('welcome');
  await page.getByRole('menuitem', { name: 'Show welcome' }).click();
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toContainText('Welcome to Tabsh.');
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#board')).toBeHidden();
  await page.locator('#board-btn').click();
  await expect(page.locator('.board-onboarding')).toHaveCount(0);
});
