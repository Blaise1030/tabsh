// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Names and notes are user text: textContent only.
import { api } from '../daemon/client.ts';
import { activate, closeSession, newSession, type Session, sendSize, store } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { matchesKey } from '../settings/keys.ts';
import { current } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { glyphSvg } from './glyph.ts';
import { COLUMNS, dropOrder, group, type Status, shortPath, since } from './model.ts';
import { onCardsChange, setStatus } from './status.ts';

const board = () => document.getElementById('board') as HTMLElement;
const terms = () => document.getElementById('terms') as HTMLElement;
const button = () => document.getElementById('board-btn') as HTMLButtonElement;
let archiveOpen = false;
// Set by Task 9; until then a column's + opens a plain new terminal.
let newCard: (status: Status) => void = () => void newSession();
export function setNewCard(fn: (status: Status) => void): void {
  newCard = fn;
}

export const boardOpen = (): boolean => !board().hidden;

export function toggleBoard(open = !boardOpen()): void {
  board().hidden = !open;
  terms().hidden = open;
  button().setAttribute('aria-pressed', String(open));
  if (open) render();
  else if (store.active) {
    sendSize(store.active);
    store.active.term.focus();
  }
}

function glyph(status: Status): HTMLElement {
  const g = el('i', { className: 'status-glyph' });
  g.dataset.status = status;
  g.innerHTML = glyphSvg(status); // static markup from glyph.ts
  return g;
}

const FOLDER =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

function cardEl(s: Session, now: number): HTMLElement {
  const top = el(
    'div',
    { className: 'card-top' },
    el('span', { className: 'card-title', textContent: s.name }),
    glyph(s.card.status),
  );
  const folder = el('div', { className: 'card-meta' });
  folder.innerHTML = FOLDER; // static icon
  folder.append(el('span', { textContent: shortPath(s.card.cwd) || '~' }));
  const kids: HTMLElement[] = [top, folder];
  if (s.card.note) kids.push(el('div', { className: 'card-note', textContent: s.card.note }));
  kids.push(el('div', { className: 'card-meta', textContent: since(s.card.statusAt, now) }));
  const card = el('article', { className: 'board-card', draggable: true, tabIndex: 0 }, ...kids);
  card.dataset.id = s.id;
  card.onclick = () => {
    toggleBoard(false);
    activate(s);
  };
  card.onkeydown = (e) => e.target === card && e.key === 'Enter' && card.click();
  if (s.card.status === 'completed') {
    const arch = el('button', { type: 'button', className: 'btn', textContent: 'Archive' });
    arch.dataset.variant = 'ghost';
    arch.dataset.size = 'sm';
    arch.onclick = (e) => {
      e.stopPropagation();
      void setStatus(s, 'archived');
    };
    arch.onkeydown = (e) => e.stopPropagation(); // Enter/Space on the button must not open the card
    card.append(el('div', { className: 'card-actions' }, arch));
  }
  card.ondragstart = (e) => {
    e.dataTransfer?.setData('text/plain', s.id);
    card.classList.add('dragging');
  };
  card.ondragend = () => {
    card.classList.remove('dragging');
    render();
  };
  return card;
}

// The card the pointer is above the middle of, in `list`: the drop goes
// before it (null: at the end).
function cardBefore(list: HTMLElement, y: number): HTMLElement | null {
  for (const c of list.querySelectorAll<HTMLElement>('.board-card:not(.dragging)')) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) return c;
  }
  return null;
}

function clearDropMarks(): void {
  for (const x of board().querySelectorAll('.drop-before, .drop-end')) x.classList.remove('drop-before', 'drop-end');
}

async function move(id: string, status: Status, beforeId: string | null): Promise<void> {
  const s = store.sessions.find((x) => x.id === id);
  if (!s) return;
  const ids = dropOrder(store.sessions, id, status, beforeId);
  orderTabs(ids);
  api('PUT', '/order', { ids }).catch(() => {});
  if (s.card.status !== status) await setStatus(s, status).catch(console.error);
  else render();
}

function column(status: Status, name: string, cards: Session[], now: number): HTMLElement {
  const add = el('button', { type: 'button', className: 'btn', title: `New card in ${name}`, textContent: '+' });
  add.dataset.variant = 'ghost';
  add.dataset.size = 'icon-xs';
  add.setAttribute('aria-label', `New card in ${name}`);
  add.onclick = () => newCard(status);
  const header = el(
    'header',
    {},
    glyph(status),
    el('span', { className: 'col-name', textContent: name }),
    el('span', { className: 'col-count', textContent: String(cards.length) }),
    add,
  );
  const list = el('div', { className: 'board-cards' }, ...cards.map((s) => cardEl(s, now)));
  const col = el('section', { className: 'board-col' }, header, list);
  col.dataset.status = status;
  col.ondragover = (e) => {
    e.preventDefault();
    clearDropMarks();
    const before = cardBefore(list, e.clientY);
    if (before) before.classList.add('drop-before');
    else list.classList.add('drop-end');
  };
  col.ondragleave = (e) => !col.contains(e.relatedTarget as Node) && clearDropMarks();
  col.ondrop = (e) => {
    e.preventDefault();
    clearDropMarks();
    const id = e.dataTransfer?.getData('text/plain');
    if (id) void move(id, status, cardBefore(list, e.clientY)?.dataset.id ?? null);
  };
  return col;
}

function archive(cards: Session[], now: number): HTMLElement {
  const toggle = el('button', {
    type: 'button',
    className: 'archive-toggle',
    textContent: `Archive ${cards.length} ${archiveOpen ? '▾' : '▸'}`,
  });
  toggle.onclick = () => {
    archiveOpen = !archiveOpen;
    render();
  };
  const col = el('section', { className: 'board-col archive' }, toggle);
  col.dataset.status = 'archived';
  col.ondragover = (e) => {
    e.preventDefault();
    clearDropMarks();
    col.classList.add('drop-end');
  };
  col.ondragleave = (e) => !col.contains(e.relatedTarget as Node) && clearDropMarks();
  col.ondrop = (e) => {
    e.preventDefault();
    clearDropMarks();
    const id = e.dataTransfer?.getData('text/plain');
    if (id) void move(id, 'archived', null);
  };
  if (archiveOpen) {
    for (const s of cards) {
      const restore = el('button', { type: 'button', className: 'btn', textContent: 'Restore' });
      const del = el('button', { type: 'button', className: 'btn', textContent: 'Delete' });
      for (const b of [restore, del]) {
        b.dataset.variant = 'ghost';
        b.dataset.size = 'sm';
      }
      restore.onclick = (e) => {
        e.stopPropagation();
        void setStatus(s, 'backlog');
      };
      del.onclick = (e) => {
        e.stopPropagation();
        void closeSession(s);
      };
      const card = cardEl(s, now);
      card.draggable = false;
      card.append(el('div', { className: 'card-actions' }, restore, del));
      col.append(card);
    }
  }
  return col;
}

export function render(): void {
  if (!boardOpen() || board().querySelector('.dragging')) return;
  const now = Math.floor(Date.now() / 1000);
  const g = group(store.sessions);
  board().replaceChildren(
    ...COLUMNS.map(({ status, name }) => column(status, name, g[status], now)),
    archive(g.archived, now),
  );
}

export function initBoard(): void {
  button().onclick = () => toggleBoard();
  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesKey(e, current.saved.keyToggleBoard) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      toggleBoard();
    },
    true,
  );
  onCardsChange(render);
  setInterval(render, 30_000); // keep "time in status" fresh
}
