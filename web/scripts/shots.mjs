// Capture the landing page's feature stills from /demo/.
// Run the dev server first, then: node scripts/shots.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:4321/demo/?view=board&layout=list';
// The review card's demo id; the same split view fig. 1 opens live.
const split = `${base}&tab=demo-9&drawer=1`;
const dir = new URL('../public/shots/', import.meta.url);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();

async function open(scheme = 'dark', url = base) {
  const p = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Past the demo's last scripted status hook (6s), so the board is settled.
  await p.waitForTimeout(7000);
  return p;
}

// The list: every card, both projects, one scroll.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme);
  await p.screenshot({ path: new URL(`list-${scheme}.png`, dir).pathname });
  await p.close();
}

// The poster for fig. 1: the same app with the review card open in split view.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme, split);
  await p.screenshot({ path: new URL(`../preview-${scheme}.png`, dir).pathname });
  await p.close();
}

// Model configuration: a UI card's drawer, with the model picker open.
for (const scheme of ['dark', 'light']) {
  const p = await open(scheme);
  await p.getByRole('region', { name: 'Board' }).getByText('Review the auth flow', { exact: true }).click();
  await p.waitForTimeout(1800);
  // Widen the drawer so the chat and the model menu are readable in a still.
  await p.evaluate(() => document.documentElement.style.setProperty('--drawer-width', '0.62'));
  await p.waitForTimeout(600);
  await p.locator('.chat-model-chip').click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: new URL(`models-${scheme}.png`, dir).pathname });
  await p.close();
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
