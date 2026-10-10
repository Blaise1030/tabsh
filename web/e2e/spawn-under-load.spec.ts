// Opening tabs does not block other daemon work: several sessions made over
// the API, with no shell yet, are all attached at once, so the daemon starts
// every one of their PTYs together; meanwhile settings round-trips and the
// board still answer promptly, and then every new tab's terminal takes input.
// The daemon starts each shell off its async workers (`spawn_blocking`), so a
// slow fork or `openpty` never stalls them.
//
// On a fast machine a spawn takes a few milliseconds, so this spec also
// passes against a daemon that spawned inline on its workers: it pins the
// flow end to end. The daemon's unit tests (`*_off_the_async_workers` in
// `src/sessions` and `src/board`) are what fail without the change.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, openApp, setOnboarded, test, typeInTerminal } from './fixture.ts';

const TABS = 6;
// Generous for CI, yet far below a stall behind several serial spawns.
const PROMPT_MS = 2_000;

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');

// Closes every session and waits until their shells have ended (a running
// shell's row goes when it exits): this spec starts several login shells at
// once, and the specs after it share the daemon, so none may still be
// winding down (saving history, say) when the next spec opens its tabs.
async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = async () =>
    (await (await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers })).json()) as { id: string }[];
  for (const s of await list()) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
  await expect.poll(async () => (await list()).length, { timeout: 15_000 }).toBe(0);
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
  test.slow(); // seven login shells start at once: more than 30s on a busy machine
  await openApp(page, daemon);

  // Several sessions, made without attaching: none has a shell yet.
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const ids: string[] = [];
  for (let i = 0; i < TABS; i++) {
    const res = await page.request.post(`${daemon.baseUrl}/api/sessions`, { headers, data: {} });
    expect(res.status()).toBe(200);
    ids.push(((await res.json()) as { id: string }).id);
  }

  // All attached at once, which starts every shell, while settings
  // round-trip: each socket's first frame is its replay, sent once its shell
  // is running.
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

  // Back to the terminals, the new sessions synced in as tabs (as coming
  // back to the window does): each new tab's shell takes input.
  await page.goBack();
  await expect(page.locator('#board')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(tabs(page)).toHaveCount(TABS + 1);
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
