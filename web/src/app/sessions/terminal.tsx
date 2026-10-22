// A tab's terminal: xterm with right-click copy/paste and links, its
// session, and the socket to its shell. The strip draws its tab from the
// session (tab.tsx).
//
// Only the on-screen terminal holds a socket: the active tab while the
// workspace shows (terms view, or the board's drawer). Others park, so a
// drag that starts an agent (or a wake after sleep) does not replay every
// tab's scrollback on the main thread. Reconnects still drain one at a time
// with backoff if the visible socket drops.
import { createEffect, createMemo, createRenderEffect, createSignal, type JSX, untrack } from 'solid-js';
import { cardOf } from '../board/status.ts';
import { socketUrl } from '../daemon/client.ts';
import { linkProvider } from '../links/provider.ts';
import { here } from '../nav/router.ts';
import { current, terminalOptions } from '../settings/settings.ts';
import { isMac } from '../ui/dom.ts';
import { icons } from '../ui/icons.tsx';
import { ring } from './bell.ts';
import { coalescer } from './coalesce.ts';
import { type ExtraKey, keyInput, withCtrl } from './extra-keys.ts';
import { scrollToTab } from './groups.tsx';
import { type Heartbeat, heartbeat, type Timers } from './heartbeat.ts';
import { wordJumpSequence } from './keys.ts';
import { enqueueReconnect, nextReconnect, retryDelay, shouldDrainReconnects, terminalInView } from './reconnect.ts';
import {
  active,
  allTerms,
  findTerm,
  onActivate,
  onScreen,
  removeSession,
  type Session,
  type SessionInfo,
  screen,
  sendSize,
  sessionList,
  setSessions,
  shownTurn,
  store,
  sync,
} from './store.ts';
import { setName } from './tabs.ts';
import { labelTab } from './tags.tsx';
import { watchTouch } from './touch.ts';
import { softwareRenderer } from './webgl.ts';

const enc = new TextEncoder();

// One probe for the page: software WebGL (SwiftShader, llvmpipe) paints a busy
// terminal far slower than the DOM renderer, so it counts as no WebGL. A real
// GPU keeps WebGL; no context or a failed probe also leaves the DOM renderer.
let gpuAllowed: boolean | undefined;
function webglAllowed(): boolean {
  if (gpuAllowed !== undefined) return gpuAllowed;
  gpuAllowed = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuAllowed = !softwareRenderer(ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Probe failure: the DOM renderer is the safe choice.
  }
  return gpuAllowed;
}

let reconnectQueue: string[] = [];
const reconnectAttempts = new Map<string, number>();
let draining = false;
let wakeWatched = false;

function inView(s: Session): boolean {
  const place = here();
  return terminalInView({
    sessionId: s.id,
    screenId: onScreen()?.id ?? null,
    view: place.view,
    drawer: place.drawer,
    documentHidden: document.hidden,
  });
}

// The touch key bar's Ctrl: held for the next key typed.
export const [ctrlHeld, setCtrlHeld] = createSignal(false);

// Types an extra key into the on-screen terminal, as if from its keyboard.
export function typeKey(key: ExtraKey): void {
  const s = onScreen();
  if (!s) return;
  s.term.input(keyInput(key, s.term.modes.applicationCursorKeysMode), true);
  s.term.scrollToBottom();
}

// Each open socket's heartbeat.
const beats = new WeakMap<WebSocket, Heartbeat>();
const timers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

// Back from sleep or a dropped network, the on-screen socket may be dead
// though it still says open: ask it now rather than at the next ping.
function probeActive(): void {
  const ws = onScreen()?.ws;
  if (ws) beats.get(ws)?.probe();
}

function watchWake(): void {
  if (wakeWatched) return;
  wakeWatched = true;
  document.addEventListener('visibilitychange', () => {
    syncTerminalVisibility();
    if (!document.hidden) probeActive();
  });
  window.addEventListener('online', probeActive);
  window.addEventListener('pageshow', probeActive);
  onActivate(() => syncTerminalVisibility());
}

// When each parked tab last let go of its socket (performance.now()).
const parkedAt = new WeakMap<Session, number>();

// How long ago a tab parked: null while its socket is up, Infinity if it
// never had one. Board events' activity uses it (sessions/activity.ts).
export function parkedMs(s: Session): number | null {
  if (s.ws && s.ws.readyState < WebSocket.CLOSING) return null;
  const at = parkedAt.get(s);
  return at === undefined ? Number.POSITIVE_INFINITY : performance.now() - at;
}

function park(s: Session): void {
  reconnectQueue = reconnectQueue.filter((id) => id !== s.id);
  reconnectAttempts.delete(s.id);
  // Output not yet painted is painted: the next attach resumes after it.
  s.out.flush();
  const ws = s.ws;
  if (!ws) return;
  parkedAt.set(s, performance.now());
  // Drop the reference first so onclose does not queue a reconnect.
  s.ws = null;
  ws.close();
}

function scheduleReconnect(s: Session): void {
  if (s.closed || !inView(s)) return;
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
      const { next, rest } = nextReconnect(reconnectQueue, onScreen()?.id ?? null);
      reconnectQueue = rest;
      if (!next) break;
      const s = findTerm(next);
      if (!s || s.closed || !inView(s)) {
        reconnectAttempts.delete(next);
        continue;
      }
      if (s.ws?.readyState === WebSocket.OPEN || s.ws?.readyState === WebSocket.CONNECTING) {
        reconnectAttempts.delete(next);
        continue;
      }
      const attempt = reconnectAttempts.get(next) ?? 0;
      if (attempt > 0) await sleep(retryDelay(attempt - 1));
      await sync().catch(() => {});
      if (s.closed || !inView(s) || s.ws?.readyState === WebSocket.OPEN) {
        reconnectAttempts.delete(next);
        continue;
      }
      const ok = await connect(s);
      if (ok) reconnectAttempts.delete(next);
      else if (!s.closed && inView(s)) reconnectAttempts.set(next, attempt + 1);
    }
  } finally {
    draining = false;
    if (reconnectQueue.length && shouldDrainReconnects(document.hidden)) kickDrain();
  }
}

// Connect the on-screen terminal; park every other. Called when the active
// tab, board/drawer place, or page visibility changes. The visible tab
// attaches at once (no drain delay), so typing and the explorer's cd mark
// are not racing a queued reconnect after startup or a tab switch.
export function syncTerminalVisibility(): void {
  watchWake();
  for (const s of allTerms()) {
    if (s.closed) continue;
    if (inView(s)) {
      const state = s.ws?.readyState;
      if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) void connect(s);
    } else {
      park(s);
    }
  }
}

// Opens a session's tab and terminal, once: a session already open (a sync
// can list a new tab before its POST answers) is returned as it is.
export function openSession(info: SessionInfo): Session {
  const known = findTerm(info.id);
  if (known) return known;
  const { id, name } = info;
  const parent = info.parent ?? null;
  // Placed in #terms by TermHost, once the session is in the list.
  const el = document.createElement('div');
  el.className = 'term';

  const term = new Terminal({
    cursorBlink: true,
    rightClickSelectsWord: false, // right-click is copy/paste (see below)
    ...terminalOptions(current.applied),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  // Paint through WebGL on a real GPU; software rasterizers, a refused
  // context, or an addon error leave xterm's DOM renderer.
  if (webglAllowed()) {
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL (or no context at init): the DOM renderer stays.
    }
  }
  // Phone keyboards otherwise correct, capitalise and predict into the shell.
  for (const [k, v] of [
    ['autocorrect', 'off'],
    ['autocapitalize', 'off'],
    ['autocomplete', 'off'],
    ['spellcheck', 'false'],
  ])
    term.textarea?.setAttribute(k, v);
  term.registerLinkProvider(linkProvider(() => s, term, el));

  // xterm 6 dropped macOS Option+Arrow → Ctrl+Arrow (#5346); keep the shell's
  // word jump without changing other modifiers.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const sequence = wordJumpSequence(event.key, event, isMac);
    if (!sequence) return true;
    term.input(sequence);
    return false;
  });

  // A program that redraws without taking the alternate screen can leave the
  // view stuck above its output; this brings it back.
  const bottomBtn = document.createElement('button');
  bottomBtn.type = 'button';
  bottomBtn.className = 'btn term-bottom';
  bottomBtn.dataset.variant = 'secondary';
  bottomBtn.dataset.size = 'icon-sm';
  bottomBtn.setAttribute('aria-label', 'Scroll to bottom');
  bottomBtn.title = 'Scroll to bottom';
  bottomBtn.hidden = true;
  bottomBtn.append(icons.chevronDown());
  bottomBtn.addEventListener('click', () => {
    term.scrollToBottom();
    syncScrolled();
    term.focus();
  });
  const syncScrolled = () => {
    const buf = term.buffer.active;
    bottomBtn.hidden = !(buf.viewportY < buf.baseY);
  };
  term.onScroll(syncScrolled);
  term.onWriteParsed(syncScrolled);
  term.buffer.onBufferChange(syncScrolled);
  el.addEventListener('wheel', () => requestAnimationFrame(syncScrolled), { passive: true });
  el.append(bottomBtn);
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

  const [readName, writeName] = createSignal(name);
  const [readBell, writeBell] = createSignal(false);
  const [readUnread, writeUnread] = createSignal(false);
  const [readCard, writeCard] = createSignal(cardOf(info));
  const [readTags, writeTags] = createSignal<string[]>([]);
  const [readRepo, writeRepo] = createSignal<string | null>(null);
  const [readLeaving, writeLeaving] = createSignal(false);
  const [readSides, writeSides] = createSignal<Session[]>([]);
  const s: Session = {
    id,
    name: readName,
    setName: writeName,
    term,
    fit,
    el,
    ws: null,
    out: coalescer(
      (bytes, parsed) => term.write(bytes, parsed),
      (fn) => requestAnimationFrame(fn),
      (handle) => cancelAnimationFrame(handle),
    ),
    closed: false,
    stream: null,
    replaying: false,
    parsingReplay: false,
    bell: readBell,
    setBell: writeBell,
    unread: readUnread,
    setUnread: writeUnread,
    card: readCard,
    setCard: writeCard,
    tags: readTags,
    setTags: writeTags,
    repo: readRepo,
    setRepo: writeRepo,
    leaving: readLeaving,
    setLeaving: writeLeaving,
    pinned: info.pinned,
    parent,
    sides: readSides,
    setSides: writeSides,
  };
  if (parent) {
    const card = store.sessions.find((c) => c.id === parent);
    if (!card) {
      s.closed = true;
      s.term.dispose();
      return s;
    }
    card.setSides([...card.sides(), s]);
  } else {
    setSessions([...store.sessions, s]);
    labelTab(s);
  }

  // Replayed scrollback holds queries programs sent long ago (e.g. OSC 11,
  // "what's your background colour?"); xterm answers them as it parses, and
  // sent on, the answers land in the shell as typed text on every reload.
  term.onData((d) => {
    if (s.parsingReplay || s.ws?.readyState !== WebSocket.OPEN) return;
    if (ctrlHeld()) {
      setCtrlHeld(false);
      d = withCtrl(d);
    }
    s.ws.send(enc.encode(d));
  });
  watchTouch(term, el);
  term.onTitleChange((t) => t && !s.pinned && setName(s, t));
  watchWake();
  // Only the on-screen tab attaches; a sync that opens others parks them.
  syncTerminalVisibility();
  return s;
}

// The cards and their side terminals in the order they opened, given the
// last list (`prev`): a reorder of the strip moves no terminal, as moving one
// drops its focus.
export function termSessions(prev: Session[]): Session[] {
  const live = sessionList().flatMap((s) => [s, ...s.sides()]);
  const kept = new Set(live);
  const known = new Set(prev);
  return [...prev.filter((s) => kept.has(s)), ...live.filter((s) => !known.has(s))];
}

// A terminal's place in #terms: the element openSession made, never a new
// one, so its xterm and scrollback live on.
export function TermHost(props: { session: Session }): JSX.Element {
  const s = props.session;
  const shown = screen;
  const tab = active;
  // A render effect: Solid runs these before any effect, so the terminal
  // shows before the one below fits or focuses it.
  createRenderEffect(() => s.el.classList.toggle('active', shown()?.id === s.id));
  // Each time the tab or term step puts a terminal on screen (a new
  // `shownTurn`): if it's this one, fit it to the view it now has and give it
  // the keyboard. A memo, so a mirror that fires again without a new turn
  // doesn't take the keyboard back.
  const turn = createMemo(shownTurn);
  createEffect(() => {
    const t = turn();
    const card = untrack(tab);
    if (untrack(shown) !== s || !card) return;
    if (t.tab) scrollToTab(card);
    sendSize(s);
    s.term.focus();
  });
  return s.el;
}

// Resolves true once the first (replay) binary frame is parsed, or false if
// the socket dies first. A later drop queues a reconnect; the drain waits for
// this so the next tab's replay doesn't overlap.
function connect(s: Session): Promise<boolean> {
  return new Promise((resolve) => {
    const seen = s.stream;
    const ws = new WebSocket(socketUrl(s.id) + (seen ? `&resume=${seen.epoch}:${seen.at}` : ''));
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    // The first binary message is the replay (always sent, maybe empty);
    // bells inside it are left to the daemon's live Bell events. The text
    // frame before it says whether it is the whole scrollback, for a clean
    // screen, or only what this screen missed (`resumed`).
    // Only a daemon that has answered a ping can be found dead by a missing
    // pong: an older one never answers.
    let answers = false;
    let resumed = false;
    ws.onopen = () => {
      s.stream = null;
      s.replaying = true;
      s.parsingReplay = false;
      sendSize(s);
      const hb = heartbeat(
        (n) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ ping: n })),
        () => answers && dropped(),
        timers,
      );
      beats.set(ws, hb);
      hb.probe();
    };
    ws.onmessage = (e) => {
      if (s.ws !== ws) return; // a parked or replaced socket's late message
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (typeof msg.pong === 'number') {
          answers = true;
          beats.get(ws)?.pong(msg.pong);
        } else if (msg.stream) {
          s.stream = { epoch: msg.stream.epoch, at: msg.stream.at };
          resumed = msg.stream.resumed === true && seen?.epoch === msg.stream.epoch;
        } else if (msg.bell) {
          // The daemon scans live output, so this skips replayed history and
          // doesn't need a second scan on the main thread for every chunk.
          ring(s);
        } else if (msg.exit) {
          removeSession(s);
          finish(false);
        }
        return;
      }
      const bytes = new Uint8Array(e.data);
      if (s.replaying) {
        s.replaying = false;
        s.parsingReplay = true;
        if (resumed) {
          s.out.flush(); // an older socket's unpainted bytes come before these
        } else {
          s.out.drop(); // an older socket's unpainted bytes: the replay holds them
          s.term.reset();
        }
        s.out.replay(bytes, () => {
          if (s.ws === ws) s.parsingReplay = false; // not an older socket's replay
          finish(true);
        });
        return;
      }
      // A burst paints once a frame, not once a message; unread still follows
      // each chunk.
      if (s.stream) s.stream.at += bytes.length;
      s.out.push(bytes);
      if (s !== onScreen()) s.setUnread(true);
    };
    // Dropped without an exit message (network blip, client lagged, daemon
    // restarting, or found dead by its heartbeat): reattach only while this
    // terminal is still on screen.
    const dropped = () => {
      beats.get(ws)?.stop();
      ws.onclose = null;
      if (ws.readyState < WebSocket.CLOSING) ws.close();
      if (s.ws !== ws) {
        finish(false);
        return;
      }
      if (s.closed) {
        finish(false);
        return;
      }
      // Dropped without park(): from now on, its output reaches the page as
      // activity, as for a parked tab.
      parkedAt.set(s, performance.now());
      finish(false);
      if (inView(s)) scheduleReconnect(s);
    };
    ws.onclose = dropped;
  });
}
