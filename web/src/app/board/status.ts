// Each tab's card: its status on the tab (a glyph), archived tabs out of the
// strip, and a bell when a card starts needing you. The board follows `s.card`.
import { api } from '../daemon/client.ts';
import { ring } from '../sessions/bell.ts';
import type { Session, SessionInfo } from '../sessions/store.ts';
import { asStatus, type Card, type Status } from './model.ts';

export const cardOf = (info: SessionInfo): Card => ({
  status: asStatus(info.status),
  statusAt: info.status_at ?? 0,
  note: info.note ?? null,
  cwd: info.cwd ?? null,
  prompt: info.pending_prompt ?? null,
  command: info.pending_command ?? null,
  agent: info.agent_command ?? null,
});

// The tab's glyph, its title and `.archived` follow `s.card` (tab.ts), as
// does the board.
export function applyCard(s: Session, card: Card): void {
  const before = s.card.val.status;
  s.card.val = card; // an archived one leaves the strip and its groups
  if (before !== 'needs_input' && card.status === 'needs_input') ring(s);
}

// A drag on the board: always applies.
export async function setStatus(s: Session, status: Status): Promise<void> {
  const info = await api<SessionInfo>('PATCH', `/${s.id}/status`, { status, source: 'user' });
  if (info) applyCard(s, cardOf(info));
}
