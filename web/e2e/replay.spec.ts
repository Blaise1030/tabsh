// Scrollback replay: a query a program sent long ago (OSC 11, "what's your
// background colour?") is in the replayed output, and xterm answers it again
// as it parses. Those answers must not reach the shell, where they'd show up
// as typed text (`11;rgb:…`) on every reload.
import type { Page } from '@playwright/test';
import { expect, openApp, test, typeInTerminal } from './fixture.ts';

// Everything the page sends on its terminal sockets from now on, as text.
function sentFrames(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => sent.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('latin1')));
  });
  return sent;
}

test('a reload does not answer the queries in the replayed scrollback', async ({ page, daemon }) => {
  const live = sentFrames(page);
  await openApp(page, daemon);

  // Live, xterm answers the query: that's the answer a replay must not send.
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, "printf '\\033]11;?\\007\\033]0;queried\\007'");
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('queried');
  }).toPass({ timeout: 10_000 });
  await expect.poll(() => live.join('')).toContain(']11;rgb:'); // an answer can span frames

  await page.goto('about:blank'); // a fresh load, not just a new fragment
  const replayed = sentFrames(page);
  await openApp(page, daemon);
  await expect(page.locator('.term.active')).toBeVisible();
  await page.waitForTimeout(1500); // the replay arrives and is parsed
  expect(replayed.join('')).not.toContain('11;rgb:');
});
