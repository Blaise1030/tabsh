// A tab's terminal: xterm with right-click copy/paste and links, its
// session, and the socket to its shell. The strip draws its tab from the
// session (tab.ts). After sleep or a backgrounded browser tab, sockets drop
// together; reconnects are queued and drained one at a time (active first)
// so every tab's scrollback isn't replayed on the main thread at once.
import van from 'vanjs-core';
import { cardOf } from '../board/status.ts';
import { socketUrl } from '../daemon/client.ts';
import { linkProvider } from '../links/provider.ts';
import { current, terminalOptions } from '../settings/settings.ts';
import { scoped } from '../ui/keyed.ts';
import { ring } from './bell.ts';
import { scanBell } from './bell-scan.ts';
import { enqueueReconnect, nextReconnect, retryDelay, shouldDrainReconnects } from './reconnect.ts';
import {
  active,
  onActivate,
  removeSession,
  type Session,
  type SessionInfo,
  sendSize,
  setSessions,
  store,
  sync,
} from './store.ts';
import { setName } from './tabs.ts';
import { labelTab } from './tags.ts';

const enc = new TextEncoder();

let reconnectQueue: string[] = [];
const reconnectAttempts = new Map<string, number>();
let draining = false;
let wakeWatched = false;

function watchWake(): void {
  if (wakeWatched) return;
  wakeWatched = true;
  // Lid open / back to this browser tab: drain what closed while we were away.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kickDrain();
  });
  // Switching to a tab whose socket is still down: put it first and drain.
  onActivate(() => {
    const s = store.active;
    if (s && !s.closed && s.ws?.readyState !== WebSocket.OPEN) scheduleReconnect(s);
    else kickDrain();
  });
}

function scheduleReconnect(s: Session): void {
  if (s.closed) return;
  watchWake();
  reconnectQueue = enqueueReconnect(reconnectQueue, s.id);
  kickDrain();
}

function kickDrain(): void {
  if (draining || !shouldDrainReconnects(document.hidden)) return;
  void drainReconnects();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainReconnects(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (reconnectQueue.length && shouldDrainReconnects(document.hidden)) {
      const { next, rest } = nextReconnect(reconnectQueue, store.active?.id ?? null);
      reconnectQueue = rest;
      if (!next) break;
      const s = store.sessions.find((x) => x.id === next);
      if (!s || s.closed) {
        reconnectAttempts.delete(next);
        continue;
      }
      if (s.ws?.readyState === WebSocket.OPEN) {
        reconnectAttempts.delete(next);
        continue;
      }
      const attempt = reconnectAttempts.get(next) ?? 0;
      if (attempt > 0) await sleep(retryDelay(attempt - 1));
      await sync().catch(() => {});
      if (s.closed || s.ws?.readyState === WebSocket.OPEN) {
        reconnectAttempts.delete(next);
        continue;
      }
      const ok = await connect(s);
      if (ok) reconnectAttempts.delete(next);
      else if (!s.closed) reconnectAttempts.set(next, attempt + 1);
    }
  } finally {
    draining = false;
    if (reconnectQueue.length && shouldDrainReconnects(document.hidden)) kickDrain();
  }
}

// Opens a session's tab and terminal, once: a session already open (a sync
// can list a new tab before its POST answers) is returned as it is.
export function openSession(info: SessionInfo): Session {
  const known = store.sessions.find((x) => x.id === info.id);
  if (known) return known;
  const { id, name } = info;
  // Shown while its tab is the active one (until it's closed and gone).
  const el = scoped(() => van.tags.div({ class: () => (active.val?.id === id ? 'term active' : 'term') }));
  document.getElementById('terms')?.append(el);

  const term = new Terminal({
    cursorBlink: true,
    rightClickSelectsWord: false, // right-click is copy/paste (see below)
    ...terminalOptions(current.applied),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.registerLinkProvider(linkProvider(() => s, term, el));

  // Right-click belongs to the terminal, not the browser's menu. Programs
  // that track the mouse (vim, tmux, htop) receive it from xterm.js; at a
  // plain prompt it copies the selection, or pastes when there is none.
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.modes.mouseTrackingMode !== 'none') return;
    if (term.hasSelection()) {
      navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
    } else {
      navigator.clipboard
        ?.readText()
        .then((text) => text && term.paste(text))
        .catch(() => {});
    }
    term.focus();
  });

  const s: Session = {
    id,
    name: van.state(name),
    term,
    fit,
    el,
    ws: null,
    closed: false,
    replaying: false,
    parsingReplay: false,
    esc: 0,
    bell: van.state(false),
    unread: van.state(false),
    card: van.state(cardOf(info)),
    tags: van.state<string[]>([]),
    repo: van.state<string | null>(null),
    leaving: van.state(false),
    pinned: info.pinned,
  };
  setSessions([...store.sessions, s]);
  labelTab(s);

  // Replayed scrollback holds queries programs sent long ago (e.g. OSC 11,
  // "what's your background colour?"); xterm answers them as it parses, and
  // sent on, the answers land in the shell as typed text on every reload.
  term.onData((d) => !s.parsingReplay && s.ws?.readyState === WebSocket.OPEN && s.ws.send(enc.encode(d)));
  term.onTitleChange((t) => t && !s.pinned && setName(s, t));
  watchWake();
  void connect(s);
  return s;
}

// Resolves true once the first (replay) binary frame is parsed, or false if
// the socket dies first. A later drop queues a reconnect; the drain waits for
// this so the next tab's replay doesn't overlap.
function connect(s: Session): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(socketUrl(s.id));
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    // The server replays scrollback on every attach, so start from a clean screen.
    // The first binary message is that replay (always sent, maybe empty);
    // bells inside it already rang.
    ws.onopen = () => {
      s.term.reset();
      s.replaying = true;
      s.parsingReplay = false;
      s.esc = 0;
      sendSize(s);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (JSON.parse(e.data).exit) {
          removeSession(s);
          finish(false);
        }
        return;
      }
      const bytes = new Uint8Array(e.data);
      const scanned = scanBell(s.esc, bytes);
      s.esc = scanned.esc;
      if (s.replaying) {
        s.replaying = false;
        s.parsingReplay = true;
        s.term.write(bytes, () => {
          if (s.ws === ws) s.parsingReplay = false; // not an older socket's replay
          finish(true);
        });
        return;
      }
      s.term.write(bytes);
      if (scanned.bell) ring(s);
      if (s !== store.active) s.unread.val = true;
    };
    // Dropped without an exit message (network blip, client lagged, daemon
    // restarting): reattach if the session still exists on the server.
    ws.onclose = () => {
      if (s.ws !== ws) {
        finish(false);
        return;
      }
      if (s.closed) {
        finish(false);
        return;
      }
      finish(false);
      scheduleReconnect(s);
    };
  });
}
