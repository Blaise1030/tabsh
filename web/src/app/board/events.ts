// Card status changes pushed by the daemon (hooks, other browsers). A
// dropped socket reconnects and re-reads the list, so nothing is missed. A
// hook moving a card to Needs input or Completed notifies (notify.ts). A
// hook's move puts the card last in its new column, as the daemon does.
// It also carries each session's activity (output, throttled, and bells), so
// a parked tab, which has no socket, still shows unread and rings.
import { boardEventsUrl } from '../daemon/client.ts';
import { activityEffect } from '../sessions/activity.ts';
import { ring } from '../sessions/bell.ts';
import { store, sync } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { asStatus, dropOrder } from './model.ts';
import { notifyStatus } from './notify.ts';
import { applyCard } from './status.ts';

interface ActivityEvent {
  id: string;
  activity: string;
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
    const ev = JSON.parse(e.data) as BoardEvent | ActivityEvent;
    if ('activity' in ev) return onActivity(ev);
    if (ev.resync) return void sync().catch(() => {});
    const s = store.sessions.find((x) => x.id === ev.id);
    if (!s) return;
    const before = s.card.val.status;
    const status = asStatus(ev.status);
    if (ev.source === 'hook' && status !== before) {
      const items = store.sessions.map((x) => ({ id: x.id, card: x.card.val }));
      orderTabs(dropOrder(items, s.id, status, null));
    }
    applyCard(s, { ...s.card.val, status, statusAt: ev.status_at, note: ev.note });
    if (ev.source === 'hook' && status !== before) notifyStatus(s, status, ev.note);
  };
  ws.onclose = () => setTimeout(initBoardEvents, 1000);
}

function onActivity(ev: ActivityEvent): void {
  const s = store.sessions.find((x) => x.id === ev.id);
  const effect = activityEffect(
    s && { closed: s.closed, parked: !s.ws || s.ws.readyState >= WebSocket.CLOSING, active: s === store.active },
    ev.activity,
  );
  if (!s) return;
  if (effect.unread) s.unread.val = true;
  if (effect.ring) ring(s);
}
