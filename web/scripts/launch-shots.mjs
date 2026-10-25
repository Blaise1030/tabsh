import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Renders the Product Hunt gallery, thumbnail and social card from the real
// app screenshots in web/public/shots. Run from web/: node scripts/launch-shots.mjs
const BASE = 'http://127.0.0.1:4321';
const OUT = new URL('../../docs/launch/assets/', import.meta.url).pathname;
const PRESS = new URL('../public/press/', import.meta.url).pathname;

const shot = (file) => `${BASE}/shots/${file}`;

const html = (body, { width = 1270, height = 760 } = {}) => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    background: #0c0c0d; color: #ededed;
    font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: 'Geist Mono', ui-monospace, Menlo, monospace; }
  .wordmark { display: flex; align-items: center; gap: .55rem; font: 600 17px/1 'Geist Mono', monospace; letter-spacing: -.02em; }
  .wordmark img { width: 26px; height: 26px; border-radius: 6px; }
  .wordmark b { font-weight: 600; }
  .wordmark span { color: #8a8a90; font-weight: 400; }
  .bar {
    flex: none; height: 60px; display: flex; align-items: center; gap: .75rem;
    padding: 0 34px; border-top: 1px solid #232326;
    background: #0c0c0d; color: #a9a9b0;
    font: 400 17px/1.35 'Geist Mono', monospace; letter-spacing: -.01em;
  }
  .bar b { color: #ededed; font-weight: 500; }
  .bar .dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none; }
  .frame { position: relative; overflow: hidden; border: 1px solid #2a2a2e; border-radius: 12px; background: #141416; }
  .frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .slide { display: flex; flex-direction: column; height: 100%; }
  .canvas { flex: 1; min-height: 0; padding: 0 34px 26px; display: flex; }
  .canvas .frame { flex: 1; }
  .grain::before {
    content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35;
    background-image: radial-gradient(#ffffff10 1px, transparent 1px); background-size: 22px 22px;
  }
</style></head><body>${body}</body></html>`;

const slides = [
  {
    name: '01-hero',
    html: html(`
      <div class="slide" style="padding:38px 46px 36px">
        <div style="display:flex; align-items:center; justify-content:space-between">
          <div class="wordmark"><img src="${BASE}/favicon.svg" alt=""><b>tabsh</b><span>tabsh.cc</span></div>
          <div class="mono" style="font-size:12px; color:#6f6f77">macOS + Linux · MIT · localhost only</div>
        </div>
        <h1 style="margin:24px 0 0; font-size:47px; line-height:1.02; letter-spacing:-.045em; font-weight:600">
          Your shells and agents, <span style="color:#8a8a90">one calm scroll.</span>
        </h1>
        <p style="margin:12px 0 0; max-width:900px; color:#a9a9b0; font-size:17.5px; line-height:1.5">
          A browser tab for the terminal, the board and every coding agent.
          Shells survive reloads; the board moves itself as the agents work.
        </p>
        <div class="frame" style="flex:1; margin-top:22px; min-height:0; box-shadow:0 24px 70px #0009">
          <img src="${shot('list-terminal-dark.png')}" alt="The tabsh list beside a live terminal">
        </div>
      </div>`),
  },
  {
    name: '02-one-list',
    html: html(`
      <div class="slide">
        <div class="canvas" style="padding-top:26px">
          <div class="frame"><img src="${shot('list-terminal-dark.png')}" alt="Every card across every project in one list, beside a shell"></div>
        </div>
        <div class="bar"><span class="dot"></span><span><b>One list, every project.</b> Grouped by status, tagged with its folder, with the shell right beside it.</span></div>
      </div>`),
  },
  {
    name: '03-agents',
    html: html(`
      <div class="slide">
        <div style="display:flex; gap:22px; padding:26px 34px 18px; min-height:0; flex:1">
          <div style="flex:1; display:flex; flex-direction:column; min-width:0">
            <div class="mono" style="display:flex; align-items:center; gap:.6rem; margin-bottom:10px; font-size:13px; color:#8a8a90">
              <b style="color:#ededed; font-weight:500">TUI</b> a real terminal
            </div>
            <div class="frame" style="flex:1"><img src="${shot('tui-panel-dark.png')}" alt="Claude Code in a real terminal inside a tabsh card"></div>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; min-width:0">
            <div class="mono" style="display:flex; align-items:center; gap:.6rem; margin-bottom:10px; font-size:13px; color:#8a8a90">
              <b style="color:#ededed; font-weight:500">UI</b> a chat panel
            </div>
            <div class="frame" style="flex:1"><img src="${shot('ui-panel-dark.png')}" alt="Claude Code as a chat panel inside a tabsh card"></div>
          </div>
        </div>
        <div class="bar"><span class="dot"></span><span><b>Pick the surface per card.</b> A real terminal, or a chat with models, tools and permissions. Same agent either way.</span></div>
      </div>`),
  },
  {
    name: '04-board',
    html: html(`
      <div class="slide">
        <div class="canvas" style="padding-top:26px">
          <div class="frame"><img src="${shot('board-dark.png')}" alt="The tabsh board with Backlog, In progress, Needs input, Completed and Archived columns"></div>
        </div>
        <div class="bar"><span class="dot"></span><span><b>Drag a card across.</b> Or let the agent move it: prompts, permission requests and finished turns update the board.</span></div>
      </div>`),
  },
  {
    name: '05-hooks',
    html: html(`
      <div class="slide" style="padding:40px 54px 30px; gap:26px">
        <div style="display:flex; align-items:center; gap:10px; color:#8a8a90" class="mono">
          <span class="dot" style="width:7px;height:7px;border-radius:50%;background:#4ade80"></span>
          no polling, no integration to babysit
        </div>
        <div style="display:flex; gap:22px; align-items:flex-start">
          <div style="flex:1; min-width:0">
            <h2 style="margin:0 0 16px; font-size:31px; line-height:1.15; letter-spacing:-.035em; font-weight:600">The card moves<br>as the agent works.</h2>
            <p style="margin:0; color:#a9a9b0; font-size:16.5px; line-height:1.55; max-width:420px">
              Tell Claude Code, Codex, Cursor CLI or OpenCode to run
              <span class="mono" style="color:#ededed">tabsh setup</span>. It adds the hooks
              itself and reports every file it changed. Outside tabsh they do nothing.
            </p>
          </div>
          <div class="frame mono" style="flex:1; padding:18px 20px; font-size:14px; line-height:1.55; background:#101012">
            <div style="color:#6f6f77"># you send a prompt</div>
            <div style="color:#ededed">tabsh status in_progress --hook</div>
            <div style="height:14px"></div>
            <div style="color:#6f6f77"># the agent needs you</div>
            <div style="color:#ededed">tabsh status needs_input --hook</div>
            <div style="height:14px"></div>
            <div style="color:#6f6f77"># the task is done</div>
            <div style="color:#ededed">tabsh status completed \<br>&nbsp;&nbsp;--note "Opened PR #148"</div>
          </div>
        </div>
        <div style="margin-top:26px; display:flex; gap:10px; flex-wrap:wrap">
          <span class="mono" style="padding:5px 10px; border:1px solid #2a2a2e; border-radius:999px; font-size:12px; color:#a9a9b0">Claude Code</span>
          <span class="mono" style="padding:5px 10px; border:1px solid #2a2a2e; border-radius:999px; font-size:12px; color:#a9a9b0">Codex</span>
          <span class="mono" style="padding:5px 10px; border:1px solid #2a2a2e; border-radius:999px; font-size:12px; color:#a9a9b0">Cursor CLI</span>
          <span class="mono" style="padding:5px 10px; border:1px solid #2a2a2e; border-radius:999px; font-size:12px; color:#a9a9b0">OpenCode</span>
          <span class="mono" style="padding:5px 10px; border:1px solid #2a2a2e; border-radius:999px; font-size:12px; color:#a9a9b0">any CLI with a prompt</span>
        </div>
        <div class="bar" style="margin:auto -54px 0; border-top:0"><span class="dot"></span><span><b>No polling, no integration to babysit.</b> The hooks are normal commands; outside tabsh they do nothing.</span></div>
      </div>`),
  },
  {
    name: '06-providers',
    html: html(`
      <div class="slide" style="padding:38px 46px 0">
        <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:30px">
          <div>
            <div class="mono" style="color:#8a8a90; font-size:12px; letter-spacing:.02em">BRING YOUR OWN AGENT</div>
            <h2 style="margin:10px 0 0; font-size:36px; line-height:1.1; letter-spacing:-.04em; font-weight:600">Commands, not integrations.</h2>
          </div>
          <p style="margin:0 0 4px; max-width:440px; color:#a9a9b0; font-size:15.5px; line-height:1.5">
            Every provider is a command you can change: startup, resume, and ACP.
            Add any CLI that takes a prompt.
          </p>
        </div>
        <div style="display:flex; gap:18px; margin-top:26px">
          <div class="frame" style="flex:1"><img src="${shot('providers-dark.png')}" alt="The agent provider list: Claude Code, Codex, Cursor CLI and OpenCode"></div>
          <div class="frame" style="flex:1"><img src="${shot('providers-detail-dark.png')}" alt="Claude Code's startup, resume and ACP commands"></div>
        </div>
        <div class="bar" style="margin:auto -46px 0; border-top:0"><span class="dot"></span><span><b>Claude Code, Codex, Cursor CLI, OpenCode</b> …or any CLI that takes a prompt. Nothing to configure in a settings file.</span></div>
      </div>`),
  },
];

const thumb = html(
  `
  <div style="height:100%; display:grid; place-items:center; background:#0c0c0d">
    <div style="display:grid; place-items:center; width:172px; height:172px; border-radius:38px; background:#18181b; border:1px solid #2a2a2e; box-shadow:0 20px 60px #0008">
      <svg viewBox="0 0 32 32" width="112" height="112" aria-hidden="true">
        <path d="M8 11l5 5-5 5M15 22h9" fill="none" stroke="#e4e4e7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  </div>`,
  { width: 240, height: 240 },
);

const og = html(
  `
  <div style="height:100%; padding:46px 52px 44px; display:flex; flex-direction:column; gap:26px; background:#0c0c0d">
    <div style="display:flex; align-items:center; justify-content:space-between">
      <div class="wordmark" style="font-size:20px"><img src="${BASE}/favicon.svg" alt="" style="width:32px;height:32px"><b>tabsh</b><span>tabsh.cc</span></div>
      <div class="mono" style="font-size:13px; color:#8a8a90">macOS + Linux · MIT · localhost only</div>
    </div>
    <div style="display:flex; gap:26px; flex:1; min-height:0">
      <div style="width:360px; flex:none; display:flex; flex-direction:column; justify-content:center">
        <div style="font-size:38px; line-height:1.06; letter-spacing:-.04em; font-weight:600">Your shells and agents,<br><span style="color:#8a8a90">one calm scroll.</span></div>
        <div style="margin-top:16px; color:#a9a9b0; font-size:15px; line-height:1.5">The terminal and every coding agent, in the browser tab next to your work.</div>
      </div>
      <div class="frame" style="flex:1; min-width:0"><img src="${shot('list-terminal-dark.png')}" alt="" style="object-position:top left"></div>
    </div>
  </div>`,
  { width: 1200, height: 630 },
);

await mkdir(OUT, { recursive: true });
await mkdir(PRESS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1270, height: 760 }, deviceScaleFactor: 1 });
// setContent inherits the current origin; from about:blank Chrome refuses the
// local screenshots (opaque origin -> localhost), so visit the dev server first.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
for (const s of slides) {
  await page.setContent(s.html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}${s.name}.png` });
  await page.screenshot({ path: `${PRESS}${s.name}.png` });
  console.log(`gallery ${s.name}.png`);
}

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
console.log('og.png 1200x630');

await page.setViewportSize({ width: 240, height: 240 });
await page.setContent(thumb, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${PRESS}icon-240.png` });
console.log('press/icon-240.png 240x240');

await browser.close();
