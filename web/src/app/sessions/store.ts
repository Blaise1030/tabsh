// The open tabs. The server (SQLite) owns the list of sessions; only which
// tab this browser has selected is kept locally.
import type { FitAddon as Fit } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { Card } from '../board/model.ts';
import { applyCard, cardOf, cardsChanged } from '../board/status.ts';
import { api } from '../daemon/client.ts';
import { loadedPane } from '../files/open.ts';
import { go, onPlace } from '../nav/router.ts';
import { clearBell, updateBadge } from './bell.ts';
import { layout, newTabGroup, shownSessions, stepTab } from './groups.ts';
import { orderTabs, setName, updateFades } from './tabs.ts';
import { adoptTag, labelsOf, setTags } from './tags.ts';
import { openSession } from './terminal.ts';

export interface Session {
  id: string;
  name: string;
  term: XTerm;
  fit: Fit;
  el: HTMLDivElement;
  tab: HTMLElement;
  ws: WebSocket | null;
  closed: boolean;
  replaying: boolean;
  // xterm is still parsing the replay: its answers to queries in it go nowhere.
  parsingReplay: boolean;
  esc: number;
  bell: boolean;
  card: Card;
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
}

const activateListeners: (() => void)[] = [];
// Runs after the active tab changes (or loses its last tab).
export function onActivate(fn: () => void): void {
  activateListeners.push(fn);
}

export const store: { sessions: Session[]; active: Session | null } = { sessions: [], active: null };

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
// false.
export async function openTab(
  body?: { cwd?: string; name?: string; prompt?: string; command?: string },
  focus = true,
): Promise<Session> {
  const { tag } = newTabGroup();
  const info = (await api<SessionInfo>('POST', '', body)) as SessionInfo;
  if (tag) adoptTag(info.id, tag);
  const s = openSession(info);
  // A sync may have opened it before the tag was stored: label it again.
  if (tag) setTags(s, labelsOf(s).tags);
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
// closed from another browser, and drops ones whose shell is gone.
export async function sync(): Promise<void> {
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
}

export function sendSize(s: Session): void {
  if (s !== store.active) return;
  s.fit.fit();
  if (s.ws?.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify({ cols: s.term.cols, rows: s.term.rows }));
  }
}

// Only the router's tab step calls this; everything else calls go().
export function activate(s: Session | null): void {
  const prev = store.active;
  if (prev) {
    prev.el.classList.remove('active');
    prev.tab.setAttribute('aria-selected', 'false');
  }
  store.active = s;
  loadedPane()?.show(s?.id ?? null);
  (document.getElementById('empty') as HTMLElement).hidden = !!s;
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
  // Collapse the tab, then drop it (the timeout covers reduced motion,
  // where no transition runs).
  s.tab.classList.add('leaving');
  const drop = () => {
    s.tab.remove();
    updateFades();
  };
  s.tab.addEventListener('transitionend', (e) => e.propertyName === 'max-width' && drop());
  setTimeout(drop, 300);
  const { sessions } = store;
  const i = sessions.indexOf(s);
  sessions.splice(i, 1);
  layout(); // drops its copies, and a group it was alone in
  if (store.active === s) {
    store.active = null;
    // The next shown tab after it, else the last shown one before it.
    const rest = shownSessions();
    const next = rest.find((t) => sessions.indexOf(t) >= i) ?? rest.at(-1);
    go({ tab: (next ?? sessions[Math.min(i, sessions.length - 1)])?.id ?? null }, 'replace');
  } else updateBadge();
  cardsChanged();
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
