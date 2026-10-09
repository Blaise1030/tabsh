// Opening tabs does not block other daemon work: a burst of new tabs, and
// every one of their shells (re)attached at once, starts PTYs on the daemon
// while settings round-trips and the board still answer promptly; then every
// new tab's terminal takes input. The daemon starts each shell off its async
// workers (`spawn_blocking`), so a slow fork or `openpty` never stalls them.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

const TABS = 6;
// Generous for CI, yet far below a stall behind several serial spawns.
const PROMPT_MS = 2_000;

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');

async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

test.beforeEach(async ({ page, daemon }) => {
  await dropSessions(page, daemon);
  await setOnboarded(page, daemon, true);
});
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('opening several tabs at once leaves settings, the board and terminals responsive', async ({
  page,
  daemon,
}) => {
  await openApp(page, daemon);

  // Several new tabs back to back, without waiting for their shells.
  const newSession = page.locator('.tabbar [data-new-session]');
  for (let i = 0; i < TABS; i++) await newSession.click();
  await expect(tabs(page)).toHaveCount(TABS + 1);

  // Every session the daemon knows, (re)attached at once while settings
  // round-trip: each socket's first frame is its replay, sent once its shell
  // is running.
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const ids = ((await (await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers })).json()) as {
    id: string;
  }[]).map((s) => s.id);
  expect(ids).toHaveLength(TABS + 1);
  const burst = page.evaluate(
    async ({ ids, token }) => {
      const base = location.origin;
      const attached = ids.map(
        (id) =>
          new Promise<boolean>((resolve) => {
            const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?id=${id}&token=${token}`);
            ws.binaryType = 'arraybuffer';
            ws.onmessage = () => {
              ws.close();
              resolve(true);
            };
            ws.onerror = () => resolve(false);
          }),
      );
      const settings: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const res = await fetch(`${base}/api/settings`, { headers: { Authorization: `Bearer ${token}` } });
        await res.json();
        settings.push(performance.now() - t0);
      }
      return { attached: await Promise.all(attached), settings };
    },
    { ids, token: daemon.token },
  );

  // The board opens during the burst.
  await page.locator('#board-btn').click();
  await expect(page.locator('#board')).toBeVisible({ timeout: PROMPT_MS });

  const { attached, settings } = await burst;
  expect(attached).toEqual(ids.map(() => true));
  for (const ms of settings) expect(ms).toBeLessThan(PROMPT_MS);

  // Back to the terminals: each new tab's shell takes input.
  await page.goBack();
  await expect(page.locator('#board')).toBeHidden();
  for (let i = 1; i <= TABS; i++) {
    await tabs(page).nth(i).click();
    const mark = `spawned-${i}`;
    await expect(async () => {
      await typeInTerminal(page, '\u0003');
      await typeInTerminal(page, `printf '\\033]0;${mark}\\007'`);
      await page.keyboard.press('Enter');
      await expect(tabs(page).nth(i).locator('.tab-name')).toHaveText(mark, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  }
});
