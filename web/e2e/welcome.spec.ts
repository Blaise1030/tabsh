// The welcome tour, end to end: on first load the intro stands over the app
// (the gate gone, the daemon answered), Escape leaves it up, Continue walks
// to the next screen, and Skip saves `welcomeSeen` and hides the tour — a
// reload with the flag set shows no dialog at all.
import { expect, test } from './fixture.ts';

test('the intro stays up on Escape, and Skip hides it across reload', async ({ page, daemon }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...now, welcomeSeen: false, boardOnboarded: false },
  });
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
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
  await page.reload();
  await expect(welcome).toHaveCount(0);
});
