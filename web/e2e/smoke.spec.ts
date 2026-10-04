// The smoke test: the whole loop — page → daemon → PTY → page — with the
// real daemon, the daemon's own copy of the app page, and a real browser.
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

test('a tab appears and is renamed by a command typed into it', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page);

  // Rename the tab from inside the shell: the OSC 0 title escape is the one
  // observable DOM effect of shell output (xterm paints to canvas, which
  // cannot be asserted). The retry covers a keystroke landing before the
  // tab's socket is open; ^C first keeps any retry on a fresh prompt line.
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, "printf '\\033]0;smoke-test\\007'");
    await page.keyboard.press('Enter');
    // The tab we typed into is the selected one in the strip.
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('smoke-test');
  }).toPass({ timeout: 10_000 });
});
