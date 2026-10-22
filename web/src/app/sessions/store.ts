// The open tabs. The server (SQLite) owns the list of sessions; only which
// tab this browser has selected is kept locally.
import type { FitAddon as Fit } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import { type Accessor, batch, createSignal, type Setter } from 'solid-js';
import type { Card } from '../board/model.ts';
import { applyCard, cardOf } from '../board/status.ts';
import { api } from '../daemon/client.ts';
import { loadedPane } from '../files/open.tsx';
import { go, here, onPlace } from '../nav/router.ts';
import { clearBell, updateBadge } from './bell.ts';
import type { Coalescer } from './coalesce.ts';
import { newTabGroup, shownSessions, stepTab } from './groups.tsx';
import { coalesceAsync } from './reconnect.ts';
import { splitSessions } from './split.ts';
import { orderTabs, setName } from './tabs.ts';
import { adoptTag } from './tags.tsx';
import { openSession, syncTerminalVisibility } from './terminal.tsx';

// A tab's session holds live resources (xterm, the socket) and is never
// replaced; what its tab shows is in signals, each assigned whole.
export interface Session {
  id: string;
  name: Accessor<string>;
  setName: Setter<string>;
  term: XTerm;
  fit: Fit;
  el: HTMLDivElement;
  ws: WebSocket | null;
  // Live output on its way to xterm, written once a frame.
  out: Coalescer;
  closed: boolean;
  // How much of the shell's output this screen holds, named by the daemon's
  // epoch for it: a reattach asks for only what came after. Null when the
  // daemon doesn't count (an older one).
  stream: { epoch: string; at: number } | null;
  replaying: boolean;
  // xterm is still parsing the replay: its answers to queries in it go nowhere.
  parsingReplay: boolean;
  esc: number;
  bell: Accessor<boolean>;
  setBell: Setter<boolean>;
  // Output arrived while another tab was active.
  unread: Accessor<boolean>;
  setUnread: Setter<boolean>;
  card: Accessor<Card>;
  setCard: Setter<Card>;
  tags: Accessor<string[]>;
  setTags: Setter<string[]>;
  repo: Accessor<string | null>;
  setRepo: Setter<string | null>;
  // Closed: its tab collapses, then goes.
  leaving: Accessor<boolean>;
  setLeaving: Setter<boolean>;
  // A name the user chose: the shell's title doesn't replace it.
  pinned: boolean;
  // Set on a side terminal: the card it belongs to.
  parent: string | null;
  // How the card runs. A side terminal is always `tui`. Missing on an older
  // payload (the demo) reads as `tui`.
  mode: 'tui' | 'ui';
  // The card's side terminals, in position order. Empty on a side terminal.
  sides: Accessor<Session[]>;
  setSides: Setter<Session[]>;
}
export interface SessionInfo {
  id: string;
  name: string;
  status: string;
  status_at: number;
  note: string | null;
  cwd: string | null;
  pinned: boolean;
  // The card's first prompt and its agent's launch template, while it waits
  // in Backlog.
  pending_prompt?: string | null;
  pending_command?: string | null;
  // The agent it runs (its launch or resume command), if any.
  agent_command?: string | null;
  parent?: string | null;
  mode: 'tui' | 'ui';
}

const activateListeners: (() => void)[] = [];
// Runs after the active tab changes (or loses its last tab).
export function onActivate(fn: () => void): void {
  activateListeners.push(fn);
}

// The open tabs in strip order, replaced on open, close and reorder; and the
// active one, which only the router's tab step sets (through activate).
export const [sessionList, setSessionList] = createSignal<Session[]>([]);
export const [active, setActive] = createSignal<Session | null>(null);
// The terminal on screen: a side terminal named by the place, else the active card.
export const [screen, setScreen] = createSignal<Session | null>(null);
// A new value each time the tab or term step puts a terminal on screen, even
// the one already there: TermHost then fits and focuses it, and after the
// tab step brings its tab into view. Written after `screen`, so the
// terminal shows before this is heard.
export const [shownTurn, setShownTurn] = createSignal<{ tab: boolean }>({ tab: false });
export function onScreen(): Session | null {
  return screen();
}
// The card's agent is the chat panel: UI mode, and not a side terminal.
export function isChatCard(s: Session): boolean {
  return s.mode === 'ui' && s.parent === null;
}
export function findTerm(id: string): Session | undefined {
  for (const card of sessionList()) {
    if (card.id === id) return card;
    const side = card.sides().find((s) => s.id === id);
    if (side) return side;
  }
  return undefined;
}
export function allTerms(): Session[] {
  return sessionList().flatMap((card) => [card, ...card.sides()]);
}
export const store: { readonly sessions: Session[]; readonly active: Session | null } = {
  get sessions() {
    return sessionList();
  },
  get active() {
    return active();
  },
};
// The tab step found no tab to show: the empty state's cue. False until
// that step first runs, so the empty state stays hidden while tabs restore.
export const [noTab, setNoTab] = createSignal(false);
export function setSessions(next: Session[]): void {
  setSessionList(next);
}

const ACTIVE_KEY = 'tabsh.active';
const rememberActive = () => {
  try {
    localStorage.setItem(ACTIVE_KEY, store.active?.id ?? '');
  } catch {}
};
export const savedActive = (): string | null => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

// Opens a tab with `body`'s options in the active tab's group: grouped by
// tag, it gets that group's tag. It becomes the active tab unless `focus` is
// false. A sync may have opened it first: then that session is the tab.
export async function openTab(
  body?: {
    cwd?: string;
    name?: string;
    prompt?: string;
    command?: string;
    resume?: string;
    mode?: 'tui' | 'ui';
    acp_command?: string;
  },
  focus = true,
): Promise<Session> {
  const { tag } = newTabGroup();
  const info = (await api<SessionInfo>('POST', '', body)) as SessionInfo;
  if (tag) adoptTag(info.id, tag);
  const s = openSession(info);
  if (focus) go({ tab: s.id });
  return s;
}

// Opens a new tab; grouped by repo, its shell starts in the active group's
// repo (or the home directory, when that repo's folder is gone).
export async function newSession(): Promise<void> {
  const { cwd } = newTabGroup();
  await (cwd ? openTab({ cwd }).catch(() => openTab()) : openTab());
}

// Opens a new tab whose shell starts in `cwd`.
export async function newTabAt(cwd: string): Promise<void> {
  await openTab({ cwd }).catch(console.error);
}

// Bring the tab list in line with the server: picks up tabs opened or
// closed from another browser, and drops ones whose shell is gone. Overlapping
// callers (every socket dropping after sleep, window focus, board events)
// share one run so the page doesn't stampede the daemon.
export const sync = coalesceAsync(async () => {
  // Only sessions open before the list was asked for can be missing from it:
  // one opened while it was on its way is new, not gone.
  const askedCards = new Set(store.sessions);
  const askedSides = new Set(store.sessions.flatMap((s) => s.sides()));
  const list = (await api<SessionInfo[]>('GET', '')) ?? [];
  const { cards, sides } = splitSessions(list);
  const cardIds = new Set(cards.map((s) => s.id));
  for (const s of store.sessions.filter((s) => askedCards.has(s) && !cardIds.has(s.id))) removeSession(s);
  for (const info of cards) {
    const s = store.sessions.find((s) => s.id === info.id);
    if (s) {
      s.pinned = info.pinned;
      setName(s, info.name, false);
      applyCard(s, cardOf(info));
    } else openSession(info);
  }
  for (const card of store.sessions) {
    const want = sides.get(card.id) ?? [];
    const wantIds = new Set(want.map((s) => s.id));
    for (const side of card.sides().filter((s) => askedSides.has(s) && !wantIds.has(s.id))) removeSession(side);
    for (const info of want) {
      const s = card.sides().find((x) => x.id === info.id);
      if (s) {
        s.pinned = info.pinned;
        setName(s, info.name, false);
      } else openSession(info);
    }
  }
  orderTabs(cards.map((s) => s.id));
  if (!store.active && store.sessions.length) go({ tab: (shownSessions()[0] ?? store.sessions[0]).id }, 'replace');
});

// The size each socket last told its shell: every resize makes a full-screen
// program redraw, so an unchanged one isn't sent again.
const sentSize = new WeakMap<WebSocket, string>();

export function sendSize(s: Session): void {
  if (s !== onScreen()) return;
  s.fit.fit();
  const ws = s.ws;
  if (ws?.readyState !== WebSocket.OPEN) return;
  const { cols, rows } = s.term;
  if (sentSize.get(ws) === `${cols}x${rows}`) return;
  sentSize.set(ws, `${cols}x${rows}`);
  ws.send(JSON.stringify({ cols, rows }));
}

// Only the router's tab step calls this; everything else calls go().
export function activate(s: Session | null): void {
  batch(() => {
    setActive(s);
    setNoTab(!s);
    const termId = here().term;
    const side = s && termId ? s.sides().find((x) => x.id === termId) : undefined;
    setScreen(side ?? s);
    if (s) {
      const shown = screen() ?? s;
      shown.setUnread(false);
      setShownTurn({ tab: true });
    }
  });
  loadedPane()?.show(s?.id ?? null);
  updateBadge();
  if (s) {
    const shown = screen() ?? s;
    if (!document.hidden) clearBell(shown);
  }
  rememberActive();
  for (const fn of activateListeners) fn();
}

// A click on a tab: a move to it, or back to its terminal when it's already
// the active one (the URL doesn't change, so there's no navigation).
export function pick(s: Session): void {
  if (s === store.active) {
    if (onScreen() !== s) go({ term: null });
    else s.term.focus();
  } else go({ tab: s.id });
}

// The next/previous tab keybindings walk the shown tabs along the strip,
// wrapping at the ends.
export function cycleTab(step: 1 | -1): void {
  const next = stepTab(step);
  if (next) go({ tab: next.id });
}

export async function closeSession(s: Session): Promise<void> {
  // The file pane is the card's. A side terminal has nothing of its own to discard.
  if (!s.parent && !(loadedPane()?.confirmDiscard(s.id) ?? true)) return;
  // A running shell is killed and the server answers on the socket with
  // {"exit":true}; one that never started is just gone.
  await api('DELETE', `/${s.id}`).catch(() => {});
  if (s.ws?.readyState !== WebSocket.OPEN) removeSession(s);
}

function dropTerm(s: Session): void {
  s.closed = true;
  loadedPane()?.forget(s.id);
  s.ws?.close();
  s.out.drop(); // no frame writes to the disposed terminal
  s.term.dispose();
  // Its element leaves #terms with the list it leaves (TermHost).
}

export function removeSession(s: Session): void {
  if (s.closed) return;
  if (s.parent) {
    dropTerm(s);
    const card = store.sessions.find((c) => c.id === s.parent);
    if (card) card.setSides(card.sides().filter((t) => t !== s));
    if (screen() === s) {
      setScreen(card ?? null);
      go({ term: null }, 'replace');
    }
    return;
  }
  for (const side of [...s.sides()]) {
    if (!side.closed) dropTerm(side);
  }
  s.setSides([]);
  dropTerm(s);
  // Its tab collapses, then goes (the strip's exit).
  s.setLeaving(true);
  const i = store.sessions.indexOf(s);
  const sessions = store.sessions.filter((t) => t !== s);
  setSessions(sessions); // its copies, and a group it was alone in, go too
  if (store.active === s) {
    setActive(null);
    setScreen(null);
    // The next shown tab after it, else the last shown one before it.
    const rest = shownSessions();
    const next = rest.find((t) => sessions.indexOf(t) >= i) ?? rest.at(-1);
    go({ tab: (next ?? sessions[Math.min(i, sessions.length - 1)])?.id ?? null }, 'replace');
  } else updateBadge();
}

// The tab step: a tab the URL names that isn't open (closed, or never was)
// gives way to the first shown tab, and the URL is corrected.
export function initTabRouting(): void {
  onPlace('tab', (to) => {
    const s = store.sessions.find((s) => s.id === to.tab);
    if (s) {
      if (s !== store.active) activate(s);
      return;
    }
    const first = shownSessions()[0] ?? store.sessions[0] ?? null;
    activate(first);
    if ((first?.id ?? null) !== to.tab) return { tab: first?.id ?? null };
  });
}

function reveal(s: Session): void {
  s.setUnread(false);
  if (!document.hidden) clearBell(s);
  // The socket follows the terminal on screen, including a side terminal.
  syncTerminalVisibility();
  setShownTurn({ tab: false });
}

// After the tab step: `term` names a side terminal of that card, or the agent.
export function initTermRouting(): void {
  onPlace('term', (to) => {
    const card = store.sessions.find((s) => s.id === to.tab) ?? null;
    if (!card) {
      setScreen(null);
      return;
    }
    const side = to.term ? card.sides().find((s) => s.id === to.term) : undefined;
    if (to.term && !side) {
      setScreen(card);
      reveal(card);
      return { term: null };
    }
    const shown = side ?? card;
    setScreen(shown);
    reveal(shown);
  });
}
