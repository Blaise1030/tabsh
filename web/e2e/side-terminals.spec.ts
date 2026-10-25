// A card's side terminals: another shell in the card, not another card.
import { dropSessions, expect, leaveBoard, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

test.beforeEach(async ({ page, daemon }) => {
  await dropSessions(page, daemon);
  await setOnboarded(page, daemon, true);
});

test('a side terminal stays with its card', async ({ page, daemon }) => {
  await openApp(page, daemon);
  const bar = page.locator('#session-bar');
  await expect(bar.getByRole('tab', { name: 'Agent' })).toBeVisible();
  await bar.getByRole('button', { name: 'New terminal' }).click();
  const side = bar.getByRole('tab', { name: 'Terminal 1' });
  await expect(side).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('term')).not.toBeNull();

  await expect(page.locator('.term.active .xterm-rows')).not.toHaveText(/^\s*$/, { timeout: 10_000 });
  await typeInTerminal(page, 'echo side-marker');
  await page.keyboard.press('Enter');
  await expect(page.locator('.term.active .xterm-rows')).toContainText('side-marker');

  await bar.getByRole('tab', { name: 'Agent' }).click();
  await expect(page.locator('.term.active .xterm-rows')).not.toContainText('side-marker');

  await side.click();
  await expect(page.locator('.term.active .xterm-rows')).toContainText('side-marker');
  await page.reload();
  await expect(bar.getByRole('tab', { name: 'Terminal 1' })).toBeVisible();
  await bar.getByRole('tab', { name: 'Terminal 1' }).click();
  await expect(page.locator('.term.active .xterm-rows')).toContainText('side-marker');

  await page.locator('#board-btn').click();
  await expect(page.locator('#board .board-card')).toHaveCount(1);

  await leaveBoard(page);
  await page.locator('#tabs .tab:not(.mirror)').first().hover();
  await page.locator('#tabs .tab:not(.mirror)').first().getByRole('button', { name: 'Close terminal' }).click();
  await expect.poll(async () => {
    const res = await page.request.get(`${daemon.baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${daemon.token}` },
    });
    const rows = (await res.json()) as { parent: string | null }[];
    return rows.length;
  }).toBe(0);
});

test('a side terminal bell marks its tab and the card', async ({ page, daemon }) => {
  await openApp(page, daemon);
  const bar = page.locator('#session-bar');
  await bar.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.locator('.term.active .xterm-rows')).not.toHaveText(/^\s*$/, { timeout: 10_000 });
  await typeInTerminal(page, "sleep 1; printf '\\a'");
  await page.keyboard.press('Enter');
  await bar.getByRole('tab', { name: 'Agent' }).click();
  await expect(bar.getByRole('tab', { name: 'Terminal 1' })).toHaveClass(/bell/);
  await expect(page.locator('#tabs .tab:not(.mirror)').first()).toHaveClass(/bell/);
});
