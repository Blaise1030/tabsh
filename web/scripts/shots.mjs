// Capture the landing page's feature stills from /demo/.
// Run the dev server first, then: node scripts/shots.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:4321/demo/?view=board&layout=list';
// The review card's demo id; the same split view fig. 1 opens live.
const split = `${base}&tab=demo-9&drawer=1`;
// The shop: npm run dev card, a real terminal rather than a chat.
const terminal = `${base}&tab=demo-1&drawer=1`;
const dir = new URL('../public/shots/', import.meta.url);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();

async function open(scheme = 'dark', url = base, viewport = { width: 1440, height: 900 }) {
  const p = await browser.newPage({
    viewport,
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Past the demo's last scripted status hook (6s), so the board is settled.
  await p.waitForTimeout(7000);
  return p;
}

// The list with a live shell beside it, and the same cards as columns.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme, terminal);
  await p.screenshot({ path: new URL(`list-terminal-${scheme}.png`, dir).pathname });
  await p.close();
}
const columns = new URL(base);
columns.searchParams.delete('layout');
columns.searchParams.delete('tab');
columns.searchParams.delete('drawer');
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme, columns.href);
  await p.screenshot({ path: new URL(`board-${scheme}.png`, dir).pathname });
  await p.close();
}

// The poster for fig. 1: the same app with the review card open in split view.
// The frame's app area is 16:9 (16:10 window minus the chrome and URL bar), so
// capturing that shape keeps the message box from being cropped at the bottom.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme, split, { width: 1440, height: 810 });
  await p.screenshot({ path: new URL(`../preview-${scheme}.png`, dir).pathname });
  await p.close();
}

// The agent surfaces close up, for fig. 4: Claude Code's TUI and UI. The list
// already has its own figures, so these are the drawer alone; at the page's
// width the terminal and chat stay readable instead of shrinking to half size.
for (const scheme of ['dark', 'light']) {
  for (const [name, tab] of [['tui-panel', 'demo-3'], ['ui-panel', 'demo-9']]) {
    const p = await open(scheme, `${base}&tab=${tab}&drawer=1`);
    // The drawer bar carries the card name and status; the side-tab strip is
    // app chrome that would crowd the close-up.
    await p.addStyleTag({ content: '#session-bar { display: none !important; }' });
    await p.waitForTimeout(300);
    await p.locator('#frame').screenshot({ path: new URL(`${name}-${scheme}.png`, dir).pathname });
    await p.close();
  }
}

// Agent providers: the list, then one provider's settings. Both cropped to
// the dialog so the commands are readable at the page's column width.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme, `${base}&palette=providers`);
  const cmd = p.locator('#palette-command');
  const margin = 24;
  const shot = async (name) => {
    const box = await cmd.boundingBox();
    if (!box) throw new Error('the providers dialog did not open');
    await p.screenshot({
      path: new URL(`${name}-${scheme}.png`, dir).pathname,
      clip: { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 },
    });
  };
  await shot('providers');
  await p.getByRole('menuitem', { name: /Claude Code/ }).click();
  await p.waitForTimeout(400);
  await shot('providers-detail');
  await p.close();
}

// Optional remote access: the palette's "Open on another device" page.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme);
  await p.keyboard.press('Meta+k');
  await p.waitForTimeout(600);
  await p.keyboard.type('another device');
  await p.waitForTimeout(600);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  await p.getByText('Add device…', { exact: true }).click();
  await p.waitForTimeout(400);
  await p.keyboard.type('iPad');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: new URL(`tailscale-${scheme}.png`, dir).pathname });
  await p.close();
}

await browser.close();
console.log('wrote', dir.pathname);
