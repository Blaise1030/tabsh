// The two dialogs, end to end: New card's error is gone when it opens again,
// and the palette's About page says so when the daemon doesn't answer.
import { expect, openApp, setOnboarded, test } from './fixture.ts';

const PALETTE = process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+Shift+KeyK';

test('New card: a folder that is not there shows the error, and reopening clears it', async ({ page, daemon }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const put = await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...now, boardOnboarded: true },
  });
  expect(put.status()).toBe(204);
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await page.locator('[aria-label="New card in Backlog"]').click();
  const dialog = page.locator('#new-card');
  const error = dialog.locator('.new-card-error');
  await expect(error).toBeHidden();
  await dialog.locator('button[aria-label="Folder"]').click();
  await dialog.locator('input[name="cwd"]').fill('/no/such/folder/here');
  await dialog.locator('textarea[name="prompt"]').fill('Go');
  await dialog.locator('button[type="submit"]').click();
  await expect(error).toHaveText('No folder at /no/such/folder/here');
  await dialog.locator('[value="cancel"]').click();
  await expect(dialog).toBeHidden();
  await page.locator('[aria-label="New card in Backlog"]').click();
  await expect(error).toBeHidden();
  await expect(dialog.locator('input[name="cwd"]')).toHaveValue('');
});

const newCardKey = process.platform === 'darwin' ? 'Meta+Shift+KeyC' : 'Alt+Shift+KeyN';

test('the New card shortcut opens the dialog on Backlog', async ({ page, daemon }) => {
  await setOnboarded(page, daemon, true);
  await openApp(page, daemon);
  await page.keyboard.press(newCardKey);
  const dialog = page.locator('#new-card');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('button[aria-label="Column"]')).toContainText('Backlog');
});

test('New card closes when its backdrop is clicked', async ({ page, daemon }) => {
  await setOnboarded(page, daemon, true);
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await page.locator('[aria-label="New card in Backlog"]').click();
  const dialog = page.locator('#new-card');
  await expect(dialog).toHaveAttribute('open', '');
  await dialog.locator('textarea[name="prompt"]').click();
  await expect(dialog).toHaveAttribute('open', '');
  // The dialog element is only the overlay; its panel is positioned out of
  // that box, so the click goes to the backdrop at the corner of the page.
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
});

test('About is a palette page: it says so when the daemon does not answer, and lists the rows when it does', async ({
  page,
  daemon,
}) => {
  await openApp(page, daemon);
  await page.route('**/api/about', (route) => route.abort());
  await page.keyboard.press(PALETTE);
  await page.locator('#palette-input').fill('About');
  await page.locator('#palette [role="menuitem"][data-filter="About tabsh…"]').click();
  const rows = page.locator('#palette-menu [role="menuitem"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText(/Could not reach the tabsh daemon\./);
  await page.unroute('**/api/about');
  await page.keyboard.press('Escape');
  await page.locator('#palette-input').fill('About');
  await page.locator('#palette [role="menuitem"][data-filter="About tabsh…"]').click();
  await expect(rows.first()).toContainText('Version');
  await expect(rows).toHaveCount(6);
});
