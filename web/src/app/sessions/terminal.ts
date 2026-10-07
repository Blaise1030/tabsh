// A tab's terminal: xterm with right-click copy/paste and links, its
// session, and the socket to its shell. The strip draws its tab from the
// session (tab.ts).
import van from 'vanjs-core';
import { cardOf, cardsChanged } from '../board/status.ts';
import { socketUrl } from '../daemon/client.ts';
import { linkProvider } from '../links/provider.ts';
import { current, terminalOptions } from '../settings/settings.ts';
import { ring } from './bell.ts';
import { scanBell } from './bell-scan.ts';
import { active, removeSession, type Session, type SessionInfo, sendSize, setSessions, store, sync } from './store.ts';
import { setName } from './tabs.ts';
import { labelTab } from './tags.ts';

const enc = new TextEncoder();

// Opens `info`'s tab, once: a session already open is returned as it is (a
// sync and the POST that made the session can both bring it).
export function openSession(info: SessionInfo): Session {
  const known = store.sessions.find((x) => x.id === info.id);
  if (known) return known;
  const { id, name } = info;
  // Shown while its tab is the active one.
  const el = van.tags.div({ class: () => (active.val?.id === id ? 'term active' : 'term') });
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
  cardsChanged();

  // Replayed scrollback holds queries programs sent long ago (e.g. OSC 11,
  // "what's your background colour?"); xterm answers them as it parses, and
  // sent on, the answers land in the shell as typed text on every reload.
  term.onData((d) => !s.parsingReplay && s.ws?.readyState === WebSocket.OPEN && s.ws.send(enc.encode(d)));
  term.onTitleChange((t) => t && !s.pinned && setName(s, t));
  connect(s);
  return s;
}

function connect(s: Session): void {
  const ws = new WebSocket(socketUrl(s.id));
  ws.binaryType = 'arraybuffer';
  s.ws = ws;

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
      if (JSON.parse(e.data).exit) removeSession(s);
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
    if (s.closed || s.ws !== ws) return;
    setTimeout(
      () =>
        sync()
          .catch(() => {})
          .finally(() => !s.closed && connect(s)),
      1000,
    );
  };
}
