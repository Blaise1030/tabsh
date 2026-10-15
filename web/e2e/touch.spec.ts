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
  await openApp(page, daemon, { phone: true });
  const bar = page.getByRole('toolbar', { name: 'Terminal keys' });
  await expect(bar).toBeVisible();
  await typeInTerminal(page, 'x');

  const ctrl = bar.getByRole('button', { name: 'Control', exact: true });
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('c');
  await expect.poll(() => sent.join('')).toContain('\u0003');
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');

  await bar.getByRole('button', { name: 'Up' }).tap();
  await expect.poll(() => sent.join('')).toContain('\u001b[A');

  await bar.getByRole('button', { name: 'Shift Tab' }).tap();
  await expect.poll(() => sent.join('')).toContain('\u001b[Z');
  sent.length = 0;
  await bar.getByRole('button', { name: 'Control C', exact: true }).tap();
  await expect.poll(() => sent.join('')).toContain('\u0003');
  // Thumb-sized: Apple's 44pt minimum.
  expect((await bar.getByRole('button', { name: 'Escape' }).boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await bar.getByRole('button', { name: 'Space' }).tap();
  await bar.getByRole('button', { name: 'Enter' }).tap();
  await expect.poll(() => sent.join('')).toContain(' \r');
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
});

test("the bars' icon buttons are thumb-sized", async ({ page, daemon }) => {
  const sizes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#app > .tabbar .btn[data-size^="icon"], .drawer-bar .btn[data-size^="icon"]')]
        .filter((b) => b.offsetParent)
        .map((b) => [b.getAttribute('aria-label'), b.getBoundingClientRect().width, b.getBoundingClientRect().height] as const),
    );
  await openApp(page, daemon, { phone: true });
  const drawer = await sizes();
  expect(drawer.length).toBeGreaterThan(1);
  for (const [name, w, h] of drawer) expect([name, w >= 44 && h >= 44]).toEqual([name, true]);
  await page.locator('#drawer-close').tap();
  await expect(page.locator('#board')).toBeVisible();
  const board = await sizes();
  expect(board.length).toBeGreaterThan(1);
  for (const [name, w, h] of board) expect([name, w >= 44 && h >= 44]).toEqual([name, true]);
});

test('a phone has no tab mode: the board as columns or a list, terminals in the drawer', async ({ page, daemon }) => {
  const view = () => new URL(page.url()).searchParams.get('view');
  await openApp(page, daemon, { phone: true });
  expect(view()).toBe('board');
  await page.locator('#drawer-close').tap();
  const layouts: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.locator('#board-btn').tap();
    await expect(page.locator('#board')).toBeVisible();
    layouts.push((await page.locator('#board').getAttribute('class')) ?? '');
  }
  expect(layouts.map((c) => (/\blist\b/.test(c) ? 'list' : 'columns'))).toEqual(['list', 'columns', 'list']);
  // A link to the terminals lands on the board, the terminal in its drawer.
  await page.goto(`${daemon.baseUrl}/app/?view=terms`);
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect.poll(view).toBe('board');
});

test('the key bar fades at an edge with more keys past it', async ({ page, daemon }) => {
  await openApp(page, daemon, { phone: true });
  const bar = page.getByRole('toolbar', { name: 'Terminal keys' });
  await expect(bar).toHaveClass(/fade-right/);
  await expect(bar).not.toHaveClass(/fade-left/);
  await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(bar).toHaveClass(/fade-left/);
  await expect(bar).not.toHaveClass(/fade-right/);
});

test("the key bar's paperclip uploads picked files and types their paths", async ({ page, daemon }) => {
  const sent = sentFrames(page);
  await openApp(page, daemon, { phone: true });
  const bar = page.getByRole('toolbar', { name: 'Terminal keys' });
  const chooser = page.waitForEvent('filechooser');
  await bar.getByRole('button', { name: 'Attach files' }).tap();
  await (await chooser).setFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
    { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('png') },
  ]);
  await expect.poll(() => sent.join('')).toMatch(/\/[^ ]*-notes\.txt '?\/[^ ]*-shot\.png/);
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
});

test("the key bar's Paste reads the clipboard where the page may", async ({ page, daemon }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const sent = sentFrames(page);
  await openApp(page, daemon, { phone: true });
  await page.evaluate(() => navigator.clipboard.writeText('from-clipboard'));
  await page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Paste' }).tap();
  await expect.poll(() => sent.join('')).toContain('from-clipboard');
  await expect(page.locator('.paste-sheet')).toBeHidden();
});

test("without the clipboard API (plain HTTP), Paste opens a sheet the phone's own Paste works in", async ({
  page,
  daemon,
}) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined }));
  const sent = sentFrames(page);
  await openApp(page, daemon, { phone: true });
  const paste = page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Paste' });
  const sheet = page.locator('.paste-sheet');
  const box = sheet.getByRole('textbox', { name: 'Paste text' });

  await paste.tap();
  await expect(box).toBeFocused();
  await box.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'from-paste-event');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => sent.join('')).toContain('from-paste-event');
  await expect(sheet).toBeHidden();
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();

  // A keyboard's clipboard chip types the text instead: Send takes it.
  await paste.tap();
  await box.fill('from-typing');
  await sheet.getByRole('button', { name: 'Send' }).tap();
  await expect.poll(() => sent.join('')).toContain('from-typing');
  await expect(sheet).toBeHidden();
});

test('a finger drags the scrollback', async ({ page, daemon }) => {
  await openApp(page, daemon, { phone: true });
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
  await openApp(page, daemon, { phone: true });
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

test("a card's terminal has the screen: no tab bar, no Expand", async ({ page, daemon }) => {
  const tabbar = page.locator('#app > .tabbar');
  await openApp(page, daemon, { phone: true });
  await expect(page.locator('#frame')).toHaveClass(/in-drawer/);
  await expect(tabbar).toBeHidden();
  await expect(page.locator('#drawer-expand')).toBeHidden();
  await expect(page.locator('.term.active .xterm-screen')).toBeVisible();

  await page.locator('#drawer-close').tap();
  await expect(page.locator('#board')).toBeVisible();
  await expect(tabbar).toBeVisible();
});
