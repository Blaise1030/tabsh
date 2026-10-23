// A UI-mode card shows the chat composer once it is In progress and open.
// The agent is the fake ACP binary (`fake-agent` on PATH). `TABSH_TEST_ACP=1`
// makes the daemon store that command instead of the provider's real one.
import type { Page } from '@playwright/test';
import { dropSessions, expect, openApp, setOnboarded, TEST_PROVIDERS, test } from './fixture.ts';

const card = (page: Page, name: string) => page.locator('#board .board-card').filter({ hasText: name });
const col = (page: Page, status: string) => page.locator(`#board .board-col[data-status="${status}"]`);

async function boardAlone(page: Page): Promise<void> {
  await page.locator('#board-btn').click();
  await page.locator('#drawer-close').click();
  await expect(page.locator('#frame')).toBeHidden();
}

test.beforeEach(async ({ page, daemon }) => {
  await setOnboarded(page, daemon, true);
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const put = await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: {
      ...now,
      providers: [
        ...TEST_PROVIDERS,
        { name: 'Fake ACP', command: 'true', resume: '', acp: 'npx --yes @agentclientprotocol/claude-agent-acp' },
      ],
    },
  });
  expect(put.status()).toBe(204);
});

test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('a UI card in progress shows the chat composer', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await boardAlone(page);
  await col(page, 'in_progress').locator('header .btn').click();

  const dialog = page.locator('#new-card');
  await dialog.locator('button[aria-label="Folder"]').click();
  await dialog.locator('input[name="cwd"]').fill(project);
  await dialog.locator('textarea[name="prompt"]').fill('Say hello');
  await dialog.locator('button[aria-label="Agent"]').click();
  await dialog.getByRole('menuitemradio', { name: 'Fake ACP', exact: true }).click();
  await dialog.locator('button[aria-label="Agent"]').click();
  await dialog.getByRole('switch', { name: 'UI mode' }).check();
  await expect(dialog.locator('button[aria-label="Agent"]')).toContainText('UI');
  await dialog.locator('button[type="submit"]').click();

  const created = card(page, 'Say hello');
  await expect(col(page, 'in_progress').locator('.board-card').filter({ hasText: 'Say hello' })).toBeVisible();
  const id = await created.getAttribute('data-id');
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
  });
  const sessions = (await list.json()) as { id: string; mode: string; acp_command: string | null }[];
  const session = sessions.find((s) => s.id === id);
  expect(session?.mode).toBe('ui');
  expect(session?.acp_command).toBe('fake-agent');

  await created.click();
  await expect(page.locator('.chat-composer')).toBeVisible();
});

async function openUiCard(page: Page, project: string, name: string): Promise<void> {
  await boardAlone(page);
  await col(page, 'in_progress').locator('header .btn').click();
  const dialog = page.locator('#new-card');
  await dialog.locator('button[aria-label="Folder"]').click();
  await dialog.locator('input[name="cwd"]').fill(project);
  await dialog.locator('textarea[name="prompt"]').fill(name);
  await dialog.locator('button[aria-label="Agent"]').click();
  await dialog.getByRole('menuitemradio', { name: 'Fake ACP', exact: true }).click();
  await dialog.locator('button[aria-label="Agent"]').click();
  await dialog.getByRole('switch', { name: 'UI mode' }).check();
  await dialog.locator('button[type="submit"]').click();
  // The launch turn can move the card to Needs input before this looks.
  const created = card(page, name);
  await expect(created).toBeVisible();
  await created.click();
  // Enter sends. The field is what a finished launch turn leaves usable.
  await expect(page.locator('.chat-composer textarea')).toBeEnabled();
}

async function sendChat(page: Page, text: string): Promise<void> {
  const field = page.locator('.chat-composer textarea');
  await field.fill(text);
  await field.press('Enter');
}

test('Allow answers an in-thread permission request', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await openUiCard(page, project, 'Say hello');
  await sendChat(page, 'needs permission');
  await expect(page.locator('.chat-permission')).toContainText('Fake tool');
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.locator('.chat-transcript')).toContainText('permission outcome: selected:allow');
  await expect(page.locator('.chat-composer textarea')).toBeEnabled();
});

test('Stop ends the running turn and the composer works again', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await openUiCard(page, project, 'Say hello');
  await sendChat(page, 'slow please');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.chat-composer textarea')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden();
});
