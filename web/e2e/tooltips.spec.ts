// The tab-bar buttons a keybinding toggles show that keybinding in their
// tooltip — always the currently configured one, so re-recording the
// shortcut changes the tooltip on the next hover. Labels come from the
// app's own keybinding code, so the spec stays true on mac and linux.
import { expect, openApp, test } from './fixture.ts';
import { keybindings, keyLabel } from '../src/app/settings/keys.ts';

// The daemon serves the page on the OS the spec runs on, and the page picks
// its preset labels for that OS.
const mac = process.platform === 'darwin';
const preset = (id: keyof ReturnType<typeof keybindings>) => keyLabel(keybindings(mac)[id].presets[0], mac);

test("hovering a toggle button shows its keybinding in the tooltip", async ({ page, daemon }) => {
  await openApp(page, daemon);

  for (const [selector, label] of [
    ['#board-btn', `Board (${preset('keyToggleBoard')})`],
    ['#explorer-btn', `Toggle file explorer (${preset('keyToggleExplorer')})`],
    ['#tab-group-btn', `Group tabs (${preset('keyGroupTabs')})`],
    ['#settings-btn', `Settings (${preset('keyPalette')})`],
  ] as const) {
    await page.locator(selector).hover();
    await expect(page.locator(selector)).toHaveAttribute('title', label);
  }
});

test("the tooltip follows a re-recorded keybinding", async ({ page, daemon }) => {
  await openApp(page, daemon);

  // Re-record the board shortcut through the palette, as a user would.
  await page.locator('#settings-btn').click();
  await page.getByRole('menuitem', { name: /Toggle board…/ }).click();
  await page.getByRole('menuitem', { name: /Record shortcut…/ }).click();
  await page.keyboard.press(mac ? 'Meta+Shift+G' : 'Control+Shift+G');
  await page.keyboard.press('Escape'); // back to the palette's root page
  await page.keyboard.press('Escape'); // closes the palette
  await expect(page.locator('#palette')).toBeHidden();

  const rebound = keyLabel(mac ? 'meta+shift+KeyG' : 'ctrl+shift+KeyG', mac);
  await page.locator('#board-btn').hover();
  await expect(page.locator('#board-btn')).toHaveAttribute('title', `Board (${rebound})`);
});
