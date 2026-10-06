// Each tab's card: its status on the tab (a glyph), archived tabs out of the
// strip, a bell when a card starts needing you, and listeners (the board).
import { api } from '../daemon/client.ts';
import { ring } from '../sessions/bell.ts';
import type { Session, SessionInfo } from '../sessions/store.ts';
import { glyphSvg, STATUS_NAMES } from './glyph.ts';
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

export function applyCard(s: Session, card: Card): void {
  const before = s.card?.status;
  s.card = card;
  const glyph = s.tab.querySelector('.tab-status') as HTMLElement;
  if (glyph.dataset.status !== card.status) {
    glyph.dataset.status = card.status;
    glyph.innerHTML = glyphSvg(card.status); // static markup from glyph.ts
  }
  glyph.title = card.note ? `${STATUS_NAMES[card.status]}: ${card.note}` : STATUS_NAMES[card.status];
  s.tab.classList.toggle('archived', card.status === 'archived');
  if (before && before !== 'needs_input' && card.status === 'needs_input') ring(s);
  cardsChanged();
}

// A drag on the board: always applies.
export async function setStatus(s: Session, status: Status): Promise<void> {
  const info = await api<SessionInfo>('PATCH', `/${s.id}/status`, { status, source: 'user' });
  if (info) applyCard(s, cardOf(info));
}
