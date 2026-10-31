// Card status changes pushed by the daemon (hooks, other browsers). A
// dropped socket reconnects and re-reads the list, so nothing is missed. A
// hook moving a card to Needs input or Completed notifies (notify.ts). A
// hook's move puts the card last in its new column, as the daemon does.
// It also carries each session's activity (output, throttled, and bells), so
// a parked tab, which has no socket, still shows unread and rings, and is
// renamed by the title its shell sets (a card dragged to In progress starts
// its agent with no terminal on screen). A card made elsewhere (another
// browser, or `tabsh new`) arrives whole and is added where it is.
import { boardEventsUrl } from '../daemon/client.ts';
import { type ActivityKind, activityEffect } from '../sessions/activity.ts';
import { ring } from '../sessions/bell.ts';
import { findTerm, onScreen, type SessionInfo, store, sync } from '../sessions/store.ts';
import { orderTabs, setName } from '../sessions/tabs.ts';
import { openSession, parkedMs } from '../sessions/terminal.tsx';
import { asStatus, dropOrder } from './model.ts';
import { notifyStatus } from './notify.ts';
import { applyCard } from './status.ts';

// Keyed by `session`, not `id`, so pages from before it ignore it.
interface ActivityEvent {
  session: string;
  activity: ActivityKind;
  /** How long ago the output it reports came (a trailing signal). */
  age_ms: number;
  /** The title its shell set since the last signal, if it changed. */
  title?: string;
}

// Keyed by `created`, not `id`, so pages from before it ignore it.
interface CreatedEvent {
  created: SessionInfo;
}

interface BoardEvent {
  id: string;
  status: string;
  status_at: number;
  note: string | null;
  source?: 'user' | 'hook';
  resync?: boolean;
}

export function initBoardEvents(): void {
  const ws = new WebSocket(boardEventsUrl());
  ws.onopen = () => void sync().catch(() => {});
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data) as BoardEvent | ActivityEvent | CreatedEvent;
    if ('activity' in ev) return onActivity(ev);
    // Added, not re-read: a sync would undo the order a page just gave a
    // card it made itself. openSession keeps one per id, so the page that
    // made it, whichever arrives first, still has one.
    if ('created' in ev) return void openSession(ev.created);
    if (ev.resync) return void sync().catch(() => {});
    const s = store.sessions.find((x) => x.id === ev.id);
    if (!s) return;
    const before = s.card().status;
    const status = asStatus(ev.status);
    if (ev.source === 'hook' && status !== before) {
      const items = store.sessions.map((x) => ({ id: x.id, card: x.card() }));
      orderTabs(dropOrder(items, s.id, status, null));
    }
    applyCard(s, { ...s.card(), status, statusAt: ev.status_at, note: ev.note });
    if (ev.source === 'hook' && status !== before) notifyStatus(s, status, ev.note);
  };
  ws.onclose = () => setTimeout(initBoardEvents, 1000);
}

function onActivity(ev: ActivityEvent): void {
  const s = findTerm(ev.session);
  if (!s) return;
  const target = { closed: s.closed, parkedMs: parkedMs(s), active: s === onScreen() };
  const effect = activityEffect(target, ev.activity, ev.age_ms ?? 0);
  if (effect.unread) s.setUnread(true);
  if (effect.ring) ring(s);
  // As terminal.ts does with xterm's title, which a parked tab doesn't have.
  if (ev.title && !s.closed && !s.pinned && parkedMs(s) !== null) setName(s, ev.title);
}
