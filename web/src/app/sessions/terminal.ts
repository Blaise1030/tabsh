// A tab's terminal: xterm with right-click copy/paste and links, its tab
// element, and the socket to its shell.
import { socketUrl } from '../daemon/client.ts';
import { linkProvider } from '../links/provider.ts';
import { current, terminalOptions } from '../settings/settings.ts';
import { onActivity, resetActivity } from './activity.ts';
import { IDLE } from './activity-view.ts';
import { ring } from './bell.ts';
import { scanBell } from './bell-scan.ts';
import {
  activate,
  closeSession,
  removeSession,
  type Session,
  type SessionInfo,
  sendSize,
  store,
  sync,
} from './store.ts';
import { setName } from './tabs.ts';

const enc = new TextEncoder();

export function openSession({ id, name }: SessionInfo): Session {
  const el = document.createElement('div');
  el.className = 'term';
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

  const template = document.getElementById('tab-template') as HTMLTemplateElement;
  const tab = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
  tab.classList.add('entering');
  document.getElementById('tabs')?.append(tab);
  void tab.offsetWidth; // commit the collapsed state so removing the class animates
  tab.classList.remove('entering');
  // It was zero-width when activated; bring it fully into view once grown.
  tab.addEventListener('transitionend', function grown(e) {
    if (e.propertyName !== 'max-width') return;
    tab.removeEventListener('transitionend', grown);
    if (s === store.active) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const s: Session = {
    id,
    name,
    term,
    fit,
    el,
    tab,
    ws: null,
    closed: false,
    replaying: false,
    esc: 0,
    bell: false,
    activity: IDLE,
  };
  store.sessions.push(s);
  setName(s, name, false);
  tab.onclick = () => activate(s);
  tab.onauxclick = (e) => e.button === 1 && closeSession(s); // middle-click closes
  (tab.querySelector('button') as HTMLButtonElement).onclick = (e) => {
    e.stopPropagation();
    closeSession(s);
  };

  term.onData((d) => s.ws?.readyState === WebSocket.OPEN && s.ws.send(enc.encode(d)));
  term.onTitleChange((t) => t && setName(s, t));
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
    s.esc = 0;
    resetActivity(s); // a restarted daemon's sessions start idle
    sendSize(s);
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      // Text frames are control messages: {"exit":true} and {"activity":"…"}.
      const msg = JSON.parse(e.data) as { exit?: boolean; activity?: string };
      if (msg.exit) {
        removeSession(s);
        return;
      }
      if (msg.activity) onActivity(s, msg.activity);
      return;
    }
    const bytes = new Uint8Array(e.data);
    const scanned = scanBell(s.esc, bytes);
    s.esc = scanned.esc;
    s.term.write(bytes);
    if (s.replaying) {
      s.replaying = false;
      return;
    }
    if (scanned.bell) ring(s);
    if (s !== store.active) s.tab.classList.add('unread');
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
