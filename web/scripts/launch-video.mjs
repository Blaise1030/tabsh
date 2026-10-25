import { mkdir, rename } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Records the 35s demo for Product Hunt from the scripted demo. Run from web/
// with the dev server up: node scripts/launch-video.mjs
const BASE = 'http://localhost:4321';
const OUT = new URL('../../docs/launch/assets/', import.meta.url).pathname;
const RAW = new URL('../../docs/launch/assets/.raw/', import.meta.url).pathname;

await mkdir(RAW, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  colorScheme: 'dark',
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`${BASE}/demo/?view=board&layout=columns`, { waitUntil: 'networkidle' });

// Caption bar and click ripples, drawn over the real app.
await page.addStyleTag({
  content: `
    #launch-cap {
      position: fixed; z-index: 2147483000; left: 50%; top: 14px; translate: -50% 0;
      max-width: min(92vw, 900px); padding: 10px 18px; border-radius: 10px;
      background: rgb(12 12 13 / 88%); color: #ededed; border: 1px solid #2e2e33;
      font: 400 17px/1.35 'Geist Mono', ui-monospace, Menlo, monospace;
      opacity: 0; transition: opacity .28s ease; pointer-events: none; white-space: nowrap;
      box-shadow: 0 10px 34px #0008;
    }
    #launch-cap.on { opacity: 1; }
    .ripple { position: fixed; z-index: 2147482999; width: 18px; height: 18px; margin: -9px 0 0 -9px;
      border-radius: 50%; border: 2px solid #ededed; pointer-events: none; animation: rip .45s ease-out forwards; }
    @keyframes rip { from { scale: .5; opacity: .9 } to { scale: 2.4; opacity: 0 } }
    #launch-end { position: fixed; inset: 0; z-index: 2147483001; display: none; place-items: center;
      background: #0c0c0d; color: #ededed; font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; }
    #launch-end.on { display: grid; }
    #launch-end .wrap { text-align: center; }
    #launch-end .mark { width: 64px; height: 64px; border-radius: 15px; background: #18181b; border: 1px solid #2e2e33;
      display: grid; place-items: center; margin: 0 auto 22px; }
    #launch-end h1 { margin: 0; font-size: 46px; line-height: 1.06; letter-spacing: -.045em; font-weight: 600; }
    #launch-end p { margin: 14px 0 0; color: #a9a9b0; font-size: 18px; }
    #launch-end code { display: inline-block; margin-top: 26px; padding: 10px 16px; border-radius: 8px;
      background: #141416; border: 1px solid #2e2e33; color: #ededed; font: 400 14px/1.4 'Geist Mono', monospace; }
  `,
});
await page.evaluate(() => {
  const cap = document.createElement('div');
  cap.id = 'launch-cap';
  document.body.append(cap);
  const end = document.createElement('div');
  end.id = 'launch-end';
  end.innerHTML = `<div class="wrap">
    <div class="mark"><svg viewBox="0 0 32 32" width="40" height="40"><path d="M8 11l5 5-5 5M15 22h9" fill="none" stroke="#e4e4e7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1>Your shells and agents,<br><span style="color:#8a8a90">one calm scroll.</span></h1>
    <p>tabsh.cc &nbsp;·&nbsp; free &nbsp;·&nbsp; MIT &nbsp;·&nbsp; localhost only</p>
    <code>curl -fsSL https://tabsh.cc/install.sh | sh</code>
  </div>`;
  document.body.append(end);
});

const caption = async (text) => {
  await page.evaluate((t) => {
    const cap = document.getElementById('launch-cap');
    cap.textContent = t;
    cap.classList.toggle('on', !!t);
  }, text);
};
const wait = (ms) => page.waitForTimeout(ms);
const ripple = async () => {
  const p = await page.evaluate(() => {
    const el = document.querySelector('.board-card, #board-btn');
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 640, y: 360 };
  });
  await page.evaluate(({ x, y }) => {
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    document.body.append(d);
    setTimeout(() => d.remove(), 500);
  }, p);
};

// 0:00 — the board, while two hooks move cards on their own.
await caption('Your agents are already working.');
await wait(900);
await caption('The board moves as they do.');
await wait(7200);

// 0:09 — one list across projects.
await caption('Every project. One list.');
await page.click('#board-btn');
await wait(1600);

// 0:12 — an agent needs a decision.
await caption('An agent needs a decision.');
const row = page.locator('.board-card', { hasText: 'Review the auth flow' }).first();
await row.click();
await wait(1400);

// 0:16 — answer without leaving the tab.
await caption('Answer without leaving the tab.');
await page.locator('textarea[aria-label="Message"]').focus();
await page.keyboard.type('Run the tests and check the diff.', { delay: 22 });
await wait(300);
await page.keyboard.press('Enter');
await wait(3200);

// 0:23 — the other surface.
await caption('Prefer the real terminal? It is one click away.');
await wait(1800);
await page.click('#drawer-close');
await wait(1200);
await caption('');
await wait(400);

// 0:27 — end card.
await page.evaluate(() => document.getElementById('launch-end').classList.add('on'));
await wait(4200);

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
await rename(raw, `${OUT}tabsh-demo.webm`);
console.log(`video ${OUT}tabsh-demo.webm`);
