// Render the social preview from the same stills the landing page uses.
// Run after scripts/shots.mjs: node scripts/og.mjs
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const still = readFileSync(new URL('../public/preview-light.png', import.meta.url)).toString('base64');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;600&display=swap">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    position: relative; overflow: hidden; padding: 60px 64px;
    display: grid; grid-template-columns: 486px 1fr; column-gap: 52px; align-items: center;
    background: #f7f7f7; color: #1a1a1a;
    font-family: 'Geist Mono', ui-monospace, Menlo, monospace;
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 52px; font-size: 17px; font-weight: 600; letter-spacing: .14em; }
  .brand i { width: 11px; height: 19px; background: #1a1a1a; }
  .eyebrow { margin: 0 0 18px; color: #6b6b6b; font-size: 13px; letter-spacing: .12em; }
  h1 { margin: 0; font-size: 62px; line-height: 1.02; letter-spacing: -.035em; font-weight: 600; }
  .lede {
    margin: 24px 0 0; max-width: 29rem;
    font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
    font-size: 19px; line-height: 1.5; color: #454545;
  }
  .url { position: absolute; left: 64px; bottom: 54px; font-size: 15px; color: #1a1a1a; }
  .url span { color: #6b6b6b; }
  figure { margin: 0; position: relative; }
  .browser {
    overflow: hidden; border: 1px solid #d8d2c9; border-radius: 13px; background: #fff;
    box-shadow: 0 24px 60px rgb(40 32 24 / 16%);
  }
  .bar { height: 33px; display: flex; align-items: center; gap: 6px; padding: 0 14px; background: #efeae4; border-bottom: 1px solid #e2ddd6; }
  .bar i { width: 8px; height: 8px; border-radius: 50%; background: #c9c1b6; }
  .tab { margin-left: 10px; padding: 4px 12px; border-radius: 6px 6px 0 0; background: #f7f7f7; color: #454545; font-size: 11px; }
  img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; object-position: top left; }
</style>
</head>
<body>
  <main>
    <div class="brand">TABSH<i></i></div>
    <p class="eyebrow">A CALMER WAY TO WORK WITH AGENTS</p>
    <h1>ONE CALM SCROLL,<br>EVERY PROJECT.</h1>
    <p class="lede">Shells and agents in the browser tab next to your work. Every card, in one list.</p>
    <p class="url"><span>&gt;</span> tabsh.cc</p>
  </main>
  <figure>
    <div class="browser">
      <div class="bar"><i></i><i></i><i></i><span class="tab">tabsh</span></div>
      <img src="data:image/png;base64,${still}" alt="">
    </div>
  </figure>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('wrote public/og.png');
