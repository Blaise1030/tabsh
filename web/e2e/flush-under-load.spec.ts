// Busy tabs keep the board and hooks snappy: while several shells print
// enough to keep their scrollback dirty across the daemon's 2 s flushes, a
// hook's status change (as `tabsh status` sends) and the session list still
// answer promptly, and the tab shows the new status. The lock ordering that
// makes this hold (the flusher never holds the database while it waits on a
// session's output) is pinned by the daemon's tests in `sessions/store.rs`.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// Far above a healthy round trip (a few ms), far below a request stuck behind
// a flush that copies every busy session's scrollback under the DB lock.
const PROMPT_MS = 1_000;

// ~10 s of steady output, 3 KB a line: dirty at every flush, and past the
// daemon's 512 KB scrollback cap, so each flush copies a full buffer.
const FLOOD = "for i in $(seq 300); do head -c 3000 /dev/zero | tr '\\0' x; echo; sleep 0.03; done";

async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));
test.afterEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('status changes stay prompt while busy tabs are flushed', async ({ page, daemon }) => {
  test.setTimeout(60_000);
  const headers = { Authorization: `Bearer ${daemon.token}` };
  await openApp(page, daemon);

  // Three busy shells: each starts its flood, then the next tab opens (the
  // others' shells keep printing with their sockets parked).
  for (let i = 0; i < 3; i++) {
    if (i > 0) await newTab(page);
    await typeInTerminal(page, FLOOD);
    await page.keyboard.press('Enter');
  }
  const ids = ((await (await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers })).json()) as {
    id: string;
  }[]).map((s) => s.id);
  expect(ids).toHaveLength(3);

  // Across three flush windows, a hook moves a card every ~200 ms and the tab
  // strip lists the sessions: every answer comes back promptly.
  const statuses = ['needs_input', 'in_progress', 'completed'];
  const slowest = { status: 0, list: 0 };
  const until = Date.now() + 6_500;
  for (let n = 0; Date.now() < until; n++) {
    const id = ids[n % ids.length];
    let t = Date.now();
    const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
      headers,
      data: { status: statuses[n % statuses.length], note: `move ${n}` },
    });
    slowest.status = Math.max(slowest.status, Date.now() - t);
    expect(res.status()).toBe(200);

    t = Date.now();
    const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
    slowest.list = Math.max(slowest.list, Date.now() - t);
    expect(list.status()).toBe(200);
    await page.waitForTimeout(200);
  }
  expect(slowest.status, 'slowest status change (ms)').toBeLessThan(PROMPT_MS);
  expect(slowest.list, 'slowest session list (ms)').toBeLessThan(PROMPT_MS);

  // The page sees a hook's moves while the shells are still printing.
  for (const id of ids) {
    const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
      headers,
      data: { status: 'needs_input', note: 'still prompt' },
    });
    expect(res.status()).toBe(200);
  }
  await expect(page.locator('#tabs .tab:not(.mirror) .tab-status[data-status="needs_input"]')).toHaveCount(3);
});
