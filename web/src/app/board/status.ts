// Each tab's card: its status on the tab (a glyph), archived tabs out of the
// strip, a bell when a card starts needing you, and listeners (the board).
import { api } from '../daemon/client.ts';
import { ring } from '../sessions/bell.ts';
import { layout } from '../sessions/groups.ts';
import type { Session, SessionInfo } from '../sessions/store.ts';
import { asStatus, type Card, type Status } from './model.ts';

const listeners: (() => void)[] = [];
export function onCardsChange(fn: () => void): void {
  listeners.push(fn);
}
export function cardsChanged(): void {
  for (const fn of listeners) fn();
}

export const cardOf = (info: SessionInfo): Card => ({
  status: asStatus(info.status),
  statusAt: info.status_at ?? 0,
  note: info.note ?? null,
  cwd: info.cwd ?? null,
});

// The tab's glyph, its title and `.archived` follow `s.card` (tab.ts).
export function applyCard(s: Session, card: Card): void {
  const before = s.card.val.status;
  s.card.val = card;
  // In or out of the strip and its groups.
  if ((before === 'archived') !== (card.status === 'archived')) layout();
  if (before !== 'needs_input' && card.status === 'needs_input') ring(s);
  cardsChanged();
}

// A drag on the board: always applies.
export async function setStatus(s: Session, status: Status): Promise<void> {
  const info = await api<SessionInfo>('PATCH', `/${s.id}/status`, { status, source: 'user' });
  if (info) applyCard(s, cardOf(info));
}
