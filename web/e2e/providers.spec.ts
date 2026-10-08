// Agent providers, end to end: added and edited in the command palette (its
// input becomes a text box), saved on the daemon, offered by New card; a
// name with markup stays text.
import type { Page } from '@playwright/test';
import { DEFAULT_PROVIDERS } from '../src/app/settings/schema.ts';
import { expect, openApp, test } from './fixture.ts';

const item = (page: Page, label: string) => page.locator(`#palette [role="menuitem"][data-filter="${label}"]`);

async function type(page: Page, text: string): Promise<void> {
  await page.locator('#palette-input').fill(text);
  await page.locator('#palette-input').press('Enter');
}

test('a provider is added and edited in the palette and offered by New card', async ({ page, daemon }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const before = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  // New card is reached from the board's columns, not its setup screen;
  // other specs on this daemon leave providers of their own.
  await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...before, boardOnboarded: true, providers: DEFAULT_PROVIDERS },
  });
  await openApp(page, daemon);
  await page.locator('#settings-btn').click();
  await item(page, 'Agent providers…').click();
  await item(page, 'Add provider…').click();
  await type(page, 'Codex');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /Another provider has that name/);
  await type(page, 'Aider <b>x</b>');
  await item(page, 'Startup command…').click();
  await expect(page.locator('#palette-input')).toHaveValue('aider <b>x</b> {prompt}');
  await type(page, 'aider --message {prompt}');
  await item(page, 'Resume command…').click();
  await type(page, 'aider --restore-chat-history');
  await expect(item(page, 'Resume command…')).toContainText('aider --restore-chat-history');
  await expect(page.locator('#palette b')).toHaveCount(0);

  await expect
    .poll(async () => (await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json()).providers)
    .toContainEqual({ name: 'Aider <b>x</b>', command: 'aider --message {prompt}', resume: 'aider --restore-chat-history' });

  await page.locator('#palette-input').press('Escape'); // back to the root page
  await page.locator('#palette-input').press('Escape'); // closed
  await page.locator('#board-btn').click();
  await page.locator('.board-col[data-status="backlog"] header .btn').click();
  const options = page.locator('#new-card select[name="provider"] option');
  await expect(options).toHaveText(['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode', 'Aider <b>x</b>']);
  await page.locator('#new-card button[value="cancel"]').click();

  await page.request.put(`${daemon.baseUrl}/api/settings`, { headers, data: before });
});
