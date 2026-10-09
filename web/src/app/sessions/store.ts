// The open tabs. The server (SQLite) owns the list of sessions; only which
// tab this browser has selected is kept locally.
import type { FitAddon as Fit } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import van, { type State } from 'vanjs-core';
import type { Card } from '../board/model.ts';
import { applyCard, cardOf } from '../board/status.ts';
import { api } from '../daemon/client.ts';
import { loadedPane } from '../files/open.ts';
import { go, onPlace } from '../nav/router.ts';
import { clearBell, updateBadge } from './bell.ts';
import { newTabGroup, scrollToTab, shownSessions, stepTab } from './groups.ts';
import { coalesceAsync } from './reconnect.ts';
import { orderTabs, setName } from './tabs.ts';
import { adoptTag } from './tags.ts';
import { openSession } from './terminal.ts';

// A tab's session holds live resources (xterm, the socket) and is never
// replaced; what its tab shows is in states, each assigned whole.
export interface Session {
  id: string;
  name: State<string>;
  term: XTerm;
  fit: Fit;
  el: HTMLDivElement;
  ws: WebSocket | null;
  closed: boolean;
  replaying: boolean;
  // xterm is still parsing the replay: its answers to queries in it go nowhere.
  parsingReplay: boolean;
  esc: number;
  bell: State<boolean>;
  // Output arrived while another tab was active.
  unread: State<boolean>;
  card: State<Card>;
  tags: State<string[]>;
  repo: State<string | null>;
  // Closed: its tab collapses, then goes.
  leaving: State<boolean>;
  // A name the user chose: the shell's title doesn't replace it.
  pinned: boolean;
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
}

const activateListeners: (() => void)[] = [];
// Runs after the active tab changes (or loses its last tab).
export function onActivate(fn: () => void): void {
  activateListeners.push(fn);
}

// The open tabs in strip order, replaced on open, close and reorder; and the
// active one, which only the router's tab step sets (through activate).
export const sessionList: State<Session[]> = van.state([]);
export const active: State<Session | null> = van.state(null);
export const store: { readonly sessions: Session[]; readonly active: Session | null } = {
  get sessions() {
    return sessionList.val;
  },
  get active() {
    return active.val;
  },
};
// The tab step found no tab to show: the empty state's cue. False until
// that step first runs, so the empty state stays hidden while tabs restore.
export const noTab: State<boolean> = van.state(false);
export function setSessions(next: Session[]): void {
  sessionList.val = next;
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
  body?: { cwd?: string; name?: string; prompt?: string; command?: string; resume?: string },
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
  // Only tabs open before the list was asked for can be missing from it: one
  // opened while it was on its way is new, not gone.
  const asked = new Set(store.sessions);
  const list = (await api<SessionInfo[]>('GET', '')) ?? [];
  const ids = new Set(list.map((s) => s.id));
  for (const s of store.sessions.filter((s) => asked.has(s) && !ids.has(s.id))) removeSession(s);
  for (const info of list) {
    const s = store.sessions.find((s) => s.id === info.id);
    if (s) {
      s.pinned = info.pinned;
      setName(s, info.name, false);
      applyCard(s, cardOf(info));
    } else openSession(info);
  }
  orderTabs(list.map((s) => s.id));
  if (!store.active && store.sessions.length) go({ tab: (shownSessions()[0] ?? store.sessions[0]).id }, 'replace');
});

export function sendSize(s: Session): void {
  if (s !== store.active) return;
  s.fit.fit();
  if (s.ws?.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify({ cols: s.term.cols, rows: s.term.rows }));
  }
}

// Only the router's tab step calls this; everything else calls go().
export function activate(s: Session | null): void {
  active.val = s;
  noTab.val = !s;
  loadedPane()?.show(s?.id ?? null);
  updateBadge();
  if (s) {
    s.unread.val = false;
    if (!document.hidden) clearBell(s);
    // Its terminal (and a new tab) shows once VanJS applies the states, in a
    // microtask queued before this one: scroll to its tab, fit and focus it
    // then.
    queueMicrotask(() => {
      if (active.val !== s) return;
      scrollToTab(s);
      sendSize(s);
      s.term.focus();
    });
  }
  rememberActive();
  for (const fn of activateListeners) fn();
}

// A click on a tab: a move to it, or back to its terminal when it's already
// the active one (the URL doesn't change, so there's no navigation).
export function pick(s: Session): void {
  if (s === store.active) s.term.focus();
  else go({ tab: s.id });
}

// The next/previous tab keybindings walk the shown tabs along the strip,
// wrapping at the ends.
export function cycleTab(step: 1 | -1): void {
  const next = stepTab(step);
  if (next) go({ tab: next.id });
}

export async function closeSession(s: Session): Promise<void> {
  if (!(loadedPane()?.confirmDiscard(s.id) ?? true)) return;
  // A running shell is killed and the server answers on the socket with
  // {"exit":true}; one that never started is just gone.
  await api('DELETE', `/${s.id}`).catch(() => {});
  if (s.ws?.readyState !== WebSocket.OPEN) removeSession(s);
}

export function removeSession(s: Session): void {
  if (s.closed) return;
  s.closed = true;
  loadedPane()?.forget(s.id);
  s.ws?.close();
  s.term.dispose();
  s.el.remove();
  // Its tab collapses, then goes (the strip's exit).
  s.leaving.val = true;
  const i = store.sessions.indexOf(s);
  const sessions = store.sessions.filter((t) => t !== s);
  setSessions(sessions); // its copies, and a group it was alone in, go too
  if (store.active === s) {
    active.val = null;
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
