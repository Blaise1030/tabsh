// The welcome tour, end to end: on first load the intro stands over the app
// (the gate gone, the daemon answered), Escape leaves it up, Continue walks
// to the next screen, and Skip saves `welcomeSeen` and hides the tour — a
// reload with the flag set shows no dialog at all. The view screen's pick
// sets where a later visit opens (unless the URL says otherwise), and a theme
// picked before Skip still styles the page.
import { expect, test } from './fixture.ts';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { THEMES } from '../src/app/settings/catalog.ts';

// The settings API's auth header, for the reads and writes the specs make
// themselves.
const auth = (daemon: Daemon): { Authorization: string } => ({ Authorization: `Bearer ${daemon.token}` });

// Start a worker's daemon with the tour unseen and the board not onboarded,
// then open the app: the dialog stands over it.
async function firstVisit(page: Page, daemon: Daemon): Promise<void> {
  const headers = auth(daemon);
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const put = await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...now, welcomeSeen: false, boardOnboarded: false },
  });
  expect(put.status()).toBe(204);
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
}

test('the intro stays up on Escape, and Skip hides it across reload', async ({ page, daemon }) => {
  await firstVisit(page, daemon);
  const headers = auth(daemon);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Shells that outlive this tab.');
  await expect(page.locator('#gate')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await expect(welcome).toContainText('How you look at the work.');
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
      startView: string;
      boardLayout: string;
    };
    return `${s.welcomeSeen} ${s.startView} ${s.boardLayout}`;
  };
  await expect.poll(saved).toBe('true board columns');
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
  await expect(board).toBeVisible();
  await page.goto(`${daemon.baseUrl}/app/?view=terms#token=${daemon.token}`);
  await expect(board).toBeHidden();
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
