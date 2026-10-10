// The busy-tabs benchmark (#82): one scenario per slice of #71, each run
// `knobs.runs` times against one daemon (TABSH_BIN, release build by
// default). Browser scenarios time real UI interactions in the daemon's own
// app page; daemon scenarios time real HTTP/WS calls from Node. Results go to
// bench/results/ (see README.md); `npm run bench:compare` diffs two of them.
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Daemon } from '../e2e/daemon.ts';
import { expect, openApp, setOnboarded, test } from '../e2e/fixture.ts';
import type { Metric } from './lib.ts';
import { Api, binPath, installProbe, knobs, Payloads, Samples, sleep, timedFlood, writeResults } from './lib.ts';

// Before the worker's daemon starts: the release binary unless TABSH_BIN says
// otherwise, and a plain login shell so the user's dotfiles don't time in.
process.env.TABSH_BIN = binPath();
process.env.SHELL = process.env.BENCH_SHELL ?? '/bin/sh';

const results: Record<string, Record<string, Metric>> = {};
const payloads = new Payloads();

test.describe.configure({ mode: 'serial' });
test.setTimeout(15 * 60_000);

test.afterAll(() => {
  payloads.cleanup();
  if (!Object.keys(results).length) return;
  const out = writeResults(results);
  console.log(`\nbench results → ${path.relative(process.cwd(), out)}`);
});

const tabs = (page: Page) => page.locator('#tabs .tab:not(.mirror)');

type Waited = { t: number | null; key: number; pointer: number };
const arm = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as Record<string, (...x: unknown[]) => void>)[f as string](...(a as unknown[])),
    [fn, args] as const,
  );
const wait = (page: Page, timeoutMs = 20_000) =>
  page.evaluate((ms) => (window as unknown as { __wait: (ms: number) => Promise<Waited> }).__wait(ms), timeoutMs);
const pageNow = (page: Page) => page.evaluate(() => performance.now());
const longtasks = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([a, b]) =>
      (
        window as unknown as { __longtasks: (a: number, b: number) => { total: number; max: number; frameGap: number } }
      ).__longtasks(a, b),
    [from, to] as const,
  );

// A fresh page on the daemon's app with the probe in place, every tab drawn
// and the active one attached.
async function freshPage(page: Page, daemon: Daemon, count: number): Promise<void> {
  await page.goto('about:blank');
  await openApp(page, daemon);
  await expect(tabs(page)).toHaveCount(count, { timeout: 15_000 });
  await expect(page.locator('.term.active')).toBeVisible();
}

// One keystroke in the active terminal: input event → its echo arrived and a
// frame was painted. Null if no echo came.
async function keystroke(page: Page, id: string, ch: string): Promise<number | null> {
  await arm(page, '__armEcho', id, ch);
  await page.keyboard.press(ch);
  const w = await wait(page, 5_000);
  return w.t === null ? null : w.t - w.key;
}

// Waits until typing in the active terminal echoes (its socket is up and the
// shell is at its prompt).
async function untilEchoes(page: Page, id: string): Promise<void> {
  await page.locator('.term.active').click();
  await expect(async () => {
    expect(await keystroke(page, id, 'z')).not.toBeNull();
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('Control+U');
}

// Clicks tab `i` and times pointerdown → that tab's socket replay arrived and
// a frame was painted after it.
async function switchTo(page: Page, i: number, id: string): Promise<number | null> {
  await arm(page, '__armReplay', id);
  await tabs(page).nth(i).click();
  const w = await wait(page);
  return w.t === null ? null : w.t - w.pointer;
}

// ---------------------------------------------------------------- slice 1

test('background flood: parked tabs print while the user types', async ({ page, daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  s.declare('unreadMs', 'ms', 'lower');
  await page.addInitScript(installProbe);
  for (let run = 0; run < knobs.runs; run++) {
    await api.clear();
    const active = await api.create('active');
    const quiet = await api.create('quiet');
    const busy: string[] = [];
    for (let i = 0; i < knobs.bgTabs; i++) busy.push(await api.create(`busy-${i}`));
    await freshPage(page, daemon, 2 + knobs.bgTabs);
    await untilEchoes(page, active);

    // Start every flood (each attach spawns its shell), then measure on the active tab.
    const t0 = await pageNow(page);
    await Promise.all(busy.map((id) => api.run(id, timedFlood(knobs.bgSeconds, payloads.file(knobs.floodChunk)))));
    const floodStart = await pageNow(page);
    await sleep(500);

    await page.locator('.term.active').click();
    const letters = 'abcdefghijklmnopqrstuvwxy';
    for (let k = 0; k < knobs.keystrokes; k++) {
      const ms = await keystroke(page, active, letters[k % letters.length]);
      if (ms !== null) s.add('keystrokeEchoMs', 'ms', 'lower', ms);
      else s.add('keystrokeMissed', 'count', 'lower', 1);
    }
    await page.keyboard.press('Control+U');

    // Away to the quiet tab and back, then into a flooding one and back.
    for (const ms of [await switchTo(page, 1, quiet), await switchTo(page, 0, active)])
      if (ms !== null) s.add('tabSwitchQuietMs', 'ms', 'lower', ms);
    const busyMs = await switchTo(page, 2, busy[0]);
    if (busyMs !== null) s.add('tabSwitchToBusyMs', 'ms', 'lower', busyMs);
    await switchTo(page, 0, active);
    const t1 = await pageNow(page);
    const lt = await longtasks(page, t0, t1);
    s.add('longTaskTotalMs', 'ms', 'lower', lt.total);
    s.add('longTaskMaxMs', 'ms', 'lower', lt.max);
    s.add('maxFrameGapMs', 'ms', 'lower', lt.frameGap);

    // Unread on a parked tab that never came on screen (busy-1…): wait out the flood.
    const watched = busy.slice(1).map((_, i) => `busy-${i + 1}`);
    const deadline = floodStart + knobs.bgSeconds * 1000 + 1000;
    let seen: number | null = null;
    while ((await pageNow(page)) < deadline && seen === null) {
      const u = await page.evaluate(() => (window as unknown as { __unread: Record<string, number> }).__unread);
      const times = watched.map((n) => u[n]).filter((v) => v !== undefined);
      if (times.length) seen = Math.min(...times) - floodStart;
      else await sleep(100);
    }
    if (seen !== null) s.add('unreadMs', 'ms', 'lower', seen);
    s.add('unreadSeen', 'ratio', 'higher', seen === null ? 0 : 1);
  }
  results['background-flood'] = s.summary();
});

// ---------------------------------------------------------------- slice 2

test('active flood: a burst on the visible tab', async ({ page, daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  await setOnboarded(page, daemon, true); // the board shows its columns
  await page.addInitScript(installProbe);
  for (let run = 0; run < knobs.runs; run++) {
    await api.clear();
    const a = await api.create(); // unnamed: the burst's closing title renames it
    const b = await api.create('other');
    await freshPage(page, daemon, 2);
    await untilEchoes(page, a);

    const burst = async (mark: string) => {
      await page.locator('.term.active').click();
      await page.keyboard.type(`cat '${payloads.file(knobs.burstBytes)}'; printf '\\033]0;${mark}\\007'`);
      await page.keyboard.press('Enter');
      const start = await page.evaluate(() => (window as unknown as { __bench: { lastKey: number } }).__bench.lastKey);
      await sleep(knobs.burstDelayMs);
      return start;
    };

    // Board open during the burst, then the burst's end on screen.
    const mark1 = `done-${run}-a`;
    const start1 = await burst(mark1);
    await arm(page, '__armFrame', '#board');
    await page.locator('#board-btn').click();
    const open = await wait(page);
    if (open.t !== null) s.add('boardOpenMs', 'ms', 'lower', open.t - open.pointer);
    await page.locator('#board-btn').click(); // back to the tabs (the burst's tab stayed on, in the drawer)
    await arm(page, '__armFrame', '#tabs', mark1);
    const done = await wait(page, 60_000);
    if (done.t !== null) s.add('contentCompleteMs', 'ms', 'lower', done.t - start1);
    const lt1 = await longtasks(page, start1, done.t ?? (await pageNow(page)));

    // Tab switch during a second burst; back again, the burst's end replays.
    const mark2 = `done-${run}-b`;
    const start2 = await burst(mark2);
    const sw = await switchTo(page, 1, b);
    if (sw !== null) s.add('tabSwitchMs', 'ms', 'lower', sw);
    await tabs(page).nth(0).click();
    await arm(page, '__armFrame', '#tabs', mark2);
    const done2 = await wait(page, 60_000);
    const lt2 = await longtasks(page, start2, done2.t ?? (await pageNow(page)));
    s.add('longTaskTotalMs', 'ms', 'lower', lt1.total, lt2.total);
    s.add('longTaskMaxMs', 'ms', 'lower', lt1.max, lt2.max);
    s.add('maxFrameGapMs', 'ms', 'lower', lt1.frameGap, lt2.frameGap);
  }
  results['active-flood'] = s.summary();
});

// ---------------------------------------------------------------- slice 3

test('flush contention: status and list while sessions keep scrollback dirty', async ({ daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  for (let run = 0; run < knobs.runs; run++) {
    await api.clear();
    const ids: string[] = [];
    for (let i = 0; i < knobs.flushSessions; i++) ids.push(await api.create(`dirty-${i}`));
    const target = await api.create('target');
    await Promise.all(
      ids.map((id) => api.run(id, timedFlood(knobs.flushSeconds + 1, payloads.file(knobs.floodChunk)))),
    );
    await sleep(1000); // scrollback full (512KB each) and dirty

    // Back-to-back requests across several 2s flush windows.
    const end = performance.now() + knobs.flushSeconds * 1000;
    const statuses = ['in_progress', 'needs_input'];
    let i = 0;
    while (performance.now() < end) {
      s.add(
        'patchStatusMs',
        'ms',
        'lower',
        await api.timed('PATCH', `/api/sessions/${target}/status`, { status: statuses[i++ % 2], source: 'user' }),
      );
      s.add('listSessionsMs', 'ms', 'lower', await api.timed('GET', '/api/sessions'));
      await sleep(20);
    }
  }
  results['flush-contention'] = s.summary();
});

// ---------------------------------------------------------------- slice 4

test('attach under load: reattach while a producer prints', async ({ daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  const { existsSync, rmSync } = await import('node:fs');
  const payload = payloads.file(knobs.attachBytes);
  const mb = payloads.size(payload) / 1e6;
  const dir = payloads.dir;
  try {
    for (let run = 0; run < knobs.runs; run++) {
      await api.clear();
      const id = await api.create('producer');
      await api.run(id, ': ready'); // spawn the shell first, so its start isn't timed

      // Prints attachBytes and touches `flag`; resolves with the elapsed seconds.
      const produce = async (flag: string, during?: () => Promise<void>) => {
        const file = path.join(dir, `${flag}-${run}`);
        const t0 = await api.run(id, `cat '${payload}'; touch '${file}'`);
        let busy = true;
        const side = during
          ? (async () => {
              while (busy) await during();
            })()
          : Promise.resolve();
        const deadline = performance.now() + 120_000;
        while (!existsSync(file)) {
          if (performance.now() > deadline) throw new Error(`producer did not finish (${flag})`);
          await sleep(10);
        }
        busy = false;
        await side;
        return (performance.now() - t0) / 1000;
      };

      const quiet = await produce('quiet');
      s.add('throughputQuietMBps', 'MB/s', 'higher', mb / quiet);
      const loaded = await produce('loaded', async () => {
        const a = api.attach(id);
        const t = await a.replay;
        s.add('daemonAttachReplayMs', 'ms', 'lower', t - a.opened);
        a.close();
        await sleep(10);
      });
      s.add('throughputUnderAttachMBps', 'MB/s', 'higher', mb / loaded);
      s.add('throughputRatio', 'ratio', 'higher', quiet / loaded);
    }
  } finally {
    for (let run = 0; run < knobs.runs; run++)
      for (const f of ['quiet', 'loaded']) rmSync(path.join(dir, `${f}-${run}`), { force: true });
  }
  results['attach-under-load'] = { ...results['attach-under-load'], ...s.summary() };
});

// Where an attach costs in the shipped build: the page. Switching onto a tab
// whose shell floods reattaches it (parked tabs hold no socket), and xterm
// parses the whole replay on the main thread, live output on top.
test('attach under load (page): switch onto a flooding tab', async ({ page, daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  await page.addInitScript(installProbe);
  type Sock = { opened: number; first: number; parsed: number; closed: number };
  const sockets = (id: string) =>
    page.evaluate((x) => (window as unknown as { __sockets: (id: string) => Sock[] }).__sockets(x), id);
  const floodSeconds = Math.ceil((knobs.attachSwitches * (knobs.attachStayMs + 1500)) / 1000) + 2;
  for (let run = 0; run < knobs.runs; run++) {
    await api.clear();
    const quiet = await api.create('quiet');
    const busy = await api.create('busy');
    await freshPage(page, daemon, 2);
    await untilEchoes(page, quiet);
    await api.run(busy, timedFlood(floodSeconds, payloads.file(knobs.floodChunk)));
    await sleep(500); // its scrollback is full

    let reconnects = 0;
    for (let i = 0; i < knobs.attachSwitches; i++) {
      const before = (await sockets(busy)).length;
      const click = await switchTo(page, 1, busy);
      if (click !== null) s.add('pageTabSwitchMs', 'ms', 'lower', click);
      // Stay on it while it floods: a socket the daemon drops (Lagged) is
      // replaced by the page, with a full replay.
      await sleep(knobs.attachStayMs);
      const mine = (await sockets(busy)).slice(before);
      const first = mine[0];
      if (first && first.parsed >= 0) {
        s.add('pageReplayParsedMs', 'ms', 'lower', first.parsed - first.opened);
        const lt = await longtasks(page, first.opened, first.parsed);
        s.add('pageReplayLongTaskMs', 'ms', 'lower', lt.total);
      } else s.add('pageReplayNotParsed', 'count', 'lower', 1);
      reconnects += Math.max(0, mine.length - 1);
      const stay = await longtasks(page, first?.opened ?? 0, await pageNow(page));
      s.add('pageStayLongTaskMs', 'ms', 'lower', stay.total);
      s.add('pageStayMaxFrameGapMs', 'ms', 'lower', stay.frameGap);
      await switchTo(page, 0, quiet);
    }
    s.add('pageReconnects', 'count', 'lower', reconnects);
  }
  results['attach-under-load'] = { ...results['attach-under-load'], ...s.summary() };
});

// ---------------------------------------------------------------- slice 5

test('spawn burst: open several tabs back-to-back', async ({ daemon }) => {
  const api = new Api(daemon);
  const s = new Samples();
  for (let run = 0; run < knobs.runs; run++) {
    await api.clear();
    await api.timed('GET', '/api/settings'); // warm the connection pool

    // Settings round-trips back to back, counted only while the burst runs.
    let bursting = true;
    let t0 = Number.POSITIVE_INFINITY;
    const poller = (async () => {
      while (bursting) {
        const start = performance.now();
        const ms = await api.timed('GET', '/api/settings');
        if (start >= t0 && bursting) s.add('settingsMs', 'ms', 'lower', ms);
        await sleep(5);
      }
    })();
    await sleep(100);

    // Each tab as the page opens one: create, attach (spawns), type, see the output.
    t0 = performance.now();
    const usable = await Promise.all(
      Array.from({ length: knobs.spawnTabs }, async (_, i) => {
        const id = await api.create(`spawn-${i}`);
        const a = api.attach(id);
        await a.replay;
        a.send(`printf 'R%sY\\n' ${i}\r`);
        const t = await a.until(`R${i}Y`, 30_000);
        a.close();
        return t - t0;
      }),
    );
    bursting = false;
    await poller;
    s.add('tabUsableMs', 'ms', 'lower', ...usable);
    s.add('allTabsUsableMs', 'ms', 'lower', Math.max(...usable));
  }
  results['spawn-burst'] = s.summary();
});
