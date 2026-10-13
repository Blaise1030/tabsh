// A phone's terminal: the key bar types what the phone keyboard lacks, and a
// finger drags the scrollback by whole lines (sessions/keybar.ts, touch.ts).
import type { Page } from '@playwright/test';
import { dropSessions, expect, openApp, test, typeInTerminal } from './fixture.ts';

type TouchType = 'touchStart' | 'touchMove' | 'touchEnd';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

function sentFrames(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => sent.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('latin1')));
  });
  return sent;
}

test.beforeEach(async ({ page, daemon }) => dropSessions(page, daemon));

test('the key bar types Ctrl chords and arrows into the shell', async ({ page, daemon }) => {
  const sent = sentFrames(page);
  await openApp(page, daemon);
  const bar = page.getByRole('toolbar', { name: 'Terminal keys' });
  await expect(bar).toBeVisible();
  await typeInTerminal(page, 'x');

  const ctrl = bar.getByRole('button', { name: 'Control' });
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('c');
  await expect.poll(() => sent.join('')).toContain('\u0003');
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');

  await bar.getByRole('button', { name: 'Up' }).tap();
  await expect.poll(() => sent.join('')).toContain('\u001b[A');

  await bar.getByRole('button', { name: 'Space' }).tap();
  await bar.getByRole('button', { name: 'Enter' }).tap();
  await expect.poll(() => sent.join('')).toContain(' \r');
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
});

test('a finger drags the scrollback', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await typeInTerminal(page, 'seq 1 400');
  await page.keyboard.press('Enter');
  await expect(page.locator('.term.active .xterm-rows')).toContainText('399'); // output, not the command line
  const toBottom = page.getByRole('button', { name: 'Scroll to bottom' });
  await expect(toBottom).toBeHidden();

  const box = await page.locator('.term.active .xterm-screen').boundingBox();
  if (!box) throw new Error('no terminal screen');
  const x = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: TouchType, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', box.y + 40);
  for (let y = box.y + 40; y <= box.y + 340; y += 20) await touch('touchMove', y);
  await touch('touchEnd', box.y + 340);

  await expect(toBottom).toBeVisible();
});

test('a pinch sets this device’s font size, and fewer columns fit', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(page.locator('.term.active .xterm-screen')).toBeVisible();
  const cols = () => page.evaluate(() => (document.querySelector('.term.active .xterm-rows > div')?.textContent ?? '').length);
  const box = await page.locator('.term.active .xterm-screen').boundingBox();
  if (!box) throw new Error('no terminal screen');
  const cx = box.x + box.width / 2;
  const cy = box.y + 200;
  const cdp = await page.context().newCDPSession(page);
  const pinch = (type: TouchType, half: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - half, y: cy, id: 0 },
              { x: cx + half, y: cy, id: 1 },
            ],
    });
  await pinch('touchStart', 40);
  for (let half = 40; half <= 80; half += 10) await pinch('touchMove', half);
  await pinch('touchEnd', 80);

  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem('tabsh.fontSize.device')))).toBeGreaterThan(20);
  await page.reload();
  await expect(page.locator('.term.active .xterm-screen')).toBeVisible();
  await expect.poll(cols).toBeLessThan(30);
});
