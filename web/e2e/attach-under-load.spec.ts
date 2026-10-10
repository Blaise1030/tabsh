// Busy tabs stay responsive (Slice 4): while a shell floods output, a second
// client attaching to it (or the first one reloading) gets the replayed
// scrollback and then the live stream, with nothing lost or repeated at the
// seam, the shell keeps producing, and the page answers clicks meanwhile.
//
// The shell numbers its output: each burst of lines ends with an OSC 0 title
// `tick-N`. The tab's name shows the latest tick (the DOM effect of terminal
// output), and the socket's frames, replay then live, must carry the ticks
// N, N+1, N+2… with no gap or repeat.
import type { Page, WebSocket } from '@playwright/test';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// awk writes as fast as the PTY drains: the heaviest output a shell gives.
const FLOOD =
  "awk 'BEGIN { for (i = 1; ; i++) { for (j = 0; j < 1500; j++) print \"busy busy busy busy busy busy busy busy\"; printf \"\\033]0;tick-%d\\007\", i; fflush() } }'";

const activeName = (page: Page) => page.locator('#tabs .tab:not(.mirror)[aria-selected="true"] span');

async function tick(page: Page): Promise<number> {
  const m = /^tick-(\d+)$/.exec((await activeName(page).textContent()) ?? '');
  return m ? Number(m[1]) : -1;
}

// The ticks one terminal socket carries, in order: the first binary frame
// (the replay) then the live frames. Only the numbers are kept; a short tail
// is carried over so a tick split across frames is still read once.
interface Seam {
  replayed: number[];
  live: number[];
}

function watchTerminalSockets(page: Page): Seam[] {
  const seams: Seam[] = [];
  page.on('websocket', (ws: WebSocket) => {
    if (!/\/ws\?/.test(ws.url())) return;
    const seam: Seam = { replayed: [], live: [] };
    seams.push(seam);
    let first = true;
    let tail = '';
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') return; // control messages
      const text = tail + f.payload.toString('latin1');
      const into = first ? seam.replayed : seam.live;
      first = false;
      // Count only complete ticks (terminated by BEL); keep the rest.
      let end = 0;
      for (const m of text.matchAll(/\x1b\]0;tick-(\d+)\x07/g)) {
        into.push(Number(m[1]));
        end = (m.index ?? 0) + m[0].length;
      }
      tail = text.slice(Math.max(end, text.length - 32));
    });
  });
  return seams;
}

// The sockets of the flooding tab: those whose replay carried ticks. Each
// tab switch parks the off-screen tab's socket and reattaches on return, so
// there can be several; the newest is the one streaming now.
const flooding = (seams: Seam[]) => seams.filter((s) => s.replayed.length > 0);
const newest = (seams: Seam[]) => flooding(seams).at(-1);

// The tab shows ticks past its newest replay, streamed live on that socket,
// and on every socket replay and live together count up by one: nothing
// missed, nothing twice.
async function expectLive(page: Page, seams: Seam[]) {
  await expect.poll(() => newest(seams)?.live.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(3);
  const replayed = newest(seams)?.replayed.at(-1) ?? 0;
  await expect.poll(() => tick(page), { timeout: 15_000 }).toBeGreaterThan(replayed + 3);
  for (const seam of flooding(seams)) {
    const all = [...seam.replayed, ...seam.live];
    for (let i = 1; i < all.length; i++) {
      if (all[i] !== all[i - 1] + 1) {
        throw new Error(`ticks jump from ${all[i - 1]} to ${all[i]} at ${i} (replay ${seam.replayed.length})`);
      }
    }
  }
}

test('attaching to a flooding shell replays, then streams live, and the page stays interactive', async ({
  page,
  daemon,
  context,
}) => {
  test.setTimeout(90_000);
  await openApp(page, daemon);

  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, FLOOD);
    await page.keyboard.press('Enter');
    await expect(activeName(page)).toHaveText(/^tick-\d+$/, { timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  // Let the scrollback fill (512KB is ~6 ticks of ~60KB).
  await expect.poll(() => tick(page), { timeout: 20_000 }).toBeGreaterThan(15);

  // A second client attaches to the same busy session.
  const other = await context.newPage();
  const seams = watchTerminalSockets(other);
  await openApp(other, daemon);
  await expect(activeName(other)).toHaveText(/^tick-\d+$/, { timeout: 10_000 });
  // The page answers while its terminal attaches and streams: a new tab
  // opens, and switching back reattaches (and replays) the busy one.
  const tabs = other.locator('#tabs .tab:not(.mirror)');
  const busy = await tabs.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
  await newTab(other);
  await tabs.nth(busy).click();
  await expect(tabs.nth(busy)).toHaveAttribute('aria-selected', 'true');
  // The producer kept running for both clients, past what was replayed.
  await expectLive(other, seams);
  await expect.poll(() => tick(page), { timeout: 15_000 }).toBeGreaterThan((newest(seams)?.replayed.at(-1) ?? 0) + 3);
  await other.close();

  // The first client reloads while the shell keeps flooding.
  await page.goto('about:blank');
  const again = watchTerminalSockets(page);
  await openApp(page, daemon);
  await expect(activeName(page)).toHaveText(/^tick-\d+$/, { timeout: 10_000 });
  await expectLive(page, again);

  await typeInTerminal(page, '\u0003');
});
