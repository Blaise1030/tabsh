// Shared pieces of the busy-tabs benchmark: knobs read from the environment,
// stats, the result file, the daemon's HTTP/WS API driven from Node, and the
// in-page probe. See web/bench/README.md.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Daemon } from '../e2e/daemon.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- knobs

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}=${v} is not a number`);
  return n;
}

// Every size is an env var so a run can be made heavier or lighter; the
// defaults keep a full run to a few minutes on a laptop.
export const knobs = {
  runs: num('BENCH_RUNS', 5),
  // Background flood (slice 1): parked tabs printing while the user works.
  bgTabs: num('BENCH_BG_TABS', 4),
  bgSeconds: num('BENCH_BG_SECONDS', 6),
  floodChunk: num('BENCH_FLOOD_CHUNK', 65536),
  keystrokes: num('BENCH_KEYSTROKES', 20),
  // Active flood (slice 2): one burst on the visible tab.
  burstBytes: num('BENCH_BURST_BYTES', 2_000_000),
  burstDelayMs: num('BENCH_BURST_DELAY_MS', 300),
  // Flush contention (slice 3): K sessions keep big scrollback dirty.
  flushSessions: num('BENCH_FLUSH_SESSIONS', 6),
  flushSeconds: num('BENCH_FLUSH_SECONDS', 7),
  // Attach under load (slice 4): bytes the producer prints per phase.
  attachBytes: num('BENCH_ATTACH_BYTES', 64_000_000),
  // Spawn burst (slice 5): tabs opened at once.
  spawnTabs: num('BENCH_SPAWN_TABS', 8),
};

// ---------------------------------------------------------------- stats

export type Better = 'lower' | 'higher';

export interface Metric {
  unit: string;
  better: Better;
  n: number;
  median: number | null;
  p95: number | null;
  max: number | null;
  samples: number[];
}

// Nearest-rank percentile of sorted values.
function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export function summarize(unit: string, better: Better, samples: number[]): Metric {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    unit,
    better,
    n: sorted.length,
    median: round(pct(sorted, 50)),
    p95: round(pct(sorted, 95)),
    max: round(sorted.length ? sorted[sorted.length - 1] : null),
    samples: samples.map((s) => round(s) as number),
  };
}

// Samples collected by a scenario across its runs, keyed by metric name.
export class Samples {
  private data = new Map<string, { unit: string; better: Better; values: number[] }>();
  add(name: string, unit: string, better: Better, ...values: number[]): void {
    const m = this.data.get(name) ?? { unit, better, values: [] };
    m.values.push(...values.filter((v) => Number.isFinite(v)));
    this.data.set(name, m);
  }
  // A metric that may have no samples at all (e.g. "unread never appeared").
  declare(name: string, unit: string, better: Better): void {
    if (!this.data.has(name)) this.data.set(name, { unit, better, values: [] });
  }
  summary(): Record<string, Metric> {
    const out: Record<string, Metric> = {};
    for (const [k, m] of this.data) out[k] = summarize(m.unit, m.better, m.values);
    return out;
  }
}

// ---------------------------------------------------------------- results

export interface Results {
  meta: {
    label: string;
    date: string;
    bin: string;
    binSha256: string;
    benchCommit: string;
    host: string;
    // 1/5/15-minute load averages when the run ended: a busy machine skews numbers.
    loadavg: number[];
    knobs: typeof knobs;
  };
  scenarios: Record<string, Record<string, Metric>>;
}

export const binPath = (): string =>
  path.resolve(process.env.TABSH_BIN ?? path.join(here, '../../target/release/tabsh'));

function sha256(file: string): string {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
  } catch {
    return 'unknown';
  }
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function writeResults(scenarios: Results['scenarios']): string {
  const label = process.env.BENCH_LABEL ?? path.basename(path.dirname(path.dirname(path.dirname(binPath()))));
  const results: Results = {
    meta: {
      label,
      date: new Date().toISOString(),
      bin: binPath(),
      binSha256: sha256(binPath()),
      benchCommit: commit(),
      host: `${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length}x ${os.cpus()[0]?.model ?? '?'}`,
      loadavg: os.loadavg().map((l) => Math.round(l * 10) / 10),
      knobs,
    },
    scenarios,
  };
  const dir = path.join(here, 'results');
  const out = path.resolve(process.env.BENCH_OUT ?? path.join(dir, `${label}-${Date.now()}.json`));
  mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(results, null, 2) + '\n';
  writeFileSync(out, json);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'latest.json'), json);
  return out;
}

// ---------------------------------------------------------------- daemon API from Node

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Api {
  constructor(readonly d: Daemon) {}
  private headers = () => ({ Authorization: `Bearer ${this.d.token}`, 'content-type': 'application/json' });

  async req(method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const res = await fetch(this.d.baseUrl + url, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  // Wall time of one request, body read included.
  async timed(method: string, url: string, body?: unknown): Promise<number> {
    const t0 = performance.now();
    const { status } = await this.req(method, url, body);
    const ms = performance.now() - t0;
    if (status >= 400) throw new Error(`${method} ${url} → ${status}`);
    return ms;
  }

  async create(name?: string): Promise<string> {
    const { json } = await this.req('POST', '/api/sessions', name ? { name } : {});
    return (json as { id: string }).id;
  }

  async list(): Promise<{ id: string; name: string }[]> {
    return (await this.req('GET', '/api/sessions')).json as { id: string; name: string }[];
  }

  // Kills every shell and waits until the list is empty, so each run starts clean.
  async clear(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const all = await this.list();
      if (!all.length) return;
      for (const s of all) await this.req('DELETE', `/api/sessions/${s.id}`);
      await sleep(100);
    }
    throw new Error('sessions did not go away');
  }

  socketUrl(id: string): string {
    return `${this.d.baseUrl.replace(/^http/, 'ws')}/ws?id=${id}&token=${this.d.token}`;
  }

  // A terminal socket like the page's: Origin is the daemon's own page.
  attach(id: string): Attached {
    return new Attached(this.socketUrl(id), this.d.baseUrl);
  }

  // Attach (spawning the shell if needed), wait for its prompt, type `line`,
  // and detach: the shell keeps running it with nobody attached. Resolves
  // with the time (performance.now) the line was sent.
  async run(id: string, line: string): Promise<number> {
    const a = this.attach(id);
    await a.replay;
    await a.quiet(150, 5_000);
    a.send(line + '\r');
    const sent = performance.now();
    await sleep(50);
    a.close();
    return sent;
  }
}

const enc = new TextEncoder();

// One socket to a session, from Node.
export class Attached {
  readonly opened = performance.now();
  readonly ws: WebSocket;
  // Resolves with the time (performance.now) the first binary message — the
  // scrollback replay — arrived.
  readonly replay: Promise<number>;
  private text = '';
  private lastData = performance.now();
  private listeners: (() => void)[] = [];

  constructor(url: string, origin: string) {
    // Node's WebSocket (undici) takes headers; the daemon wants an Origin.
    const Ws = WebSocket as unknown as new (u: string, o: unknown) => WebSocket;
    this.ws = new Ws(url, { headers: { Origin: origin } });
    this.ws.binaryType = 'arraybuffer';
    this.replay = new Promise((resolve, reject) => {
      let first = true;
      this.ws.onerror = () => reject(new Error(`socket ${url} failed`));
      this.ws.onclose = () => first && reject(new Error(`socket ${url} closed before replay`));
      this.ws.onmessage = (e) => {
        if (typeof e.data === 'string') return;
        const now = performance.now();
        this.lastData = now;
        if (first) {
          first = false;
          resolve(now);
          return; // the replay: not live output
        }
        this.text = (this.text + Buffer.from(e.data as ArrayBuffer).toString('latin1')).slice(-4096);
        for (const l of this.listeners) l();
      };
    });
    this.replay.catch(() => {});
  }

  send(s: string): void {
    this.ws.send(enc.encode(s));
  }

  // Resolves once live output contains `needle` (time it arrived).
  until(needle: string, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.text.includes(needle)) {
          this.listeners = this.listeners.filter((l) => l !== check);
          clearTimeout(t);
          resolve(performance.now());
        }
      };
      const t = setTimeout(() => reject(new Error(`no ${JSON.stringify(needle)} within ${timeoutMs}ms`)), timeoutMs);
      this.listeners.push(check);
      check();
    });
  }

  // Waits until no output has arrived for `ms` (e.g. the prompt has settled).
  async quiet(ms: number, timeoutMs: number): Promise<void> {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      if (performance.now() - this.lastData >= ms) return;
      await sleep(20);
    }
  }

  close(): void {
    this.ws.onclose = null;
    this.ws.close();
  }
}

// ---------------------------------------------------------------- shell loads

// Output is `cat` of a prepared file of base64 lines (160 columns), so the
// producer costs next to nothing and the daemon / page are what is timed
// (`head | base64 | fold` is itself slower than the PTY on macOS).
export class Payloads {
  readonly dir = mkdtempSync(path.join(os.tmpdir(), 'tabsh-bench-'));
  private made = new Map<number, string>();

  // A file of about `bytes` bytes of printable text; its exact size is `size(file)`.
  file(bytes: number): string {
    const known = this.made.get(bytes);
    if (known) return known;
    const file = path.join(this.dir, `payload-${bytes}.txt`);
    const text = randomBytes(Math.ceil((bytes * 3) / 4)).toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += 160) lines.push(text.slice(i, i + 160));
    writeFileSync(file, lines.join('\n') + '\n');
    this.made.set(bytes, file);
    return file;
  }

  size(file: string): number {
    return statSync(file).size;
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

// Prints `file` over and over for `seconds`, then rings the bell. Portable
// across sh/dash/bash/zsh: `date +%s`, not $SECONDS.
export const timedFlood = (seconds: number, file: string) =>
  `end=$(( $(date +%s) + ${seconds} )); while [ $(date +%s) -lt $end ]; do cat '${file}'; done; printf '\\a'`;

// ---------------------------------------------------------------- in-page probe

// Installed with page.addInitScript before the app loads. It records long
// tasks, the input event timestamps (which include queueing delay), and every
// terminal socket's messages, and lets the benchmark wait for "the echo
// arrived and a frame was painted after it".
export function installProbe(): void {
  type Waiter = { test: (sock: Sock, text: string | null) => boolean; resolve: (t: number) => void };
  type Sock = { id: string; opened: number; first: number; bytes: number };
  const w = window as unknown as Record<string, unknown>;
  const b = {
    longtasks: [] as { start: number; dur: number }[],
    frames: [] as number[],
    sockets: [] as Sock[],
    lastKey: 0,
    lastPointer: 0,
    waiters: [] as Waiter[],
    pending: null as Promise<number> | null,
  };
  w.__bench = b;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) b.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // Every frame's time: a long gap between two is a frame the page dropped.
  const frame = (t: number) => {
    b.frames.push(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('keydown', (e) => (b.lastKey = e.timeStamp), true);
  addEventListener('pointerdown', (e) => (b.lastPointer = e.timeStamp), true);

  // A frame painted after `t`: the rAF callback after the handler ran.
  const painted = (resolve: (t: number) => void) => requestAnimationFrame(() => resolve(performance.now()));

  const Native = WebSocket;
  const latin1 = new TextDecoder('latin1');
  class Probe extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const sock: Sock = {
        id: new URL(String(url)).searchParams.get('id') ?? '',
        opened: performance.now(),
        first: -1,
        bytes: 0,
      };
      b.sockets.push(sock);
      this.addEventListener('message', (e: MessageEvent) => {
        if (typeof e.data === 'string') return;
        const now = performance.now();
        const data = e.data as ArrayBuffer;
        const isFirst = sock.first < 0;
        if (isFirst) sock.first = now;
        sock.bytes += data.byteLength;
        if (!b.waiters.length) return;
        const text = isFirst ? null : latin1.decode(data);
        b.waiters = b.waiters.filter((wt) => {
          if (!wt.test(sock, text)) return true;
          painted(wt.resolve);
          return false;
        });
      });
    }
  }
  w.WebSocket = Probe;

  // Arm: live output on `id`'s socket containing `needle`.
  w.__armEcho = (id: string, needle: string) => {
    b.pending = new Promise((resolve) =>
      b.waiters.push({ test: (s, text) => s.id === id && text !== null && text.includes(needle), resolve }),
    );
  };
  // Arm: the replay (first message) of a socket for `id` opened from now on.
  w.__armReplay = (id: string) => {
    const since = performance.now();
    b.pending = new Promise((resolve) =>
      b.waiters.push({ test: (s, text) => s.id === id && text === null && s.opened >= since, resolve }),
    );
  };
  // Arm: the first frame where `selector` is visible (and, given `needle`,
  // its text contains it). Polled every frame; no eval, the page has a CSP.
  w.__armFrame = (selector: string, needle?: string) => {
    const check = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el?.checkVisibility()) return false;
      return needle === undefined || (el.textContent ?? '').includes(needle);
    };
    b.pending = new Promise((resolve) => {
      const tick = () => (check() ? resolve(performance.now()) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  };
  w.__wait = (timeoutMs: number) =>
    Promise.race([b.pending, new Promise((r) => setTimeout(() => r(null), timeoutMs))]).then((t) => ({
      t,
      key: b.lastKey,
      pointer: b.lastPointer,
    }));
  // Long tasks that started in [from, to]: total and longest, in ms; and the
  // longest gap between frames in that window.
  w.__longtasks = (from: number, to: number) => {
    const ts = b.longtasks.filter((l) => l.start >= from && l.start <= to);
    const fs = b.frames.filter((f) => f >= from && f <= to);
    let gap = 0;
    for (let i = 1; i < fs.length; i++) gap = Math.max(gap, fs[i] - fs[i - 1]);
    return {
      total: ts.reduce((a, l) => a + l.dur, 0),
      max: ts.reduce((a, l) => Math.max(a, l.dur), 0),
      frameGap: gap,
    };
  };
  // First time each tab (by title) showed `unread`, in page time.
  const unread: Record<string, number> = {};
  w.__unread = unread;
  new MutationObserver((muts) => {
    for (const m of muts) {
      const el = m.target as HTMLElement;
      if (el.classList?.contains('tab') && el.classList.contains('unread')) {
        const name = el.getAttribute('title') ?? '';
        if (!(name in unread)) unread[name] = performance.now();
      }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
