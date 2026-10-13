// Coming back to a tab keeps its screen: the reattach asks the daemon for
// only the output it missed (`resume`), instead of clearing the terminal and
// replaying the whole scrollback. A fresh page still gets the whole of it.
import type { Page } from '@playwright/test';
import { dropSessions, expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// The stream frames (`{"stream":…}`) the daemon sends as each socket attaches.
function streams(page: Page): { resumed: boolean }[] {
  const seen: { resumed: boolean }[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string' || !f.payload.includes('"stream"')) return;
      seen.push(JSON.parse(f.payload).stream);
    });
  });
  return seen;
}

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('a tab brought back resumes, keeping what it showed and adding what it missed', async ({ page, daemon }) => {
  const attached = streams(page);
  await openApp(page, daemon);
  const first = tabs(page).first();
  await first.click();
  await typeInTerminal(page, 'echo shown-$((6*7)); (sleep 1; echo missed-$((6*8))) &');
  await page.keyboard.press('Enter');
  await expect(page.locator('.term.active .xterm-rows')).toContainText('shown-42');

  await newTab(page); // the first tab parks while its shell prints on
  await page.waitForTimeout(1500);
  const before = attached.length;
  await first.click();

  await expect(page.locator('.term.active .xterm-rows')).toContainText('missed-48');
  await expect(page.locator('.term.active .xterm-rows')).toContainText('shown-42');
  await expect.poll(() => attached.slice(before).map((s) => s.resumed)).toEqual([true]);

  await page.reload();
  await expect(page.locator('.term.active .xterm-rows')).toContainText('missed-48');
  expect(attached.at(-1)?.resumed).toBe(false);
});
