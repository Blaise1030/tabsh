// A pretend daemon for /demo/, the copy of the app framed on the landing
// page. It answers the app's requests and sockets from memory, so the demo is
// the real app, never a drawing of it. It swaps in fetch, WebSocket and
// localStorage, then starts the app (a dynamic import, so that runs after).
//
// Nothing here reaches a real daemon: the page's meta tag names DEMO, only
// DEMO is answered, any other request to a daemon is refused, browser
// storage is replaced so no pairing token (or the real app's tabs) is ever
// read, and /demo/'s CSP blocks every connection but its own origin.
import { DEMO } from './origin.ts';

const WS_DEMO = DEMO.replace(/^http/, 'ws');

// ---- storage: in memory, so the demo neither reads nor overwrites the app's.
const mem = new Map<string, string>();
const storage: Storage = {
  get length() {
    return mem.size;
  },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });

// ---- notifications: the app asks for permission on the first click, which
// framed would ask the visitor on the landing page's behalf. The demo has none.
Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });

// ---- focus: the app focuses its terminal on startup, which in a frame would
// take the keyboard from the landing page. Nothing takes focus until the
// visitor clicks or taps into the demo.
const focus = HTMLElement.prototype.focus;
let touched = false;
HTMLElement.prototype.focus = function (this: HTMLElement, opts?: FocusOptions) {
  if (touched) focus.call(this, opts);
};
addEventListener('pointerdown', () => (touched = true), { capture: true, once: true });

// ---- scrolling: framed, a vertical wheel or finger drag scrolls the landing
// page, not the terminal's scrollback, so the demo never traps the reader.
// Sideways scrolling (the tab strip, the board's columns) stays the app's.
if (window.parent !== window) {
  // The app scrolls its active tab into view, which would scroll the landing
  // page to the frame too. Framed, it scrolls only the tab's own container.
  Element.prototype.scrollIntoView = function (this: Element) {
    for (let box = this.parentElement; box; box = box.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(box);
      if (!/auto|scroll/.test(overflowX + overflowY)) continue;
      const r = this.getBoundingClientRect();
      const c = box.getBoundingClientRect();
      if (r.left < c.left) box.scrollLeft -= c.left - r.left;
      else if (r.right > c.right) box.scrollLeft += r.right - c.right;
      if (r.top < c.top) box.scrollTop -= c.top - r.top;
      else if (r.bottom > c.bottom) box.scrollTop += r.bottom - c.bottom;
      return;
    }
  };

  const LINE = 16;
  const scrollPage = (y: number) => window.parent.scrollBy({ top: y, behavior: 'instant' });
  addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      scrollPage(e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? window.parent.innerHeight : 1));
    },
    { capture: true, passive: false },
  );
  // A drag is the page's once its first move is more down than across.
  let start: { x: number; y: number } | null = null;
  let vertical: boolean | null = null;
  addEventListener(
    'touchstart',
    (e) => {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      vertical = null;
    },
    { capture: true, passive: true },
  );
  addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const { clientX: x, clientY: y } = e.touches[0];
      vertical ??= Math.abs(y - start.y) > Math.abs(x - start.x);
      if (!vertical) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      scrollPage(start.y - y);
      start = { x, y };
    },
    { capture: true, passive: false },
  );
}

// ---- the scripted workspace ------------------------------------------------
const HOME = '/Users/you';
const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const dim = esc('2');
const bold = esc('1');
const green = esc('32');
const red = esc('31');
const cyan = esc('36');
const orange = esc('38;5;208');
const lines = (...l: string[]) => `${l.join('\r\n')}\r\n`;
const promptIn = (dir: string) => `${dim(`${dir.replace(HOME, '~')} ❯`)} `;

interface Info {
  id: string;
  name: string;
  status: string;
  status_at: number;
  note: string | null;
  cwd: string | null;
  pinned: boolean;
  agent_command?: string | null;
  pending_prompt?: string | null;
  pending_command?: string | null;
  mode: 'tui' | 'ui';
  acp_command?: string | null;
}
interface Shell {
  info: Info;
  // What a new socket replays: everything written so far.
  output: string;
  input: string;
  prompt: string;
  // Answers a typed line; null for the default.
  reply?: (cmd: string) => string | null;
  socket: FakeSocket | null;
}

const now = () => Math.floor(Date.now() / 1000);
let nextId = 1;
const shells: Shell[] = [];

function addShell(name: string, cwd: string, status: string, output: string, extra: Partial<Shell> = {}): Shell {
  const prompt = promptIn(cwd);
  const sh: Shell = {
    info: {
      id: `demo-${nextId++}`,
      name,
      status,
      status_at: now() - 60 * nextId,
      note: null,
      cwd,
      pinned: true,
      mode: 'tui',
    },
    output: output + prompt,
    input: '',
    prompt,
    socket: null,
    ...extra,
  };
  shells.push(sh);
  return sh;
}

const SHOP = `${HOME}/code/shop`;
const API = `${HOME}/code/api`;
addShell(
  'shop: npm run dev',
  SHOP,
  'in_progress',
  lines(
    `${promptIn(SHOP)}npm run dev`,
    '',
    `  ${bold(green('VITE'))} v6.0.3  ${dim('ready in')} 412 ms`,
    '',
    `  ${green('➜')}  Local:   http://localhost:5173/`,
    `  ${dim('➜  Network: use --host to expose')}`,
    '',
    `${dim('12:04:51')} ${cyan('[vite]')} hmr update /src/Cart.tsx`,
  ),
);
addShell(
  'api: cargo test',
  API,
  'completed',
  lines(
    `${promptIn(API)}cargo test`,
    `   ${bold(green('Compiling'))} api v0.4.1 (~/code/api)`,
    `    ${bold(green('Finished'))} \`test\` profile [unoptimized + debuginfo] in 3.42s`,
    `     ${bold(green('Running'))} unittests src/lib.rs`,
    '',
    'running 48 tests',
    `test auth::login ... ${green('ok')}`,
    `test auth::refresh_token ... ${green('ok')}`,
    `test cart::add_item ... ${green('ok')}`,
    `test orders::refund ... ${green('ok')}`,
    '',
    `test result: ${green('ok')}. 48 passed; 0 failed; finished in 0.81s`,
    '',
  ),
);
const claude = addShell(
  'claude',
  SHOP,
  'needs_input',
  lines(
    `${orange('>')} review the refund path before I merge`,
    '',
    `${orange('⏺')} I'll trace the refund flow, check the order-status guard, and run the tests.`,
    '',
    `${orange('⏺')} ${bold('Read')}(src/refund.ts)`,
    `  ${dim('⎿')}  Read 12 lines`,
    '',
    `${orange('⏺')} ${bold('Read')}(src/orders.rs)`,
    `  ${dim('⎿')}  Read 18 lines`,
    '',
    `${orange('⏺')} ${bold('Read')}(src/refund.test.ts)`,
    `  ${dim('⎿')}  Read 41 lines`,
    '',
    `${orange('⏺')} The refund path now checks the order status first.`,
    `  ${dim('⎿')}  Updated src/refund.ts ${green('(+12)')} ${red('(−4)')}`,
    `  ${dim('⎿')}  Updated src/orders.rs ${green('(+6)')}`,
    `  ${dim('⎿')}  Added src/refund.test.ts ${green('(+18)')}`,
    '',
    `${orange('⏺')} ${bold('Bash')}(cargo test)`,
    `  ${dim('⎿')}  ${green('42 passed')} in 0.81s`,
    '',
    `${orange('⏺')} The fix is idempotent: an already-refunded order returns the original`,
    '  refund instead of issuing a second one. The diff is limited to the refund path.',
    '',
    `Run the tests before I commit? ${dim('(y/n)')}`,
    `  ${dim('⏵⏵ accept edits on (shift+tab to cycle)')}   ${dim('Claude Sonnet 4.5')}`,
  ),
  {
    prompt: orange('> '),
    reply: (cmd) => {
      if (!/^y(es)?$/i.test(cmd))
        return /^n(o)?$/i.test(cmd) ? lines(`${orange('⏺')} Okay, leaving it uncommitted.`) : null;
      setTimeout(() => hook(claude, 'completed', 'Committed a1c9e04'), 600);
      return lines(
        `${orange('⏺')} ${bold('Bash')}(cargo test)`,
        `  ${dim('⎿')}  ${green('42 passed')} in 0.81s`,
        `${orange('⏺')} Committed as ${dim('a1c9e04')}.`,
      );
    },
  },
);
claude.output = claude.output.replace(/[^\n]*$/, claude.prompt);
claude.info.note = 'Run the tests before I commit?';
// Open on claude's tab, the one asking for you (sessions/store.ts's key).
storage.setItem('tabsh.active', claude.info.id);
claude.info.agent_command = 'claude';

// ---- the board's figure ----------------------------------------------------
// Framed at ?view=board (fig. 2), the demo is a fuller board: a card per agent,
// two waiting in Backlog, tags, and two cards that move on their own once the
// frame is in view, as their hooks would move them.
const tags: Record<string, string[]> = {};
// The UI-mode card the screenshots open: its drawer shows the chat panel.
let uiCardId: string | null = null;
if (new URLSearchParams(location.search).get('view') === 'board') {
  claude.info.name = 'Fix refund status · #142';
  tags[claude.info.id] = ['bug'];
  const card = (
    name: string,
    cwd: string,
    status: string,
    agent: string,
    tagged: string[],
    info: Partial<Info> = {},
  ) => {
    const sh = addShell(name, cwd, status, '');
    sh.info = { ...sh.info, agent_command: agent, ...info };
    tags[sh.info.id] = tagged;
    return sh;
  };
  const backlog = (name: string, cwd: string, agent: string, tagged: string[]) =>
    card(name, cwd, 'backlog', agent, tagged, { pending_prompt: name, pending_command: `${agent} {prompt}` });
  backlog('Add dark mode to checkout', SHOP, 'claude', ['ui']);
  backlog('Paginate order history', API, 'codex', ['api']);
  const deps = card('Bump Vite to 7', SHOP, 'in_progress', 'gemini', ['chore']);
  const limit = card('Rate-limit login', API, 'in_progress', 'opencode', ['api']);
  card('Cache product images', SHOP, 'completed', 'codex', ['perf'], { note: 'Opened PR #139' });
  const review = card('Review the auth flow', SHOP, 'needs_input', 'claude', ['review'], {
    mode: 'ui',
    acp_command: 'npx --yes @agentclientprotocol/claude-agent-acp',
    note: 'Two files changed',
  });
  uiCardId = review.info.id;
  // Moved once, a few seconds after the board first shows.
  let moved = false;
  new IntersectionObserver((seen) => {
    if (moved || !seen.some((e) => e.isIntersecting)) return;
    moved = true;
    setTimeout(() => hook(deps, 'needs_input', 'Vite 7 drops Node 18. Bump CI too?'), 2500);
    setTimeout(() => hook(limit, 'completed', 'Opened PR #148'), 6000);
  }).observe(document.documentElement);
}
storage.setItem('tabsh.tags', JSON.stringify(tags));

// Each project's files, for the explorer and the file pane.
const FILES: Record<string, Record<string, string>> = {
  [SHOP]: {
    'README.md': '# shop\n\nThe storefront. `npm run dev` serves it on localhost:5173.\n',
    'package.json': '{\n  "name": "shop",\n  "scripts": { "dev": "vite", "build": "vite build" }\n}\n',
    'src/Cart.tsx':
      'export function Cart({ items }: { items: Item[] }) {\n  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);\n  return <aside className="cart">Total: {format(total)}</aside>;\n}\n',
    'src/refund.ts':
      "export async function refund(order: Order) {\n  if (order.status !== 'paid') throw new Error('only a paid order can be refunded');\n  return payments.refund(order.paymentId, order.total);\n}\n",
    'src/main.tsx':
      "import { createRoot } from 'react-dom/client';\nimport { App } from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  },
  [API]: {
    'Cargo.toml': '[package]\nname = "api"\nversion = "0.4.1"\nedition = "2024"\n',
    'src/lib.rs': 'pub mod auth;\npub mod cart;\npub mod orders;\n',
    'src/orders.rs':
      'pub fn refund(order: &Order) -> Result<Refund> {\n    ensure!(order.is_paid(), "not paid");\n    Ok(Refund::of(order))\n}\n',
  },
};
const rootOf = (sh: Shell | undefined) => (sh?.info.cwd && FILES[sh.info.cwd] ? sh.info.cwd : SHOP);
function listing(root: string): string[] {
  const out = new Set<string>();
  for (const f of Object.keys(FILES[root] ?? {})) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) out.add(`${parts.slice(0, i).join('/')}/`);
    out.add(f);
  }
  return [...out].sort();
}
function fileAt(sh: Shell | undefined, path: string): { abs: string; content: string } | null {
  const root = rootOf(sh);
  const abs = path.startsWith('/') ? path : `${root}/${path.replace(/^\.\//, '')}`;
  for (const [r, files] of Object.entries(FILES)) {
    const rel = abs.startsWith(`${r}/`) ? abs.slice(r.length + 1) : null;
    if (rel !== null && rel in files) return { abs, content: files[rel] };
  }
  return null;
}

// ---- the terminal ----------------------------------------------------------
const started = Date.now();
const enc = new TextEncoder();
const dec = new TextDecoder();

function run(sh: Shell, cmd: string): string {
  const custom = cmd && sh.reply?.(cmd);
  if (custom) return custom;
  const [name, ...args] = cmd.split(/\s+/);
  const cwd = sh.info.cwd ?? HOME;
  switch (name) {
    case '':
      return '';
    case 'clear':
      return '\x1b[2J\x1b[3J\x1b[H';
    case 'pwd':
      return lines(cwd);
    case 'whoami':
      return lines('you');
    case 'echo':
      return lines(args.join(' '));
    case 'ls':
      return lines(
        [...new Set(listing(rootOf(sh)).map((p) => p.split('/')[0] + (p.includes('/') ? '/' : '')))].join('  '),
      );
    default:
      return lines(`${dim('demo: this shell can’t run')} ${name}${dim('. Install tabsh for a real one.')}`);
  }
}

// Escape sequences: arrow and function keys (ignored), and a cleared screen.
const ESC = '\x1b';
const KEYS = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]|${ESC}O.`, 'g');
const CLEARED = new RegExp(`[\\s\\S]*${ESC}\\[2J(${ESC}\\[3J)?${ESC}\\[H`);

// What a shell does with a keystroke: a tiny line editor.
function type(sh: Shell, data: string): void {
  let out = '';
  for (const ch of data.replace(KEYS, '')) {
    if (ch === '\r') {
      out += `\r\n${run(sh, sh.input.trim())}${sh.prompt}`;
      sh.input = '';
    } else if (ch === '\x7f') {
      if (sh.input) {
        sh.input = [...sh.input].slice(0, -1).join('');
        out += '\b \b';
      }
    } else if (ch === '\x03') {
      out += `^C\r\n${sh.prompt}`;
      sh.input = '';
    } else if (ch === '\x0c') {
      out += `\x1b[2J\x1b[H${sh.prompt}${sh.input}`;
    } else if (ch >= ' ' && sh.input.length < 200) {
      sh.input += ch;
      out += ch;
    }
  }
  if (!out) return;
  // Clearing the screen clears what a reload replays, too.
  sh.output = (sh.output + out).replace(CLEARED, '').slice(-50_000);
  sh.socket?.deliver(enc.encode(out).buffer);
}

// ---- WebSocket ---------------------------------------------------------------
const RealSocket = window.WebSocket;

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private shell: Shell | undefined;

  constructor(url: string) {
    super();
    this.url = url;
    const u = new URL(url);
    if (u.pathname === '/ws') this.shell = shells.find((s) => s.info.id === u.searchParams.get('id'));
    if (u.pathname === '/api/board/events') boardSockets.add(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      if (u.pathname === '/ws' && !this.shell) return this.close();
      this.readyState = 1;
      this.fire(new Event('open'));
      if (this.shell) {
        this.shell.socket?.close();
        this.shell.socket = this;
        // The replay comes first, as the daemon sends it.
        this.deliver(enc.encode(this.shell.output).buffer);
      }
    });
  }
  deliver(data: ArrayBuffer | string): void {
    setTimeout(() => this.readyState === 1 && this.fire(new MessageEvent('message', { data })));
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== 1 || !this.shell || typeof data === 'string') return; // strings are resizes
    type(this.shell, dec.decode(data as ArrayBuffer));
  }
  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    boardSockets.delete(this);
    if (this.shell?.socket === this) this.shell.socket = null;
    setTimeout(() => this.fire(new CloseEvent('close', { wasClean: true, code: 1000 })));
  }
  private fire(e: Event): void {
    const handler = (this as unknown as Record<string, unknown>)[`on${e.type}`];
    if (typeof handler === 'function') handler.call(this, e);
    this.dispatchEvent(e);
  }
}

window.WebSocket = new Proxy(RealSocket, {
  construct(target, [url, protocols]) {
    const href = String(url);
    if (href.startsWith(WS_DEMO)) return new FakeSocket(href);
    if (new URL(href).host !== location.host) throw new DOMException(`demo: no socket to ${href}`, 'SecurityError');
    return new target(href, protocols);
  },
  get: (target, key) => (key in FakeSocket ? FakeSocket[key as keyof typeof FakeSocket] : Reflect.get(target, key)),
});

// A hook reporting a card's new status, as `tabsh status` would.
const boardSockets = new Set<FakeSocket>();
function hook(sh: Shell, status: string, note: string): void {
  sh.info = { ...sh.info, status, status_at: now(), note };
  for (const ws of boardSockets)
    ws.deliver(JSON.stringify({ id: sh.info.id, status, status_at: sh.info.status_at, note, source: 'hook' }));
}

// ---- HTTP ------------------------------------------------------------------
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = (status: number) => new Response(null, { status });

// A UI card's chat. History is scripted, then each message appends a short
// assistant reply. Open streams receive the same chunks as SSE `data:` lines.
type ChatChunk = Record<string, unknown>;
const transcripts = new Map<string, ChatChunk[]>();
const chatFans = new Map<string, Set<(frame: Uint8Array) => void>>();

function scriptedChat(id: string): ChatChunk[] {
  let rows = transcripts.get(id);
  if (!rows) {
    rows =
      id === uiCardId
        ? [
            { type: 'user_text', session_id: id, text: 'Review the refund path before I merge.' },
            {
              type: 'text_delta',
              session_id: id,
              text: 'The refund path now checks the order status first. Two files changed: `src/refund.ts` and `src/orders.rs`.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'What happens if the order was already refunded?' },
            {
              type: 'tool_call',
              session_id: id,
              tool_call: { toolCallId: 'tc-refund', title: 'Read src/refund.ts', status: 'completed' },
            },
            {
              type: 'text_delta',
              session_id: id,
              text: 'It returns the original refund id instead of charging again. I added a regression test for the double-refund case.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Run the tests and check the diff.' },
            {
              type: 'tool_call',
              session_id: id,
              tool_call: { toolCallId: 'tc-test', title: 'shell: npm test', status: 'completed' },
            },
            {
              type: 'text_delta',
              session_id: id,
              text: 'All 42 tests pass. The diff is limited to `src/refund.ts`, `src/orders.rs` and `src/refund.test.ts`.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Log the refund id when we short-circuit.' },
            {
              type: 'tool_call',
              session_id: id,
              tool_call: { toolCallId: 'tc-log', title: 'Edit src/refund.ts', status: 'completed' },
            },
            {
              type: 'text_delta',
              session_id: id,
              text: 'Added the refund id to the existing info log. Nothing else changed.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Does the API return the same shape?' },
            {
              type: 'text_delta',
              session_id: id,
              text: 'Yes. The response still has `refund_id`, `status` and `amount`; the short-circuit path returns the original values.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Great. Summarize the change for the PR.' },
            {
              type: 'text_delta',
              session_id: id,
              text: 'Refunds are idempotent: an already-refunded order returns the original refund instead of issuing a second one. Tests cover the short-circuit path, and the refund id is logged.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Can you add a changelog entry?' },
            {
              type: 'tool_call',
              session_id: id,
              tool_call: { toolCallId: 'tc-changelog', title: 'Edit CHANGELOG.md', status: 'completed' },
            },
            {
              type: 'text_delta',
              session_id: id,
              text: 'Added a line under Fixed: refunds are now idempotent when the order was already refunded.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
            { type: 'user_text', session_id: id, text: 'Perfect. Anything else I should check?' },
            {
              type: 'text_delta',
              session_id: id,
              text: 'Only the migration note: no schema change, so nothing to run. The branch is ready for review.',
            },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
          ]
        : [
            { type: 'text_delta', session_id: id, text: 'This demo agent is ready.' },
            { type: 'turn_end', session_id: id, stop_reason: 'end_turn' },
          ];
    transcripts.set(id, rows);
  }
  return rows;
}

function sseFrame(chunk: ChatChunk): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

function pushChat(id: string, chunk: ChatChunk): void {
  scriptedChat(id).push(chunk);
  const frame = sseFrame(chunk);
  for (const send of chatFans.get(id) ?? []) send(frame);
}

function chatEvents(id: string): Response {
  let listener: ((frame: Uint8Array) => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const replay = [...scriptedChat(id)];
      const fans = chatFans.get(id) ?? new Set<(frame: Uint8Array) => void>();
      listener = (frame) => {
        try {
          controller.enqueue(frame);
        } catch {
          if (listener) fans.delete(listener);
        }
      };
      fans.add(listener);
      chatFans.set(id, fans);
      for (const chunk of replay) controller.enqueue(sseFrame(chunk));
    },
    cancel() {
      if (listener) chatFans.get(id)?.delete(listener);
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

function chatMessage(id: string, body: Record<string, unknown>): Response {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return empty(400);
  pushChat(id, { type: 'user_text', session_id: id, text });
  pushChat(id, { type: 'text_delta', session_id: id, text: `Demo reply: ${text.slice(0, 80)}` });
  pushChat(id, { type: 'turn_end', session_id: id, stop_reason: 'end_turn' });
  return empty(202);
}

const demoQuery = new URLSearchParams(location.search);
let settings: Record<string, unknown> = {
  boardOnboarded: true,
  welcomeSeen: true,
  ...(demoQuery.get('layout') === 'list' ? { boardLayout: 'list' } : {}),
};
const remote = {
  enabled: true,
  address: '100.101.102.103',
  port: 7681,
  host: null as string | null,
  error: null as string | null,
  devices: [
    { id: 'demo-device-1', name: 'iPhone', created: now() - 86400, last_seen: now() - 120 },
    { id: 'demo-device-2', name: 'MacBook Air', created: now() - 172800, last_seen: now() - 7200 },
  ],
};
const demoModels = {
  current: 'claude-sonnet',
  options: [
    { id: 'claude-sonnet', name: 'Claude Sonnet 4.5' },
    { id: 'claude-opus', name: 'Claude Opus 4.1' },
    { id: 'claude-haiku', name: 'Claude Haiku 4.5' },
  ],
};
const demoApprovals = new Map<string, boolean>();

async function answer(method: string, url: URL, body: unknown): Promise<Response> {
  const path = url.pathname;
  const q = url.searchParams;
  const shell = (id: string | null) => shells.find((s) => s.info.id === id);

  if (path === '/api/about')
    return json({
      version: 'demo',
      shell: '/bin/zsh',
      state_path: '~/.tabsh/tabsh.db',
      uptime_secs: Math.floor((Date.now() - started) / 1000) + 9240,
      sessions_running: shells.length,
      sessions_total: shells.length,
    });
  if (path === '/api/performance')
    return json({
      total: { memory_bytes: 180 * 1024 * 1024, cpu_percent: 6.2 },
      processes: [
        { name: 'tabsh', memory_bytes: 48 * 1024 * 1024, cpu_percent: 1.1 },
        { name: 'zsh', memory_bytes: 132 * 1024 * 1024, cpu_percent: 5.1 },
      ],
    });
  if (path === '/api/settings') {
    if (method === 'PUT') settings = body as Record<string, unknown>;
    return method === 'PUT' ? empty(204) : json(settings);
  }

  // The remote page's demo: sharing is on, with two paired devices.
  if (path === '/api/remote') {
    if (method === 'PUT') {
      const on = !!(body as { enabled?: boolean } | undefined)?.enabled;
      remote.enabled = on;
      return json(remote);
    }
    return json(remote);
  }
  if (path === '/api/remote/devices' && method === 'POST') {
    const name = (body as { name?: string } | undefined)?.name ?? 'Device';
    const device = { id: `demo-device-${remote.devices.length + 1}`, name, created: now(), last_seen: now() };
    remote.devices.push(device);
    return json({ ...device, url: `http://100.101.102.103:7681/#token=demo` });
  }
  if (path.startsWith('/api/remote/devices/') && method === 'DELETE') {
    const id = path.slice('/api/remote/devices/'.length);
    remote.devices = remote.devices.filter((d) => d.id !== id);
    return empty(204);
  }

  if (path.startsWith('/api/sessions')) {
    const [id, action, sub] = path.slice('/api/sessions/'.length).split('/');
    const b = (body ?? {}) as Record<string, unknown>;
    if (!id && method === 'GET') return json(shells.map((s) => s.info));
    if (!id && method === 'POST') {
      const cwd = typeof b.cwd === 'string' ? b.cwd : HOME;
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
      const n = shells.filter((s) => s.info.name.startsWith('zsh')).length;
      const titled = prompt.split('\n')[0]?.slice(0, 100);
      const name = typeof b.name === 'string' ? b.name : titled || (n ? `zsh ${n + 1}` : 'zsh');
      const sh = addShell(name, cwd, 'backlog', '');
      sh.info.pinned = typeof b.name === 'string';
      sh.info.mode = b.mode === 'ui' ? 'ui' : 'tui';
      if (prompt) {
        sh.info.pending_prompt = prompt;
        if (typeof b.command === 'string') {
          sh.info.pending_command = b.command;
          sh.info.agent_command = b.command;
        }
      }
      if (typeof b.acp_command === 'string' && b.acp_command.trim()) sh.info.acp_command = b.acp_command.trim();
      return json(sh.info);
    }
    if (id === 'order' && method === 'PUT') {
      const ids = (b.ids as string[]) ?? [];
      shells.sort((a, c) => ids.indexOf(a.info.id) - ids.indexOf(c.info.id));
      return empty(204);
    }
    const sh = shell(id);
    if (!sh) return empty(404);
    if (action === 'chat') {
      if (method === 'GET' && !sub) return json({ messages: [...scriptedChat(sh.info.id)] });
      if (method === 'GET' && sub === 'stream') return chatEvents(sh.info.id);
      if (method === 'GET' && sub === 'models') return json(demoModels);
      if (method === 'POST' && sub === 'start') return empty(204);
      if (sub === 'approvals') {
        if (method === 'GET') return json({ auto: demoApprovals.get(sh.info.id) ?? false });
        if (method === 'POST') {
          const auto = Boolean((b as { auto?: boolean }).auto);
          demoApprovals.set(sh.info.id, auto);
          return json({ auto });
        }
      }
      if (method === 'POST' && sub === 'model') {
        const id = (b as { id?: string }).id;
        if (typeof id === 'string') demoModels.current = id;
        return json(demoModels);
      }
      if (method === 'POST' && sub === 'message') return chatMessage(sh.info.id, b);
      if (method === 'POST' && (sub === 'stop' || sub === 'approve')) return empty(204);
      return empty(404);
    }
    if (method === 'DELETE') {
      shells.splice(shells.indexOf(sh), 1);
      sh.socket?.deliver(JSON.stringify({ exit: 0 }));
      return empty(204);
    }
    if (method === 'PATCH' && action === 'status') {
      sh.info = { ...sh.info, status: String(b.status), status_at: now() };
    } else if (method === 'PATCH' && !action && typeof b.name === 'string') {
      sh.info = { ...sh.info, name: b.name, pinned: !b.auto };
    }
    return json(sh.info);
  }

  if (path === '/api/files/root') return json({ root: rootOf(shell(q.get('session'))) });
  if (path === '/api/files/tree') {
    const root = rootOf(shell(q.get('session')));
    return json({ root, paths: listing(root), truncated: false });
  }
  if (path === '/api/files/folders') return json({ home: HOME, folders: [SHOP, API] });
  if (path === '/api/files') {
    if (method === 'PUT') {
      const b = body as { path: string; content: string };
      const abs = fileAt(undefined, b.path)?.abs ?? '';
      for (const [r, files] of Object.entries(FILES))
        if (abs.startsWith(`${r}/`)) files[abs.slice(r.length + 1)] = b.content;
      return json({ version: String(Date.now()) });
    }
    const f = fileAt(shell(q.get('session')), q.get('path') ?? '');
    if (!f) return empty(404);
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'x-tabsh-version': 'demo' } });
    return json({ path: f.abs, kind: 'text', size: f.content.length, version: 'demo', content: f.content, eol: 'lf' });
  }
  // Uploads and raw files: nothing to read or keep in a demo.
  return empty(404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin === location.origin) return realFetch(input, init);
  if (url.origin !== DEMO) throw new TypeError(`demo: no request to ${url.origin}`);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  return answer(method, url, body);
};

// After the replacements above. A static import would run first, so the app's
// opening /api/about would leave the page and the CSP would refuse it.
await import('../app/main.ts');
