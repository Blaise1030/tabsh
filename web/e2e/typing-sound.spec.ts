// Typing sounds everywhere in the app, end to end. No real sound is needed:
// an init script wraps the audio calls, counting each started sample and
// remembering which pack's file it was decoded from.
import { expect, openApp, test } from './fixture.ts';
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';

declare global {
  interface Window {
    __plays: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__plays = [];
    // Tag each downloaded file's bytes with its URL, and the decoded buffer with the tag.
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function (this: Response) {
      const ab = await arrayBuffer.call(this);
      (ab as unknown as { url: string }).url = this.url;
      return ab;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    // biome-ignore lint/suspicious/noExplicitAny: wrapping a overloaded DOM method
    AudioContext.prototype.decodeAudioData = function (this: AudioContext, data: ArrayBuffer, ...rest: any[]) {
      const url = (data as unknown as { url?: string }).url ?? '';
      // biome-ignore lint/suspicious/noExplicitAny: as above
      return (decode as any).call(this, data, ...rest).then((buf: AudioBuffer) => {
        (buf as unknown as { url: string }).url = url;
        return buf;
      });
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: []) {
      window.__plays.push((this.buffer as unknown as { url?: string } | null)?.url ?? '');
      return start.apply(this, args);
    };
  });
});

const plays = (page: Page) => page.evaluate(() => window.__plays.length);

async function setTypingSound(page: Page, daemon: Daemon, typingSound: string): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const res = await page.request.put(`${daemon.baseUrl}/api/settings`, { headers, data: { ...now, typingSound } });
  expect(res.status()).toBe(204);
}

async function openPalette(page: Page): Promise<void> {
  await page.locator('#settings-btn').click();
  await expect(page.locator('#palette-input')).toBeFocused();
}

test.afterEach(async ({ page, daemon }) => setTypingSound(page, daemon, 'mx-black-pbt'));

test('typing in the palette sounds, and app shortcuts stay silent', async ({ page, daemon }) => {
  await setTypingSound(page, daemon, 'mx-black-pbt');
  await openApp(page, daemon);
  await openPalette(page);
  // The first keys may only start the pack's download; the rest sound.
  await expect
    .poll(async () => {
      const before = await plays(page);
      await page.keyboard.type('abc');
      return (await plays(page)) - before;
    })
    .toBeGreaterThan(0);

  await page.waitForTimeout(300);
  const before = await plays(page);
  await page.keyboard.press('Control+Shift+BracketRight'); // next tab
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+Shift+KeyK'); // the palette's own shortcut
  await page.keyboard.press('Shift'); // a lone modifier
  await page.waitForTimeout(300);
  expect(await plays(page)).toBe(before);
});

test('with typing sound off, nothing plays', async ({ page, daemon }) => {
  await setTypingSound(page, daemon, 'off');
  await openApp(page, daemon);
  await openPalette(page);
  await page.keyboard.type('abc');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  expect(await plays(page)).toBe(0);
});

test('the palette plays the pack it is previewing', async ({ page, daemon }) => {
  await setTypingSound(page, daemon, 'mx-black-pbt');
  await openApp(page, daemon);
  await openPalette(page);
  await page.keyboard.type('typing sound');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette [role="menuitem"]', { hasText: 'Holy Panda' })).toBeVisible();
  // Highlight Holy Panda (its highlight previews it, which also loads it).
  await page.locator('#palette [role="menuitem"]', { hasText: 'Holy Panda' }).hover();
  await expect(page.locator('#palette [role="menuitem"].active', { hasText: 'Holy Panda' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__plays.some((u) => u.includes('/holy-panda/')))).toBe(true);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__plays = [];
  });
  await page.keyboard.press('ArrowLeft'); // moves the caret, so the highlight stays
  await expect.poll(() => page.evaluate(() => window.__plays.length)).toBeGreaterThan(0);
  const urls = await page.evaluate(() => window.__plays);
  expect(urls.every((u) => u.includes('/holy-panda/'))).toBe(true);
});
