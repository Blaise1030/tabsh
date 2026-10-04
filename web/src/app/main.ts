// @ts-nocheck
// biome-ignore-all lint: moved verbatim from the page's inline script; typed and split up in Tasks 9 to 11
// The app page's script: tabs and terminals, links and the file pane, settings,
// the command palette, sounds and drag-and-drop.

import { api, daemonFetch, initGate, socketUrl, waitForDaemon } from './daemon/client.ts';
import { LOCAL_APP, MIXED_BLOCKED } from './daemon/config.ts';
import { adoptToken } from './daemon/token.ts';
import { findLinks } from './links/links.ts';
import { FONT_SIZES, FONTS, prefersLight, THEMES, TYPING_SOUNDS } from './settings/catalog.ts';
import { keyLabel, matchesKey } from './settings/keys.ts';
import {
  applySettings,
  current,
  KEYBINDINGS,
  loadSettings,
  onApply,
  onSaved,
  saveSetting,
  setPreviewing,
  terminalOptions,
} from './settings/settings.ts';
import { isMac } from './ui/dom.ts';

// The pairing link puts the token in the fragment; take it and clear it
// before anything talks to the daemon.
const launched = adoptToken(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// A link with the token comes from a running daemon (it opens one at
// startup), so it's safe to go straight to its copy. Without one the
// daemon may be down, and the gate explains how to start it.
if (MIXED_BLOCKED && launched) location.replace(LOCAL_APP);
initGate();

// The server (SQLite) owns the list of sessions; only which tab this
// browser has selected is kept locally.
const ACTIVE_KEY = 'tabsh.active';
const enc = new TextEncoder();
const sessions = []; // { id, name, term, fit, ws, el, tab, closed }
let active = null;

const rememberActive = () => {
  try {
    localStorage.setItem(ACTIVE_KEY, active?.id ?? '');
  } catch {}
};
const savedActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

async function newSession() {
  activate(openSession(await api('POST', '')));
}

// Bring the tab list in line with the server: picks up tabs opened or
// closed from another browser, and drops ones whose shell is gone.
async function sync() {
  const list = await api('GET', '');
  const ids = new Set(list.map((s) => s.id));
  sessions.filter((s) => !ids.has(s.id)).forEach(removeSession);
  for (const info of list) {
    const s = sessions.find((s) => s.id === info.id);
    if (s) setName(s, info.name, false);
    else openSession(info);
  }
  if (!active && sessions.length) activate(sessions[0]);
}

function openSession({ id, name }) {
  const el = document.createElement('div');
  el.className = 'term';
  document.getElementById('terms').append(el);

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

  const tab = document.getElementById('tab-template').content.firstElementChild.cloneNode(true);
  tab.classList.add('entering');
  document.getElementById('tabs').append(tab);
  tab.offsetWidth; // commit the collapsed state so removing the class animates
  tab.classList.remove('entering');
  // It was zero-width when activated; bring it fully into view once grown.
  tab.addEventListener('transitionend', function grown(e) {
    if (e.propertyName !== 'max-width') return;
    tab.removeEventListener('transitionend', grown);
    if (s === active) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const s = { id, name, term, fit, el, tab, ws: null, closed: false };
  sessions.push(s);
  setName(s, name, false);
  tab.onclick = () => activate(s);
  tab.onauxclick = (e) => e.button === 1 && closeSession(s); // middle-click closes
  tab.querySelector('button').onclick = (e) => {
    e.stopPropagation();
    closeSession(s);
  };

  term.onData((d) => s.ws?.readyState === WebSocket.OPEN && s.ws.send(enc.encode(d)));
  term.onTitleChange((t) => t && setName(s, t));
  connect(s);
  return s;
}

function connect(s) {
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
    sendSize(s);
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      if (JSON.parse(e.data).exit) removeSession(s);
      return;
    }
    const bytes = new Uint8Array(e.data);
    const bell = scanBell(s, bytes);
    s.term.write(bytes);
    if (s.replaying) {
      s.replaying = false;
      return;
    }
    if (bell) ring(s);
    if (s !== active) s.tab.classList.add('unread');
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

function sendSize(s) {
  if (s !== active) return;
  s.fit.fit();
  if (s.ws?.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify({ cols: s.term.cols, rows: s.term.rows }));
  }
}

function setName(s, name, save = true) {
  const label = s.tab.querySelector('span');
  if (s.name === name && label.textContent) return;
  s.name = name;
  label.textContent = s.tab.title = name;
  if (s === active) updateBadge();
  if (save) api('PATCH', `/${s.id}`, { name }).catch(() => {});
}

function activate(s) {
  if (active) {
    active.el.classList.remove('active');
    active.tab.setAttribute('aria-selected', 'false');
  }
  active = s;
  pane?.show(s?.id ?? null);
  document.getElementById('empty').hidden = !!s;
  updateBadge();
  if (s) {
    s.el.classList.add('active');
    s.tab.setAttribute('aria-selected', 'true');
    s.tab.classList.remove('unread');
    if (!document.hidden) clearBell(s);
    s.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    sendSize(s);
    s.term.focus();
  }
  rememberActive();
}

// ---- Links and the file pane ---------------------------------------------
// URLs and paths in the output are Cmd/Ctrl-clickable. The pane
// (files/pane.ts, with CodeMirror) is fetched on first use.
const existsCache = new Map(); // `${session}\0${path}` → { at, ok: Promise<boolean> }

// A path is underlined only once the daemon says it resolves.
function pathExists(s, path) {
  const key = `${s.id}\0${path}`,
    now = Date.now();
  const hit = existsCache.get(key);
  if (hit && now - hit.at < 5000) return hit.ok;
  if (existsCache.size > 500) existsCache.forEach((v, k) => now - v.at >= 5000 && existsCache.delete(k));
  const ok = import('./files/api.ts').then((files) => files.exists(daemonFetch, s.id, path)).catch(() => false);
  existsCache.set(key, { at: now, ok });
  return ok;
}

// `session()` because the session object is created after the terminal.
function linkProvider(session, term, el) {
  return {
    provideLinks(y, cb) {
      // Join the wrapped rows of this logical line, cell by cell, keeping
      // each UTF-16 unit's cell so offsets map back to 1-based {x, y}.
      const buf = term.buffer.active;
      let top = y - 1;
      while (top > 0 && buf.getLine(top)?.isWrapped) top--;
      let text = '';
      const cells = [];
      for (let row = top; ; row++) {
        const line = buf.getLine(row);
        if (!line || (row > top && !line.isWrapped)) break;
        for (let x = 0; x < line.length; x++) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) continue; // trailing half of a wide character
          const chars = cell.getChars() || ' ';
          for (let i = 0; i < chars.length; i++) cells.push({ x: x + 1, y: row + 1, w: cell.getWidth() });
          text += chars;
        }
      }
      const s = session();
      Promise.resolve({ findLinks })
        .then(({ findLinks }) =>
          Promise.all(
            findLinks(text).map(async (f) => {
              const a = cells[f.start],
                b = cells[f.end - 1];
              if (!a || !b || y < a.y || y > b.y) return null; // not on the hovered row
              if (f.kind === 'path' && !(await pathExists(s, f.text))) return null;
              return {
                range: { start: { x: a.x, y: a.y }, end: { x: b.x + b.w - 1, y: b.y } },
                text: f.text,
                decorations: { underline: true, pointerCursor: true },
                hover: () => {
                  el.title = isMac ? '⌘-click to open' : 'Ctrl-click to open';
                },
                leave: () => {
                  el.title = '';
                },
                activate(e) {
                  if (!(isMac ? e.metaKey : e.ctrlKey)) return;
                  if (f.kind === 'url') window.open(f.text, '_blank', 'noopener,noreferrer');
                  else openInPane(s, f);
                },
              };
            }),
          ),
        )
        .then(
          (links) => cb(links.filter(Boolean)),
          () => cb(undefined),
        );
    },
  };
}

const host = {
  fetch: daemonFetch,
  theme() {
    const t = THEMES[current.applied.theme],
      c = t.colors;
    return {
      background: c.background,
      foreground: c.foreground,
      cursor: c.cursor,
      selectionBackground: c.selectionBackground,
      light: !!t.light,
    };
  },
  layout: () => active && sendSize(active),
  newTabAt: (cwd) =>
    api('POST', '', { cwd })
      .then((info) => activate(openSession(info)))
      .catch(console.error),
  focusTerminal: () => active?.term.focus(),
};

let pane = null; // the file-pane module, once loaded
let paneLoad = null; // shared by clicks made while it loads, so init runs once
function filePane() {
  paneLoad ??= import('./files/pane.ts').then(
    (m) => {
      m.init(host);
      pane = m;
      pane.show(active?.id ?? null);
      return m;
    },
    (err) => {
      paneLoad = null;
      throw err;
    },
  );
  return paneLoad;
}

async function openInPane(s, f, retried = false) {
  let p;
  try {
    p = await filePane();
  } catch (err) {
    console.error(err);
    return paneLoadFailed(() => openInPane(s, f, true), retried);
  }
  if (!s.closed) await p.openPath(s.id, f.text, f.line, f.col);
}

// The bundle couldn't be fetched (offline, or a daemon that doesn't serve it yet).
// Chrome remembers a failed import(), so a second failure reloads the page
// instead; the shells survive that.
function paneLoadFailed(retry, retried) {
  const box = document.getElementById('pane'),
    divider = document.getElementById('pane-divider');
  const msg = document.createElement('div');
  msg.className = 'pane-msg';
  const p = document.createElement('p');
  p.textContent = "Couldn't load the editor";
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn';
  again.textContent = 'Retry';
  again.onclick = () => {
    if (retried) return location.reload();
    pane = paneLoad = null;
    box.hidden = divider.hidden = true;
    box.replaceChildren();
    retry();
  };
  msg.append(p, again);
  box.replaceChildren(msg);
  box.hidden = divider.hidden = false;
  if (active) sendSize(active);
}

// ---- Bell: badge on the tab and favicon -------------------------------
// A BEL from a shell, unless you're looking at that terminal, marks its tab
// and badges the favicon and title until you visit it.
const faviconSvg = (badge) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="#18181b"/>' +
      '<path d="M8 11l5 5-5 5M15 22h9" fill="none" stroke="#e4e4e7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      (badge ? '<circle cx="25" cy="7" r="6.5" fill="#f97316" stroke="#18181b" stroke-width="2"/>' : '') +
      '</svg>',
  );
const FAVICON = faviconSvg(false),
  FAVICON_BELL = faviconSvg(true);

// Bells are found in the raw bytes as they arrive rather than via xterm's
// onBell: xterm parses on a timer, which a hidden tab throttles (Chrome
// eventually to once a minute), so onBell fires late exactly when you're
// elsewhere. BEL also terminates OSC strings (shells set the title on every
// prompt), so track just enough escape state to skip those. The state
// carries across chunks; 8-bit C1 controls are ignored since the stream is UTF-8.
const TEXT = 0,
  ESC = 1,
  STR = 2,
  STR_ESC = 3;
function scanBell(s, bytes) {
  let st = s.esc ?? TEXT,
    bell = false;
  for (const b of bytes) {
    if (st === STR_ESC) st = b === 0x5c ? TEXT : ESC; // ESC \ ends the string; any other ESC aborts it
    if (st === STR) {
      if (b === 0x07 || b === 0x18 || b === 0x1a)
        st = TEXT; // BEL terminates; CAN/SUB abort
      else if (b === 0x1b) st = STR_ESC;
    } else if (st === ESC) {
      // OSC, DCS, APC, PM and SOS take a string argument.
      st = b === 0x5d || b === 0x50 || b === 0x5f || b === 0x5e || b === 0x58 ? STR : b === 0x1b ? ESC : TEXT;
    } else if (st === TEXT) {
      if (b === 0x07) bell = true;
      else if (b === 0x1b) st = ESC;
    }
  }
  s.esc = st;
  return bell;
}

function ring(s) {
  if (s === active && !document.hidden && document.hasFocus()) return;
  s.bell = true;
  s.tab.classList.remove('bell');
  s.tab.offsetWidth; // restart the pulse on repeated bells
  s.tab.classList.add('bell');
  updateBadge();
}

function clearBell(s) {
  if (!s?.bell) return;
  s.bell = false;
  s.tab.classList.remove('bell');
  updateBadge();
}

function updateBadge() {
  const ringing = sessions.filter((x) => x.bell).length;
  document.getElementById('favicon').href = ringing ? FAVICON_BELL : FAVICON;
  const name = active?.name ?? 'tabsh';
  document.title = ringing ? `🔔 ${name}` : name;
}

// Coming back to the browser tab counts as seeing the active terminal.
const seen = () => !document.hidden && clearBell(active);
document.addEventListener('visibilitychange', seen);
addEventListener('focus', seen);
document.getElementById('favicon').href = FAVICON;

async function closeSession(s) {
  if (!(pane?.confirmDiscard(s.id) ?? true)) return;
  // A running shell is killed and the server answers on the socket with
  // {"exit":true}; one that never started is just gone.
  await api('DELETE', `/${s.id}`).catch(() => {});
  if (s.ws?.readyState !== WebSocket.OPEN) removeSession(s);
}

addEventListener('beforeunload', (e) => {
  if (!pane?.hasUnsaved()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers
});

function removeSession(s) {
  if (s.closed) return;
  s.closed = true;
  pane?.forget(s.id);
  s.ws?.close();
  s.term.dispose();
  s.el.remove();
  // Collapse the tab, then drop it (the timeout covers reduced motion,
  // where no transition runs).
  s.tab.classList.add('leaving');
  const drop = () => {
    s.tab.remove();
    updateFades();
  };
  s.tab.addEventListener('transitionend', (e) => e.propertyName === 'max-width' && drop());
  setTimeout(drop, 300);
  const i = sessions.indexOf(s);
  sessions.splice(i, 1);
  if (active === s) {
    active = null;
    activate(sessions[Math.min(i, sessions.length - 1)] ?? null);
  } else updateBadge();
}

// ---- Typing sound --------------------------------------------------------
let audio = null;
// Sampled switch packs from kbsim and Mechvibes (MIT, see
// public/sounds/*/LICENSE), laid out as in keyboardsounds' profiles: five
// press variants for ordinary keys, picked at random, and their own
// press/release for the big keys. A null release means press-only samples.
const SOUND_PACKS = {
  'mx-black-pbt': { release: null, special: ['space', 'enter', 'back'] },
  'mx-blue': { release: 'release', special: [] },
  'holy-panda': { release: 'release_key', special: ['space', 'enter', 'back'] },
  'gateron-black-ink': { release: 'release_key', special: ['space', 'enter', 'back'] },
};
const SPECIAL_KEYS = { ' ': 'space', Enter: 'enter', Backspace: 'back', Delete: 'back' };
const packLoads = {}; // id → Promise of the decoded pack
const loadedPacks = {}; // id → { keys: [{ press, release }], space?, enter?, back? }
let sampleGain = null;

function loadPack(id) {
  if (packLoads[id]) return packLoads[id];
  // Decoding needs a context but not a user gesture; it may start suspended.
  audio ??= new AudioContext();
  const { release, special } = SOUND_PACKS[id];
  const buffer = (name) =>
    fetch(`/sounds/${id}/${name}.mp3`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.arrayBuffer();
      })
      .then((data) => audio.decodeAudioData(data));
  const keyRelease = release && buffer(release);
  const sample = async (press, rel) => ({ press: await buffer(press), release: await rel });
  return (packLoads[id] = Promise.all([
    Promise.all([1, 2, 3, 4, 5].map((n) => sample(`press_key${n}`, keyRelease))),
    ...special.map((s) => sample(`press_${s}`, release && buffer(`release_${s}`))),
  ])
    .then(([keys, ...rest]) => {
      loadedPacks[id] = { keys, ...Object.fromEntries(special.map((s, i) => [s, rest[i]])) };
      return loadedPacks[id];
    })
    .catch((err) => {
      delete packLoads[id]; // let a later keystroke retry
      throw err;
    }));
}

function playSample(buf) {
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  if (!sampleGain) {
    sampleGain = audio.createGain();
    sampleGain.gain.value = 0.6;
    sampleGain.connect(audio.destination);
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.95 + Math.random() * 0.1;
  src.connect(sampleGain);
  src.start();
}

// The pack's sample for a key, or null while the pack is still loading.
function sampleFor(id, key) {
  const pack = loadedPacks[id];
  if (!pack) {
    loadPack(id).catch(() => {});
    return null;
  }
  return pack[SPECIAL_KEYS[key]] ?? pack.keys[Math.floor(Math.random() * pack.keys.length)];
}

// Lets the palette play a sound while it's highlighted, so you hear a
// pack before choosing it.
function previewSound(setting) {
  if (SOUND_PACKS[setting] && !loadedPacks[setting]) {
    return loadPack(setting).then(
      () => previewSound(setting),
      () => {},
    );
  }
  const release = keySound(setting, 'a');
  if (release) setTimeout(() => playSample(release), 90);
}

// Plays a sound for one key under the given setting; returns the release
// sample to play when the key comes back up, if any.
function keySound(setting, key) {
  const sample = SOUND_PACKS[setting] && sampleFor(setting, key);
  if (!sample) return null;
  playSample(sample.press);
  return sample.release;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const held = new Map(); // e.code → release sample
// Typing in a terminal sounds, and so does typing in the file pane's editor
// (not a read-only view of the file).
// App shortcuts (palette, tab switching) stay silent.
const typing = (e) =>
  !!e.target.closest?.('#terms, #pane .cm-content[contenteditable="true"]') &&
  !Object.keys(KEYBINDINGS).some((id) => matchesKey(e, current.saved[id]));
window.addEventListener(
  'keydown',
  (e) => {
    // Held keys auto-repeat; only the first press sounds.
    if (current.saved.typingSound === 'off' || e.repeat || MODIFIERS.has(e.key) || !typing(e)) return;
    const release = keySound(current.saved.typingSound, e.key);
    if (release) held.set(e.code, release);
  },
  { capture: true },
);
window.addEventListener(
  'keyup',
  (e) => {
    const release = held.get(e.code);
    held.delete(e.code);
    if (release) playSample(release);
  },
  { capture: true },
);

// ---- Command palette (Basecoat command-dialog) --------------------------

const palette = document.getElementById('palette');
const paletteCmd = document.getElementById('palette-command');
const paletteInput = document.getElementById('palette-input');
const paletteMenu = document.getElementById('palette-menu');
let page = 'root';

const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICONS = {
  theme:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  font: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>',
  size: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/></svg>',
  sound:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/></svg>',
  keybinding:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

// Each page is a list of groups; an item either opens another page (`go`),
// picks a setting (`key` + `value`, previewed while highlighted) or runs code.
const PAGES = {
  root: () => ({
    placeholder: `Search settings…`,
    groups: [
      {
        heading: 'Appearance',
        items: [
          {
            label: 'Theme…',
            icon: ICONS.theme,
            hint: THEMES[current.saved.theme].name,
            keywords: 'color colour scheme dark light',
            go: 'theme',
          },
          {
            label: 'Font…',
            icon: ICONS.font,
            hint: FONTS[current.saved.font].name,
            keywords: 'typeface family',
            go: 'font',
          },
          {
            label: 'Font size…',
            icon: ICONS.size,
            hint: `${current.saved.fontSize}px`,
            keywords: 'zoom text bigger smaller',
            go: 'fontSize',
          },
        ],
      },
      {
        heading: 'Sound',
        items: [
          {
            label: 'Typing sound…',
            icon: ICONS.sound,
            hint: TYPING_SOUNDS[current.saved.typingSound],
            keywords: 'keyboard click clack audio mute',
            go: 'typingSound',
          },
        ],
      },
      ...(active && pane?.hasFile(active.id)
        ? [
            {
              heading: 'Files',
              items: [
                {
                  label: 'Close file',
                  icon: ICONS.info,
                  keywords: 'pane editor hide',
                  run: () => pane?.close(active.id),
                },
              ],
            },
          ]
        : []),
      {
        heading: 'Keybindings',
        items: Object.entries(KEYBINDINGS).map(([id, k]) => ({
          label: `${k.name}…`,
          icon: ICONS.keybinding,
          hint: keyLabel(current.saved[id], isMac),
          keywords: `shortcut hotkey keybinding keyboard ${k.keywords} ${keyLabel(current.saved[id], isMac, true)}`,
          go: id,
        })),
      },
      {
        heading: 'Help',
        items: [{ label: 'About tabsh', icon: ICONS.info, keywords: 'version info', run: openAbout }],
      },
    ],
  }),
  theme: () => {
    const item = ([id, t]) => ({ label: t.name, key: 'theme', value: id, swatch: t.colors });
    const entries = Object.entries(THEMES);
    return {
      placeholder: 'Search themes…',
      groups: [
        { heading: 'System', items: entries.filter(([, t]) => t.system).map(item) },
        { heading: 'Dark', items: entries.filter(([, t]) => !t.system && !t.light).map(item) },
        { heading: 'Light', items: entries.filter(([, t]) => !t.system && t.light).map(item) },
      ],
    };
  },
  font: () => ({
    placeholder: 'Search fonts…',
    groups: [
      {
        heading: 'Font',
        items: Object.entries(FONTS).map(([id, f]) => ({
          label: f.name,
          key: 'font',
          value: id,
          hint: f.google ? 'Google Fonts' : 'System',
        })),
      },
    ],
  }),
  typingSound: () => ({
    placeholder: 'Search…',
    groups: [
      {
        heading: 'Typing sound',
        items: Object.entries(TYPING_SOUNDS).map(([id, name]) => ({ label: name, key: 'typingSound', value: id })),
      },
    ],
  }),
  fontSize: () => ({
    placeholder: 'Search sizes…',
    groups: [{ heading: 'Font size', items: FONT_SIZES.map((n) => ({ label: `${n}px`, key: 'fontSize', value: n })) }],
  }),
  ...Object.fromEntries(
    Object.entries(KEYBINDINGS).map(([id, k]) => [
      id,
      () => ({
        placeholder: 'Search shortcuts…',
        groups: [
          {
            heading: k.name,
            items: k.presets.map((combo) => ({
              label: keyLabel(combo, isMac),
              key: id,
              value: combo,
              keywords: keyLabel(combo, isMac, true),
            })),
          },
        ],
      }),
    ]),
  ),
};

const itemsById = new Map();
function showPage(name) {
  page = name;
  const { placeholder, groups } = PAGES[name]();
  paletteInput.value = '';
  paletteInput.placeholder = name === 'root' ? placeholder : `${placeholder}  (Esc to go back)`;
  itemsById.clear();
  let n = 0;
  paletteMenu.innerHTML = groups
    .map(
      (g, gi) => `
    <div role="group" aria-labelledby="pg-${gi}">
      <span role="heading" id="pg-${gi}">${g.heading}</span>
      ${g.items
        .map((item) => {
          const id = `pi-${n++}`;
          itemsById.set(id, item);
          const checked = item.key && current.saved[item.key] === item.value;
          const swatch = item.swatch
            ? `<span class="swatch" style="background:${item.swatch.background}">${[
                'red',
                'green',
                'yellow',
                'blue',
                'magenta',
              ]
                .map((c) => `<i style="background:${item.swatch[c]}"></i>`)
                .join('')}</span>`
            : '';
          return `<div role="menuitem" id="${id}" data-filter="${item.label}" data-keywords="${item.keywords ?? ''}"
                     ${item.go ? 'data-keep-command-open' : ''} ${checked ? 'data-checked="true"' : ''}>
          ${item.icon ?? swatch}<span>${item.label}</span>
          ${item.hint ? `<span data-shortcut>${item.hint}</span>` : ''}
          ${item.key ? `<span data-indicator>${CHECK}</span>` : ''}
        </div>`;
        })
        .join('')}
    </div>`,
    )
    .join('');
  paletteCmd.refresh?.();
  // Start on the current choice rather than the first entry.
  const current = paletteMenu.querySelector('[data-checked="true"]');
  if (current) {
    current.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    current.scrollIntoView({ block: 'nearest' });
  }
  if (name === 'root') applySettings(current.saved);
  paletteInput.focus();
  updatePaletteFades();
}

// Fade whichever end of the list has items scrolled out of view.
function updatePaletteFades() {
  const end = paletteMenu.scrollHeight - paletteMenu.clientHeight;
  paletteMenu.classList.toggle('fade-top', paletteMenu.scrollTop > 1);
  paletteMenu.classList.toggle('fade-bottom', paletteMenu.scrollTop < end - 1);
}
paletteMenu.addEventListener('scroll', updatePaletteFades, { passive: true });
// Filtering hides items after this handler's turn; measure once it has.
paletteInput.addEventListener('input', () => requestAnimationFrame(updatePaletteFades));
new ResizeObserver(updatePaletteFades).observe(paletteMenu);

function openPalette() {
  if (palette.open) return palette.close();
  document.getElementById('about').close();
  palette.showModal();
  setPreviewing(true);
  showPage('root');
}

// Live preview: whatever setting is highlighted (keyboard or mouse) is shown,
// or for typing sounds, heard once per highlight.
let previewed = null;
new MutationObserver(() => {
  const item = itemsById.get(paletteMenu.querySelector('[role="menuitem"].active')?.id);
  if (palette.open && item?.key) applySettings({ ...saved, [item.key]: item.value });
  if (palette.open && item?.key === 'typingSound' && item !== previewed) previewSound(item.value);
  previewed = item;
}).observe(paletteMenu, { subtree: true, attributes: true, attributeFilter: ['class'] });

// Runs before Basecoat's own click handler, which then closes the dialog
// unless the item is marked data-keep-command-open.
paletteMenu.addEventListener('click', (e) => {
  const el = e.target.closest('[role="menuitem"]');
  const item = el && el.getAttribute('aria-hidden') !== 'true' && itemsById.get(el.id);
  if (!item) return;
  if (item.go) showPage(item.go);
  else if (item.key) saveSetting(item.key, item.value);
  else item.run?.();
});

paletteInput.addEventListener('keydown', (e) => {
  const back = e.key === 'Escape' || (e.key === 'Backspace' && !paletteInput.value);
  if (back && page !== 'root') {
    e.preventDefault(); // also stops Escape from closing the dialog
    showPage('root');
  }
});

// Drag the divider to resize the pane. The width is live while dragging and
// saved once on release.
{
  const ws = document.getElementById('workspace'),
    divider = document.getElementById('pane-divider');
  let frac = null,
    frame = 0;
  const widthAt = (x) => {
    const r = ws.getBoundingClientRect();
    return Math.min(0.8, Math.max(0.2, (r.right - x) / r.width));
  };
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    ws.classList.add('dragging');
    frac = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (frac === null) return;
    frac = widthAt(e.clientX);
    ws.style.setProperty('--pane-width', String(frac));
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (active) sendSize(active);
    });
  });
  const end = (e) => {
    if (frac === null) return;
    const v = frac;
    frac = null;
    ws.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('paneWidth', v);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
}

// Closing without picking reverts any preview.
palette.addEventListener('close', () => {
  setPreviewing(false);
  applySettings(current.saved);
  active?.term.focus();
});

window.addEventListener(
  'keydown',
  (e) => {
    if (!matchesKey(e, current.saved.keyPalette)) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase: keep it away from the terminal
    openPalette();
  },
  true,
);

// The next/previous tab keybindings cycle through tabs, wrapping at the ends.
// (Ctrl+Tab and ⌘⇧[ ] belong to the browser and never reach the page.)
function cycleTab(step) {
  if (!sessions.length) return;
  const i = sessions.indexOf(active);
  activate(sessions[(i + step + sessions.length) % sessions.length]);
}
window.addEventListener(
  'keydown',
  (e) => {
    if (palette.open) return;
    const step = matchesKey(e, current.saved.keyNextTab) ? 1 : matchesKey(e, current.saved.keyPrevTab) ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase: keep it away from the terminal
    cycleTab(step);
  },
  true,
);

const settingsBtn = document.getElementById('settings-btn');
// Set on hover so it always shows the current keybinding.
settingsBtn.addEventListener('pointerenter', () => {
  settingsBtn.title = `Settings (${keyLabel(current.saved.keyPalette, isMac)})`;
});
settingsBtn.onclick = openPalette;

// ---- About ---------------------------------------------------------------

const about = document.getElementById('about');
about.addEventListener('close', () => active?.term.focus());

async function openAbout() {
  const info = await daemonFetch('/api/about')
    .then((r) => r.json())
    .catch(() => null);
  const up = info ? info.uptime_secs : 0;
  const uptime =
    up < 60
      ? `${up}s`
      : up < 3600
        ? `${Math.floor(up / 60)}m`
        : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
  const rows = info
    ? [
        ['Version', info.version],
        ['Shell', info.shell],
        ['State', info.state_path],
        ['Uptime', uptime],
        ['Sessions', `${info.sessions_running} running, ${info.sessions_total} total`],
        ['Settings', keyLabel(current.saved.keyPalette, isMac)],
        ['Switch tabs', `${keyLabel(current.saved.keyPrevTab, isMac)} / ${keyLabel(current.saved.keyNextTab, isMac)}`],
        ['Built with', 'Rust · axum · xterm.js · Basecoat'],
      ]
    : [['Status', 'Could not reach the tabsh daemon.']];
  const list = document.getElementById('about-list');
  list.replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement('tr'),
        th = document.createElement('th'),
        td = document.createElement('td');
      th.scope = 'row';
      th.textContent = k;
      td.textContent = v;
      tr.append(th, td);
      return tr;
    }),
  );
  about.showModal();
}

// ---- Drag and drop -------------------------------------------------------
// Dropping files on the terminal types their paths at the prompt (as a
// paste, so TUIs like Claude Code pick up image paths). Browsers never
// reveal a dropped file's real path, so files are uploaded to the daemon
// first and the saved copy's path is used.

const dropGlow = document.getElementById('drop-glow');
const isDroppable = (dt) => !!dt && ['Files', 'text/uri-list', 'text/plain'].some((t) => dt.types.includes(t));
const shellQuote = (p) => (/^[A-Za-z0-9_@%+=:,.\/-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

async function uploadFile(file) {
  const res = await daemonFetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  if (!res.ok) throw new Error(`upload ${file.name}: ${res.status}`);
  return (await res.json()).path;
}

// file:// URLs some apps put on the drag (no upload needed).
function localPaths(dt) {
  return (dt.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('file://'))
    .map((l) => {
      try {
        return decodeURIComponent(new URL(l).pathname);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function textForDrop(dt) {
  const local = localPaths(dt);
  if (local.length) return local.map(shellQuote).join(' ') + ' ';
  const files = [...dt.files];
  if (files.length) {
    const paths = await Promise.all(files.map(uploadFile));
    return paths.map(shellQuote).join(' ') + ' ';
  }
  return dt.getData('text/plain') || '';
}

window.addEventListener('dragenter', (e) => {
  if (isDroppable(e.dataTransfer)) dropGlow.classList.add('active');
});
window.addEventListener('dragover', (e) => {
  if (!isDroppable(e.dataTransfer)) return;
  dropGlow.classList.add('active');
  e.preventDefault(); // allow the drop (and stop the browser opening the file)
  const allowed = e.dataTransfer.effectAllowed;
  e.dataTransfer.dropEffect = allowed === 'move' || allowed === 'link' ? allowed : 'copy';
});
// relatedTarget is null only when the pointer leaves the window.
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropGlow.classList.remove('active');
});
window.addEventListener('dragend', () => dropGlow.classList.remove('active'));
window.addEventListener('drop', async (e) => {
  dropGlow.classList.remove('active');
  if (!isDroppable(e.dataTransfer)) return;
  e.preventDefault();
  const target = active;
  if (!target) return;
  try {
    const text = await textForDrop(e.dataTransfer);
    if (text && !target.closed) {
      target.term.paste(text);
      target.term.focus();
    }
  } catch (err) {
    console.error(err);
  }
});

document.querySelectorAll('[data-new-session]').forEach((b) => (b.onclick = newSession));
new ResizeObserver(() => active && requestAnimationFrame(() => sendSize(active))).observe(
  document.getElementById('terms'),
);
window.addEventListener('focus', () => {
  sync().catch(() => {});
  loadSettings().catch(() => {});
});
// Let a vertical mouse wheel scroll the tab strip sideways when it overflows.
const strip = document.getElementById('tabs');
strip.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  },
  { passive: false },
);

// Fade whichever edge has tabs hidden beyond it.
const updateFades = () => {
  const end = strip.scrollWidth - strip.clientWidth;
  strip.classList.toggle('fade-left', strip.scrollLeft > 1);
  strip.classList.toggle('fade-right', strip.scrollLeft < end - 1);
};
strip.addEventListener('scroll', updateFades, { passive: true });
strip.addEventListener('transitionend', updateFades); // tabs finished growing/shrinking
new ResizeObserver(updateFades).observe(strip);

// Reattach to the server's sessions (shells survive reloads; after a
// daemon restart they come back in their old directory with old output).
// Follow the system's light/dark switch live while the tabsh theme is on.
prefersLight?.addEventListener('change', () => current.applied.theme === 'tabsh' && applySettings(current.applied));

// Applied settings restyle every terminal and the file pane.
onApply((s) => {
  const opts = terminalOptions(s);
  for (const { term } of sessions) Object.assign(term.options, opts);
  document.getElementById('workspace').style.setProperty('--pane-width', String(s.paneWidth));
  pane?.applyTheme();
  if (active) sendSize(active);
});
// Fetch the chosen pack now so the first keystroke isn't silent.
onSaved((s) => {
  if (SOUND_PACKS[s.typingSound]) loadPack(s.typingSound).catch(() => {});
});

(async () => {
  const activeId = savedActive();
  applySettings(current.saved); // theme the connection screen before the daemon answers
  await waitForDaemon();
  await loadSettings().catch(() => applySettings(current.saved));
  await sync();
  if (!sessions.length) return newSession();
  activate(sessions.find((s) => s.id === activeId) ?? sessions[0]);
})();

// Clicking a dialog's backdrop closes it, and so does the About dialog's button.
for (const id of ['palette', 'about']) {
  const dialog = document.getElementById(id);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
document
  .querySelector('#about footer button')
  .addEventListener('click', (e) => e.currentTarget.closest('dialog').close());
