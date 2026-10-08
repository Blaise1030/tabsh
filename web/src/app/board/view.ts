// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Its columns, cards and setup screen follow the sessions' states.
// Names and notes are user text: child strings only.
import van, { type State } from 'vanjs-core';
import { api } from '../daemon/client.ts';
import { go, onPlace } from '../nav/router.ts';
import { closeSession, newSession, openTab, type Session, sendSize, sessionList, store } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { matchesKey } from '../settings/keys.ts';
import { current, onSaved, saveSetting } from '../settings/settings.ts';
import { glyph, icons } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import { COLUMNS, DEFAULT_COMMAND, dropOrder, group, SETUP_PROMPT, type Status, shortPath, since } from './model.ts';
import { CardMoveButton } from './move-menu.ts';
import { setStatus } from './status.ts';

const { a, article, button, div, h2, header, i, p, section, span } = van.tags;

// Whether the board is shown (else the terminals are): set only by the
// router's view step.
export const shown: State<boolean> = van.state(false);
// Whether the active tab's terminal shows in a drawer beside the board: set
// only by the router's drawer step.
export const drawer: State<boolean> = van.state(false);
// Unix seconds, ticking every 30 s: keeps "time in status" fresh.
const now = van.state(Math.floor(Date.now() / 1000));
// Until the board is onboarded it shows its setup screen.
const onboarded = van.state(current.saved.boardOnboarded);

const board = () => document.getElementById('board') as HTMLElement;
// A dragged card's data type: its own, so the page's file drop
// (`ui/drop.ts`) neither glows for it nor pastes it into a terminal.
export const CARD_DRAG = 'application/x-tabsh-card';
// Set by Task 9; until then a column's + opens a plain new terminal.
let newCard: (status: Status) => void = () => void newSession();
export function setNewCard(fn: (status: Status) => void): void {
  newCard = fn;
}

export const boardOpen = (): boolean => shown.val;

export function toggleBoard(open = !boardOpen()): void {
  go({ view: open ? 'board' : 'terms' });
}

function showBoard(open: boolean): void {
  shown.val = open;
  if (open) return;
  // The terminals show once VanJS applies the state, in a microtask queued
  // before this one: fit and focus the active one then.
  queueMicrotask(() => {
    if (shown.val || !store.active) return;
    sendSize(store.active);
    store.active.term.focus();
  });
}

const statusGlyph = (status: Status | (() => Status)) =>
  i(
    { class: 'status-glyph', 'data-status': status },
    typeof status === 'function' ? () => glyph(status()) : glyph(status),
  );

// A small ghost button that keeps its click from opening the card.
const cardButton = (text: string, act: () => void) =>
  button(
    {
      type: 'button',
      class: 'btn',
      'data-variant': 'ghost',
      'data-size': 'sm',
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        act();
      },
      onkeydown: (e: KeyboardEvent) => e.stopPropagation(), // Enter/Space on the button must not open the card
    },
    text,
  );

// Each card's check for a cut-off title or note, run again whenever the
// board's size changes (shown, hidden, the window resized).
const measures = new WeakMap<Element, () => void>();
const resized = new ResizeObserver(() => {
  for (const c of board().querySelectorAll('.board-card')) measures.get(c)?.();
});

// A card: its session's name, status, folder, note and time in status. Its
// title and note are clamped to two lines, with Show more when either is cut
// off. In the Archive it isn't dragged, and offers Restore and Delete.
function Card(s: Session, archived = false): HTMLElement {
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = van.derive(() => s.card.val.status);
  const note = van.derive(() => s.card.val.note);
  const open = van.state(false);
  const cut = van.state(false);
  const card: HTMLElement = article(
    {
      class: 'board-card',
      draggable: !archived,
      tabindex: '0',
      'data-id': s.id,
      onclick: () => go({ tab: s.id, drawer: true }),
      onkeydown: (e: KeyboardEvent) => e.target === card && e.key === 'Enter' && card.click(),
      ondragstart: (e: DragEvent) => {
        e.dataTransfer?.setData(CARD_DRAG, s.id);
        card.classList.add('dragging');
      },
      ondragend: () => {
        card.classList.remove('dragging');
        clearDropMarks();
      },
    },
    div(
      { class: 'card-top' },
      span({ class: 'card-title' }, () => s.name.val),
      CardMoveButton(s, () => status.val),
    ),
    div(
      { class: 'card-meta' },
      icons.folder(),
      span(() => shortPath(s.card.val.cwd) || '~'),
    ),
    () => (note.val ? div({ class: 'card-note' }, note.val) : ''),
    () =>
      cut.val || open.val
        ? button(
            {
              type: 'button',
              class: 'card-more',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                open.val = !open.val;
              },
              onkeydown: (e: KeyboardEvent) => e.stopPropagation(), // Enter/Space on the button must not open the card
            },
            () => (open.val ? 'Show less' : 'Show more'),
          )
        : '',
    div({ class: 'card-meta' }, () => since(s.card.val.statusAt, now.val)),
    archived
      ? div(
          { class: 'card-actions' },
          cardButton('Restore', () => void setStatus(s, 'backlog')),
          cardButton('Delete', () => void closeSession(s)),
        )
      : () =>
          status.val === 'completed'
            ? div(
                { class: 'card-actions' },
                cardButton('Archive', () => void setStatus(s, 'archived')),
              )
            : '',
  );
  // A clamped box reports no overflow in scrollHeight, so this compares its
  // text's height with the clamp lifted. Hidden (height 0), nothing is cut.
  const measure = () => {
    const texts = [...card.querySelectorAll<HTMLElement>('.card-title, .card-note')];
    const heights = () => texts.map((t) => t.clientHeight);
    card.classList.remove('expanded');
    const clamped = heights();
    card.classList.add('expanded');
    const full = heights();
    card.classList.toggle('expanded', open.val);
    cut.val = full.some((h, j) => h > clamped[j] + 1);
  };
  measures.set(card, measure);
  van.derive(() => card.classList.toggle('expanded', open.val));
  van.derive(() => {
    s.name.val;
    note.val;
    requestAnimationFrame(measure); // once the new text is laid out
  });
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

// A drop ends the drag here, not at dragend: the drop may move the dragged
// card's node (a new order), and some browsers then never fire its dragend.
function endDrag(): void {
  clearDropMarks();
  for (const x of board().querySelectorAll('.dragging')) x.classList.remove('dragging');
}

// The tabs as the board's model takes them: each with its card.
const cards = () => store.sessions.map((s) => ({ s, id: s.id, card: s.card.val }));

async function move(id: string, status: Status, beforeId: string | null): Promise<void> {
  const s = store.sessions.find((x) => x.id === id);
  if (!s) return;
  const ids = dropOrder(cards(), id, status, beforeId);
  orderTabs(ids);
  api('PUT', '/order', { ids }).catch(() => {});
  if (s.card.val.status !== status) await setStatus(s, status).catch(console.error);
}

// Puts a card first in `status`'s column (a new card, so it's seen without
// scrolling): in the tab order, before that column's first card.
export function moveToTop(s: Session, status: Status): Promise<void> {
  const first = cards().find((x) => x.id !== s.id && x.card.status === status);
  return move(s.id, status, first?.id ?? null);
}

// The sessions in each column, in tab order.
type Columns = Record<Status, Session[]>;

function Column(status: Status, name: string, columns: State<Columns>): HTMLElement {
  const list = div({ class: 'board-cards' });
  keyed(
    list,
    () => columns.val[status],
    (s) => s.id,
    (s) => Card(s),
  );
  const col: HTMLElement = section(
    {
      class: 'board-col',
      'data-status': status,
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        clearDropMarks();
        const before = cardBefore(list, e.clientY);
        if (before) before.classList.add('drop-before');
        else list.classList.add('drop-end');
      },
      ondragleave: (e: DragEvent) => !col.contains(e.relatedTarget as Node) && clearDropMarks(),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        const before = cardBefore(list, e.clientY)?.dataset.id ?? null; // while the dragged card is still marked
        endDrag();
        const id = e.dataTransfer?.getData(CARD_DRAG);
        if (id) void move(id, status, before);
      },
    },
    header(
      statusGlyph(status),
      span({ class: 'col-name' }, name),
      span({ class: 'col-count' }, () => String(columns.val[status].length)),
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'ghost',
          'data-size': 'icon-xs',
          title: `New card in ${name}`,
          'aria-label': `New card in ${name}`,
          onclick: () => newCard(status),
        },
        '+',
      ),
    ),
    list,
  );
  return col;
}

// Archived cards, collapsed under a toggle; a card dropped here is archived.
function Archive(columns: State<Columns>): HTMLElement {
  const open = van.state(false);
  // `display: contents`: the cards sit in the column, after the toggle.
  const list = div({ class: 'archive-cards' });
  keyed(
    list,
    () => (open.val ? columns.val.archived : []),
    (s) => s.id,
    (s) => Card(s, true),
  );
  const col: HTMLElement = section(
    {
      class: 'board-col archive',
      'data-status': 'archived',
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        clearDropMarks();
        col.classList.add('drop-end');
      },
      ondragleave: (e: DragEvent) => !col.contains(e.relatedTarget as Node) && clearDropMarks(),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        endDrag();
        const id = e.dataTransfer?.getData(CARD_DRAG);
        if (id) void move(id, 'archived', null);
      },
    },
    button(
      { type: 'button', class: 'archive-toggle', onclick: () => (open.val = !open.val) },
      () => `Archive ${columns.val.archived.length} ${open.val ? '▾' : '▸'}`,
    ),
    list,
  );
  return col;
}

// Until the board is onboarded (the `boardOnboarded` setting), it shows this
// instead of its columns: one button opens a Claude Code card that wires its
// own hooks through `tabsh setup`, the other skips it. Either one marks the
// board onboarded.
const BOARD_DOCS = 'https://github.com/Blaise1030/tabsh#the-board';

function Onboarding(): HTMLElement {
  const busy = van.state(false);
  async function setUp(): Promise<void> {
    busy.val = true;
    let s: Session;
    try {
      s = await openTab({ name: 'Set up tabsh hooks', prompt: SETUP_PROMPT, command: DEFAULT_COMMAND }, false);
    } catch (err) {
      console.error(err);
      busy.val = false;
      return;
    }
    saveSetting('boardOnboarded', true);
    await setStatus(s, 'in_progress').catch(console.error); // starts its agent
    go({ view: 'terms', tab: s.id });
  }
  // The shape of shadcn's Empty: header (icon, title, description), content, link.
  return div(
    { class: 'board-onboarding' },
    div(
      { class: 'board-onboarding-header' },
      div({ class: 'board-onboarding-icon' }, icons.boardOnboarding()),
      h2('Connect your agents'),
      p(
        'Cards move on their own when your coding agent reports what it is doing. Let Claude Code wire up its own hooks to get started.',
      ),
    ),
    div(
      { class: 'board-onboarding-actions' },
      button(
        { type: 'button', class: 'btn', 'data-size': 'sm', disabled: () => busy.val, onclick: () => void setUp() },
        'Set up with Claude Code',
      ),
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          'data-size': 'sm',
          onclick: () => saveSetting('boardOnboarded', true),
        },
        'Skip',
      ),
    ),
    a(
      { class: 'board-onboarding-more', href: BOARD_DOCS, target: '_blank', rel: 'noopener noreferrer' },
      'Learn more',
      icons.arrowUpRight(),
    ),
  );
}

// The board's parts: its setup screen, or its columns and the Archive.
const PARTS = [...COLUMNS.map((c) => c.status), 'archived'];

export function Board(): HTMLElement {
  const sessions = van.derive((): Columns => {
    const g = group(sessionList.val.map((s) => ({ s, card: s.card.val })));
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.s)])) as Columns;
  });
  const el = section({ id: 'board', 'aria-label': 'Board', hidden: () => !shown.val });
  resized.observe(el);
  keyed(
    el,
    () => (onboarded.val ? PARTS : ['onboarding']),
    (part) => part,
    (part) => {
      if (part === 'onboarding') return Onboarding();
      if (part === 'archived') return Archive(sessions);
      const c = COLUMNS.find((x) => x.status === part) as (typeof COLUMNS)[number];
      return Column(c.status, c.name, sessions);
    },
  );
  return el;
}

export function initBoard(): void {
  onPlace('view', (to) => void showBoard(to.view === 'board'));
  onPlace('drawer', (to) => {
    drawer.val = to.drawer;
    if (to.drawer) queueMicrotask(() => store.active?.term.focus()); // once VanJS shows it
    return undefined;
  });
  (document.getElementById('board-btn') as HTMLButtonElement).onclick = () => toggleBoard();
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
  onSaved((s) => (onboarded.val = s.boardOnboarded)); // e.g. the setup screen, once it's dealt with
  setInterval(() => (now.val = Math.floor(Date.now() / 1000)), 30_000);
}
