// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Its columns, cards and setup screen follow the sessions' states.
// Names and notes are user text: child strings only.
import van, { type State } from 'vanjs-core';
import { api } from '../daemon/client.ts';
import { go, onPlace } from '../nav/router.ts';
import { tagColor } from '../sessions/labels.ts';
import { newSession, openTab, type Session, sendSize, sessionList, store } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { onTagsChange, tagBadge } from '../sessions/tags.ts';
import { syncTerminalVisibility } from '../sessions/terminal.ts';
import { matchesKey } from '../settings/keys.ts';
import { current, keyHint, onSaved, saveSetting } from '../settings/settings.ts';
import { glyph, icons, providerIcon } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import {
  type BoardFilter,
  COLUMNS,
  DEFAULT_COMMAND,
  dropOrder,
  foldersOf,
  group,
  matchesFilter,
  parseFilter,
  SETUP_PROMPT,
  type Status,
  shortPath,
  since,
  tagsInUse,
} from './model.ts';
import { CardMenuButton } from './move-menu.ts';
import { setStatus } from './status.ts';

const { a, article, button, div, h2, header, i, input, label, p, section, span } = van.tags;

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
// Checked tags (a card needs any of them) and checked folders, kept in this
// browser. Nothing checked shows every card.
const FILTER_KEY = 'tabsh.boardFilter';
function loadFilter(): BoardFilter {
  try {
    return parseFilter(JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}'));
  } catch {
    return { tags: [], folders: [] };
  }
}
function saveFilter(): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ tags: filterTags.val, folders: filterFolders.val }));
  } catch {}
}
const saved = loadFilter();
const filterTags: State<string[]> = van.state(saved.tags);
const filterFolders: State<string[]> = van.state(saved.folders);
const filterOpen: State<boolean> = van.state(false);
let filterMenu: HTMLElement | null = null;

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

function closeFilterMenu(): void {
  filterMenu?.remove();
  filterMenu = null;
  filterOpen.val = false;
}

function checkRow(text: string, on: boolean, color: string | null, change: (on: boolean) => void): HTMLElement {
  const box = input({ type: 'checkbox', class: 'input', checked: on, onchange: () => change(box.checked) });
  const dot = i();
  if (color) dot.style.background = color;
  return label({ class: `label menu-check${color ? '' : ' repo'}` }, box, dot, span(text));
}

function toggleFilter(kind: 'tags' | 'folders', value: string, on: boolean): void {
  const cur = kind === 'tags' ? filterTags : filterFolders;
  const list = cur.val.filter((x) => x !== value);
  cur.val = on ? [...list, value] : list;
  saveFilter();
}

// Beside Settings: tags and folders in use, each a checkbox. Checking one
// narrows the columns; the menu stays open so several can be checked.
function openFilterMenu(): void {
  closeFilterMenu();
  const items = sessionList.val.map((s) => ({ card: s.card.val, tags: s.tags.val }));
  const tags = tagsInUse(items);
  const folders = foldersOf(items);
  filterTags.val = filterTags.val.filter((t) => tags.includes(t));
  filterFolders.val = filterFolders.val.filter((f) => folders.includes(f));
  saveFilter();
  const parts: HTMLElement[] = [];
  if (tags.length) {
    parts.push(
      div({ class: 'menu-heading' }, 'Tags'),
      div(
        { class: 'menu-list' },
        ...tags.map((tag) =>
          checkRow(tag, filterTags.val.includes(tag), tagColor(tag), (on) => toggleFilter('tags', tag, on)),
        ),
      ),
    );
  }
  if (folders.length) {
    if (parts.length) parts.push(div({ class: 'menu-sep' }));
    parts.push(
      div({ class: 'menu-heading' }, 'Folders'),
      div(
        { class: 'menu-list' },
        ...folders.map((folder) =>
          checkRow(shortPath(folder) || folder, filterFolders.val.includes(folder), null, (on) =>
            toggleFilter('folders', folder, on),
          ),
        ),
      ),
    );
  }
  if (!parts.length) parts.push(div({ class: 'menu-hint' }, 'No tags or folders yet'));
  const menu = div(
    { class: 'row-menu tab-menu board-filter-menu', role: 'dialog', 'aria-label': 'Filter cards' },
    ...parts,
  );
  document.body.append(menu);
  const r = (document.getElementById('board-filter-btn') as HTMLElement).getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  filterMenu = menu;
  filterOpen.val = true;
}

// Shown only while the board is open and past its setup screen.
export function FilterButton(): HTMLElement {
  return button(
    {
      type: 'button',
      class: 'btn',
      'data-variant': 'ghost',
      'data-size': 'icon-sm',
      'aria-label': 'Filter',
      title: 'Filter',
      id: 'board-filter-btn',
      'aria-expanded': () => String(filterOpen.val),
      'aria-pressed': () => String(filterTags.val.length > 0 || filterFolders.val.length > 0),
      hidden: () => !(shown.val && onboarded.val),
      onclick: () => (filterOpen.val ? closeFilterMenu() : openFilterMenu()),
    },
    icons.listFilter(),
  );
}

// Opening the board with a tab open keeps that tab in view, in the drawer.
export function toggleBoard(open = !boardOpen()): void {
  go(open ? { view: 'board', drawer: !!store.active } : { view: 'terms' });
}

function showBoard(open: boolean): void {
  shown.val = open;
  if (!open) closeFilterMenu();
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

// Each card's check for a cut-off title or note, run again whenever the
// board's size changes (shown, hidden, the window resized).
const measures = new WeakMap<Element, () => void>();

// Fade whichever edge has columns hidden beyond it, as the tab strip does.
function updateBoardFades(): void {
  const el = board();
  if (!el) return;
  const end = el.scrollWidth - el.clientWidth;
  el.classList.toggle('fade-left', el.scrollLeft > 1);
  el.classList.toggle('fade-right', el.scrollLeft < end - 1);
}

// Fade a column's top or bottom while cards are scrolled out past it.
function updateListFades(list: Element): void {
  const end = list.scrollHeight - list.clientHeight;
  list.classList.toggle('fade-top', list.scrollTop > 1);
  list.classList.toggle('fade-bottom', list.scrollTop < end - 1);
}

// A list or one of its cards changing size (the window, Show more) moves
// what's out of view.
const listSized = new ResizeObserver((entries) => {
  for (const e of entries) {
    const list = e.target.closest('.board-cards');
    if (list) updateListFades(list);
  }
});

const resized = new ResizeObserver(() => {
  updateBoardFades();
  for (const c of board().querySelectorAll('.board-card')) measures.get(c)?.();
});

// A card: its session's name, status, folder, note and time in status. Its
// title and note are clamped to two lines, with Show more when either is cut
// off.
function Card(s: Session): HTMLElement {
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = van.derive(() => s.card.val.status);
  const note = van.derive(() => s.card.val.note);
  const open = van.state(false);
  const cut = van.state(false);
  const card: HTMLElement = article(
    {
      class: 'board-card',
      draggable: true,
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
      statusGlyph(() => status.val),
      CardMenuButton(s),
    ),
    div(
      { class: 'card-meta' },
      icons.folder(),
      span(() => shortPath(s.card.val.cwd) || '~'),
    ),
    () =>
      s.tags.val.length
        ? div(
            { class: 'card-tags' },
            s.tags.val.map((t) => tagBadge(t)),
          )
        : '',
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
    div(
      { class: 'card-meta' },
      () => {
        const agent = s.card.val.agent;
        return agent ? span({ class: 'card-agent', title: agent }, providerIcon(agent)()) : '';
      },
      () => since(s.card.val.statusAt, now.val),
    ),
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

const ADDABLE: Status[] = ['backlog', 'in_progress'];

function newCardButton(status: Status, name: string): HTMLButtonElement {
  const btn = button(
    {
      type: 'button',
      class: 'btn',
      'data-variant': 'ghost',
      'data-size': 'icon-xs',
      title: `New card in ${name}`,
      'aria-label': `New card in ${name}`,
      onclick: () => newCard(status),
    },
    icons.plus(),
  );
  // The shortcut opens Backlog's dialog; In progress is only its own button.
  if (status === 'backlog') keyHint(btn, `New card in ${name}`, 'keyNewCard');
  return btn;
}

function Column(status: Status, name: string, columns: State<Columns>): HTMLElement {
  const list = div({ class: 'board-cards' });
  keyed(
    list,
    () => columns.val[status],
    (s) => s.id,
    (s) => Card(s),
  );
  list.addEventListener('scroll', () => updateListFades(list), { passive: true });
  listSized.observe(list);
  // Cards coming and going change the list's height without resizing it.
  new MutationObserver((changes) => {
    for (const c of changes) {
      for (const n of c.addedNodes) if (n instanceof Element) listSized.observe(n);
      for (const n of c.removedNodes) if (n instanceof Element) listSized.unobserve(n);
    }
    updateListFades(list);
  }).observe(list, { childList: true });
  for (const c of list.children) listSized.observe(c);
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
      // New cards start in Backlog or In progress; the others are reached by
      // moving a card.
      ADDABLE.includes(status) ? newCardButton(status, name) : '',
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
    await setStatus(s, 'in_progress').catch(console.error); // starts its agent; the board stays open
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

// The board's columns: the stages, then Archived (reached from a card's menu
// or by a drop, never by a new card).
const BOARD_COLUMNS: typeof COLUMNS = [...COLUMNS, { status: 'archived', name: 'Archived' }];

// The board's parts: its setup screen, or its columns.
const PARTS = BOARD_COLUMNS.map((c) => c.status);

export function Board(): HTMLElement {
  const sessions = van.derive((): Columns => {
    const filter = { tags: filterTags.val, folders: filterFolders.val };
    const kept = sessionList.val.filter((s) => matchesFilter({ card: s.card.val, tags: s.tags.val }, filter));
    const g = group(kept.map((s) => ({ s, card: s.card.val })));
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.s)])) as Columns;
  });
  const el = section({
    id: 'board',
    'aria-label': 'Board',
    hidden: () => !shown.val,
    // A click on the board's empty space closes the drawer; one on a card
    // opens that card in it instead, and controls keep their own clicks.
    onclick: (e: MouseEvent) => {
      if (drawer.val && !(e.target as Element).closest('.board-card, button, a, input, .move-menu')) {
        go({ drawer: false });
      }
    },
  });
  resized.observe(el);
  el.addEventListener('scroll', updateBoardFades, { passive: true });
  // Columns replacing the setup screen change the scroll width without resizing the board.
  van.derive(() => {
    onboarded.val;
    shown.val;
    requestAnimationFrame(updateBoardFades);
  });
  keyed(
    el,
    () => (onboarded.val ? PARTS : ['onboarding']),
    (part) => part,
    (part) => {
      if (part === 'onboarding') return Onboarding();
      const c = BOARD_COLUMNS.find((x) => x.status === part) as (typeof COLUMNS)[number];
      return Column(c.status, c.name, sessions);
    },
  );
  return el;
}

export function initBoard(): void {
  onPlace('view', (to) => {
    showBoard(to.view === 'board');
    // Board alone parks terminals so a drag that launches an agent does not
    // flood xterm while the cards are on screen.
    syncTerminalVisibility();
    return undefined;
  });
  onPlace('drawer', (to) => {
    drawer.val = to.drawer;
    if (to.drawer) queueMicrotask(() => store.active?.term.focus()); // once VanJS shows it
    syncTerminalVisibility();
    return undefined;
  });
  const boardButton = document.getElementById('board-btn') as HTMLButtonElement;
  keyHint(boardButton, 'Board', 'keyToggleBoard');
  boardButton.onclick = () => toggleBoard();
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    const btn = document.getElementById('board-filter-btn');
    if (filterMenu && !filterMenu.contains(t) && !btn?.contains(t)) closeFilterMenu();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilterMenu();
  });
  onTagsChange(() => {
    const tags = tagsInUse(sessionList.val.map((s) => ({ tags: s.tags.val })));
    filterTags.val = filterTags.val.filter((t) => tags.includes(t));
  });
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
  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesKey(e, current.saved.keyNewCard) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      newCard('backlog');
    },
    true,
  );
  onSaved((s) => {
    onboarded.val = s.boardOnboarded; // e.g. the setup screen, once it's dealt with
    if (!s.boardOnboarded) closeFilterMenu();
  });
  setInterval(() => (now.val = Math.floor(Date.now() / 1000)), 30_000);
}
