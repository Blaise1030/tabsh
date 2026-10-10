// A pretend daemon for /demo/, the copy of the app framed on the landing
// page. It answers the app's requests and sockets from memory, so the demo is
// the real app, never a drawing of it. It must load before the app: it swaps
// in fetch, WebSocket and localStorage first.
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
    info: { id: `demo-${nextId++}`, name, status, status_at: now() - 60 * nextId, note: null, cwd, pinned: true },
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
    `${orange('●')} The refund path now checks the order status first.`,
    '',
    `  ${dim('2 files changed,')} ${green('+18')} ${red('−4')}`,
    '',
    `Run the tests before I commit? ${dim('(y/n)')}`,
  ),
  {
    prompt: `${orange('›')} `,
    reply: (cmd) => {
      if (!/^y(es)?$/i.test(cmd))
        return /^n(o)?$/i.test(cmd) ? lines(`${orange('●')} Okay, leaving it uncommitted.`) : null;
      setTimeout(() => hook(claude, 'completed', 'Committed a1c9e04'), 600);
      return lines(`${orange('●')} Running cargo test…`, `  48 passed. Committed as ${dim('a1c9e04')}.`);
    },
  },
);
claude.output = claude.output.replace(/[^\n]*$/, claude.prompt);
claude.info.note = 'Run the tests before I commit?';
// Open on claude's tab, the one asking for you (sessions/store.ts's key).
storage.setItem('tabsh.active', claude.info.id);

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

let settings: Record<string, unknown> = { boardOnboarded: true };

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
  if (path === '/api/settings') {
    if (method === 'PUT') settings = body as Record<string, unknown>;
    return method === 'PUT' ? empty(204) : json(settings);
  }

  if (path.startsWith('/api/sessions')) {
    const [id, action] = path.slice('/api/sessions/'.length).split('/');
    const b = (body ?? {}) as Record<string, unknown>;
    if (!id && method === 'GET') return json(shells.map((s) => s.info));
    if (!id && method === 'POST') {
      const cwd = typeof b.cwd === 'string' ? b.cwd : HOME;
      const n = shells.filter((s) => s.info.name.startsWith('zsh')).length;
      const sh = addShell(typeof b.name === 'string' ? b.name : n ? `zsh ${n + 1}` : 'zsh', cwd, 'backlog', '');
      sh.info.pinned = typeof b.name === 'string';
      return json(sh.info);
    }
    if (id === 'order' && method === 'PUT') {
      const ids = (b.ids as string[]) ?? [];
      shells.sort((a, c) => ids.indexOf(a.info.id) - ids.indexOf(c.info.id));
      return empty(204);
    }
    const sh = shell(id);
    if (!sh) return empty(404);
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
