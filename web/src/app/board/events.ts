// Card status changes pushed by the daemon (hooks, other browsers). A
// dropped socket reconnects and re-reads the list, so nothing is missed.
import { boardEventsUrl } from '../daemon/client.ts';
import { store, sync } from '../sessions/store.ts';
import { asStatus } from './model.ts';
import { applyCard } from './status.ts';

interface BoardEvent {
  id: string;
  status: string;
  status_at: number;
  note: string | null;
  resync?: boolean;
}

export function initBoardEvents(): void {
  const ws = new WebSocket(boardEventsUrl());
  ws.onopen = () => void sync().catch(() => {});
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data) as BoardEvent;
    if (ev.resync) return void sync().catch(() => {});
    const s = store.sessions.find((x) => x.id === ev.id);
    if (s) applyCard(s, { ...s.card, status: asStatus(ev.status), statusAt: ev.status_at, note: ev.note });
  };
  ws.onclose = () => setTimeout(initBoardEvents, 1000);
}
