// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Its columns, cards and setup screen follow the sessions' states.
// Names and notes are user text: child strings only.
import van, { type State } from 'vanjs-core';
import { DOCS_URL } from '../../site.ts';
import { api } from '../daemon/client.ts';
import { go, here, onPlace } from '../nav/router.ts';
import { tagColor } from '../sessions/labels.ts';
import { newSession, onScreen, openTab, type Session, sendSize, sessionList, store } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { onTagsChange, tagBadge } from '../sessions/tags.ts';
import { syncTerminalVisibility } from '../sessions/terminal.tsx';
import { matchesKey } from '../settings/keys.ts';
import type { BoardLayout } from '../settings/schema.ts';
import { current, keyHint, onSaved, saveSetting } from '../settings/settings.ts';
import { phone } from '../ui/dom.ts';
import { glyph, icons, providerIcon } from '../ui/icons.tsx';
import { keyed } from '../ui/keyed.ts';
import {
  asStatus,
  type BoardFilter,
  COLUMNS,
  clippedTooltip,
  DEFAULT_COMMAND,
  dropOrder,
  fittingCount,
  folderName,
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
import { CardMenu, type CardMenuHandle } from './move-menu.ts';
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
// Columns side by side, or one list of rows under each status's heading.
export const layout: State<BoardLayout> = van.state(current.saved.boardLayout);
// The list layout's folded statuses, kept in this browser.
const COLLAPSED_KEY = 'tabsh.boardCollapsed';
function loadCollapsed(): Status[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(asStatus) : [];
  } catch {
    return [];
  }
}
const collapsed: State<Status[]> = van.state(loadCollapsed());
function toggleCollapsed(status: Status): void {
  const rest = collapsed.val.filter((x) => x !== status);
  collapsed.val = rest.length < collapsed.val.length ? rest : [...rest, status];
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed.val));
  } catch {}
}

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

// The Board button's icon: the list's while the board shows as a list, else
// the columns'.
export const boardIcon = (): SVGSVGElement => (shown.val && layout.val === 'list' ? icons.rows() : icons.board());

// The board's other layout: columns or list.
export function toggleBoardLayout(): void {
  saveSetting('boardLayout', layout.val === 'list' ? 'columns' : 'list');
}

// The Board button's and its shortcut's three steps: the terminals, the board
// as columns, the board as a list, and back to the terminals. A phone has no
// terminals view: only columns and list.
export function cycleBoard(): void {
  if (!boardOpen()) {
    if (layout.val !== 'columns') saveSetting('boardLayout', 'columns');
    toggleBoard(true);
  } else if (layout.val === 'columns') saveSetting('boardLayout', 'list');
  else if (phone.matches) saveSetting('boardLayout', 'columns');
  else toggleBoard(false);
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
    const term = onScreen();
    if (shown.val || !term) return;
    sendSize(term);
    term.term.focus();
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

// Fade whichever edge has columns hidden beyond it, as the tab strip does;
// in the list layout, the top or bottom with rows hidden beyond it.
function updateBoardFades(): void {
  const el = board();
  if (!el) return;
  const end = el.scrollWidth - el.clientWidth;
  el.classList.toggle('fade-left', el.scrollLeft > 1);
  el.classList.toggle('fade-right', el.scrollLeft < end - 1);
  const bottom = el.scrollHeight - el.clientHeight;
  el.classList.toggle('fade-top', el.scrollTop > 1);
  el.classList.toggle('fade-bottom', el.scrollTop < bottom - 1);
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

// What a card and a row share: a click or Enter opens its terminal in the
// drawer, it drags to a new status or place, and right-clicking (or
// long-pressing on a phone) opens its menu at the pointer. Shift+F10 opens it
// for the keyboard.
const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 8;

function cardProps(s: Session, cls: string, el: () => HTMLElement, menu: CardMenuHandle) {
  // A long press opens the menu; the click that follows lifting must not open
  // the card (nor close the menu as an outside click).
  let press: { id: number; x: number; y: number; timer: number } | null = null;
  let ignoreClickUntil = 0;
  const cancelPress = () => {
    if (press) window.clearTimeout(press.timer);
    press = null;
  };
  menu.onCloseFocus(() => el().focus({ preventScroll: true }));
  menu.anchorAt(() => el());
  return {
    class: cls,
    draggable: true,
    tabindex: '0',
    'aria-haspopup': 'menu',
    'aria-keyshortcuts': 'Shift+F10 ContextMenu',
    'data-id': s.id,
    oncontextmenu: (e: MouseEvent) => {
      e.preventDefault();
      menu.openAt(e.clientX, e.clientY);
    },
    onpointerdown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      if ((e.target as Element).closest('button, a, input, .move-menu')) return;
      cancelPress();
      const { pointerId: id, clientX: x, clientY: y } = e;
      const timer = window.setTimeout(() => {
        press = null;
        ignoreClickUntil = performance.now() + 800;
        menu.openAt(x, y);
      }, LONG_PRESS_MS);
      press = { id, x, y, timer };
    },
    onpointermove: (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX)
        cancelPress();
    },
    onpointerup: (e: PointerEvent) => {
      if (press && e.pointerId === press.id) cancelPress();
    },
    onpointercancel: cancelPress,
    onclick: (e: MouseEvent) => {
      if (performance.now() < ignoreClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      go({ tab: s.id, drawer: true });
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.target !== el()) return;
      if (e.key === 'Enter') {
        el().click();
        return;
      }
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      e.preventDefault();
      const r = el().getBoundingClientRect();
      menu.openAt(r.right - 8, r.top + 8, true);
    },
    ondragstart: (e: DragEvent) => {
      e.dataTransfer?.setData(CARD_DRAG, s.id);
      el().classList.add('dragging');
    },
    ondragend: () => {
      el().classList.remove('dragging');
      clearDropMarks();
    },
  };
}

const agentIcon = (s: Session) => () => {
  const agent = s.card.val.agent;
  return agent ? span({ class: 'card-agent', title: agent }, providerIcon(agent)()) : '';
};

// A card in the list layout: status and name, then note, tags, folder, agent
// and time. On a wide row the note follows the name and the rest sits on the
// right. On a narrow one they wrap to the next line: the note under the name,
// the rest at the bottom right. Tags and the folder still collapse when they
// themselves clip.
function Row(s: Session): HTMLElement {
  const status = van.derive(() => s.card.val.status);
  const menu = CardMenu(s);
  const row: HTMLElement = article(
    cardProps(s, 'board-card board-row', () => row, menu),
    statusGlyph(() => status.val),
    span({ class: 'card-title', title: () => s.name.val }, () => s.name.val),
    div(
      { class: 'row-end' },
      () => (s.card.val.note ? span({ class: 'row-note' }, s.card.val.note) : ''),
      () =>
        s.tags.val.length
          ? span(
              { class: 'card-tags' },
              s.tags.val.map((t) => tagBadge(t)),
              span({ class: 'badge tag-more', hidden: true }),
            )
          : '',
      span(
        {
          class: 'card-meta row-folder',
          'data-path': () => shortPath(s.card.val.cwd) || '~',
        },
        icons.folder(),
        span(() => folderName(s.card.val.cwd) || '~'),
      ),
      span({ class: 'card-meta' }, agentIcon(s)),
      span({ class: 'card-meta row-since' }, () => since(s.card.val.statusAt, now.val)),
    ),
    menu.root,
  );
  const fit = () => fitRowEnd(row, s.tags.val);
  measures.set(row, fit);
  van.derive(() => {
    s.tags.val;
    s.card.val.cwd;
    requestAnimationFrame(fit);
  });
  return row;
}

// Tags that don't fit collapse into colored dots; hovering them lists those
// tags. The folder shows its name, or only its icon once squeezed to a
// sliver; hovering it shows the name, then the whole path.
function fitRowEnd(row: HTMLElement, tags: string[]): void {
  const folder = row.querySelector<HTMLElement>('.row-folder');
  folder?.classList.remove('icon-only');
  const box = row.querySelector<HTMLElement>('.row-end .card-tags');
  if (box) layoutTags(box, tags);
  const pathText = folder?.querySelector('span');
  if (folder && pathText) {
    const name = pathText.textContent ?? '';
    const full = folder.dataset.path || name;
    const cut = clippedTooltip(name, pathText.scrollWidth, pathText.clientWidth) !== '';
    if (cut && pathText.clientWidth < 32) folder.classList.add('icon-only');
    const tip = full !== name ? `${name}\n${full}` : cut ? name : '';
    if (tip) folder.title = tip;
    else folder.removeAttribute('title');
  }
}

// Hidden tag names for each overflow pill, and the one popup on the page.
const overflowNames = new WeakMap<HTMLElement, string[]>();
const pillBound = new WeakSet<HTMLElement>();
let tagPop: HTMLElement | null = null;
let hideTagPop = 0;
let closeTagPopOnScroll: (() => void) | null = null;

function paintPill(more: HTMLElement, names: string[]): void {
  more.replaceChildren(...names.map((name) => i({ style: `--tag: ${tagColor(name)}`, 'aria-hidden': 'true' })));
  if (names.length) more.setAttribute('aria-label', names.join(', '));
  else more.removeAttribute('aria-label');
  overflowNames.set(more, names);
}

function closeTagPop(): void {
  window.clearTimeout(hideTagPop);
  if (closeTagPopOnScroll) window.removeEventListener('scroll', closeTagPopOnScroll, true);
  closeTagPopOnScroll = null;
  tagPop?.remove();
  tagPop = null;
}

function scheduleHideTagPop(): void {
  window.clearTimeout(hideTagPop);
  hideTagPop = window.setTimeout(closeTagPop, 150);
}

// The pill sits in a masked, scrolling board, so the list of hidden tags is
// fixed on the body, just under the pill.
function openTagPop(more: HTMLElement): void {
  const names = overflowNames.get(more) ?? [];
  if (names.length === 0 || more.hidden) return;
  closeTagPop();
  tagPop = div(
    {
      class: 'tag-more-pop',
      role: 'tooltip',
      onmouseenter: () => window.clearTimeout(hideTagPop),
      onmouseleave: () => scheduleHideTagPop(),
    },
    names.map((name) => tagBadge(name)),
  );
  document.body.append(tagPop);
  const r = more.getBoundingClientRect();
  const w = tagPop.offsetWidth;
  const h = tagPop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  tagPop.style.left = `${left}px`;
  tagPop.style.top = `${top}px`;
  closeTagPopOnScroll = () => closeTagPop();
  window.addEventListener('scroll', closeTagPopOnScroll, true);
}

function bindTagPop(more: HTMLElement): void {
  if (pillBound.has(more)) return;
  pillBound.add(more);
  more.addEventListener('mouseenter', () => openTagPop(more));
  more.addEventListener('mouseleave', () => scheduleHideTagPop());
}

function layoutTags(box: HTMLElement, names: string[]): void {
  const badges = [...box.querySelectorAll<HTMLElement>(':scope > .tag-badge')];
  const more = box.querySelector<HTMLElement>(':scope > .tag-more');
  if (!more || badges.length === 0) return;
  // Unlocked while measuring, so the box takes the width the row leaves it.
  // Locked after, or flex shrinks it again past the fit and clips the last item.
  box.style.flexShrink = '';
  for (const b of badges) b.hidden = false;
  more.hidden = true;
  paintPill(more, []);
  if (box.clientWidth === 0) return;
  if (box.scrollWidth <= box.clientWidth + 1) {
    box.style.flexShrink = '0';
    return;
  }

  const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0;
  const widths = badges.map((b) => b.getBoundingClientRect().width);
  const available = box.clientWidth;
  // The pill's width is one dot per hidden tag, so measure it, fit, and
  // measure again once that count is known.
  more.hidden = false;
  bindTagPop(more);
  paintPill(more, names);
  let count = fittingCount(widths, gap, available, more.getBoundingClientRect().width);
  for (let n = 0; n < 3; n++) {
    const hidden = names.slice(count);
    if (hidden.length === 0) break;
    paintPill(more, hidden);
    const next = fittingCount(widths, gap, available, more.getBoundingClientRect().width);
    if (next === count) break;
    count = next;
  }
  const overflow = names.slice(count);
  badges.forEach((b, i) => {
    b.hidden = i >= count;
  });
  box.style.flexShrink = '0';
  if (overflow.length === 0) {
    more.hidden = true;
    paintPill(more, []);
    return;
  }
  more.hidden = false;
  paintPill(more, overflow);
}

// A card: its session's name, status, folder, note and time in status. Its
// title and note are clamped to two lines, with Show more when either is cut
// off.
function Card(s: Session): HTMLElement {
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = van.derive(() => s.card.val.status);
  const note = van.derive(() => s.card.val.note);
  const open = van.state(false);
  const cut = van.state(false);
  const menu = CardMenu(s);
  const card: HTMLElement = article(
    cardProps(s, 'board-card', () => card, menu),
    div(
      { class: 'card-top' },
      span({ class: 'card-title' }, () => s.name.val),
      statusGlyph(() => status.val),
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
    div({ class: 'card-meta' }, agentIcon(s), () => since(s.card.val.statusAt, now.val)),
    menu.root,
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
  for (const x of board().querySelectorAll('.drop-before, .drop-end, .drop-into')) {
    x.classList.remove('drop-before', 'drop-end', 'drop-into');
  }
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

// A status's cards: a column of cards, or in the list layout a heading over
// its rows, which the heading folds away.
function Column(status: Status, name: string, columns: State<Columns>, asList: boolean): HTMLElement {
  const folded = () => asList && collapsed.val.includes(status);
  const list = div({ class: 'board-cards', hidden: folded });
  keyed(
    list,
    () => columns.val[status],
    (s) => s.id,
    (s) => (asList ? Row(s) : Card(s)),
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
        if (folded()) return void col.classList.add('drop-into');
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
      asList
        ? button(
            {
              type: 'button',
              class: 'col-toggle',
              'aria-expanded': () => String(!folded()),
              onclick: () => toggleCollapsed(status),
            },
            icons.chevronDown(),
            statusGlyph(status),
            span({ class: 'col-name' }, name),
            span({ class: 'col-count' }, () => String(columns.val[status].length)),
          )
        : [
            statusGlyph(status),
            span({ class: 'col-name' }, name),
            span({ class: 'col-count' }, () => String(columns.val[status].length)),
          ],
      // New cards start in Backlog or In progress; the others are reached by
      // moving a card.
      ADDABLE.includes(status) ? newCardButton(status, name) : '',
    ),
    list,
  );
  // In the list layout, rows coming, going or folding move the board's own
  // scroll end.
  if (asList) resized.observe(col);
  return col;
}

// Until the board is onboarded (the `boardOnboarded` setting), it shows this
// instead of its columns: one button opens a Claude Code card that wires its
// own hooks through `tabsh setup`, the other skips it. Either one marks the
// board onboarded.
const BOARD_DOCS = DOCS_URL;

// Opens the setup card: a session whose agent wires tabsh's own hooks by
// following `tabsh setup`'s guide. The board's setup screen and the welcome's
// agents screen both use it. It writes no settings and moves no card — its
// callers do that — and returns null when the card didn't open.
export async function openSetupCard(opts: {
  command: string;
  resume?: string;
  focus: boolean;
}): Promise<Session | null> {
  try {
    return await openTab(
      {
        name: 'Set up tabsh hooks',
        prompt: SETUP_PROMPT,
        command: opts.command,
        ...(opts.resume !== undefined && { resume: opts.resume }),
      },
      opts.focus,
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

function Onboarding(): HTMLElement {
  const busy = van.state(false);
  async function setUp(): Promise<void> {
    busy.val = true;
    const s = await openSetupCard({ command: DEFAULT_COMMAND, focus: false });
    if (!s) {
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

// The board's parts: its setup screen, or its columns (keyed by layout too,
// so switching layouts redraws them).
const parts = () => BOARD_COLUMNS.map((c) => `${layout.val}:${c.status}`);

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
    class: () => (layout.val === 'list' ? 'list' : ''),
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
    layout.val;
    requestAnimationFrame(updateBoardFades);
  });
  keyed(
    el,
    () => (onboarded.val ? parts() : ['onboarding']),
    (part) => part,
    (part) => {
      if (part === 'onboarding') return Onboarding();
      const [kind, status] = part.split(':');
      const c = BOARD_COLUMNS.find((x) => x.status === status) as (typeof COLUMNS)[number];
      return Column(c.status, c.name, sessions, kind === 'list');
    },
  );
  return el;
}

// On a phone, the terminals view (a start view, a link, Back, a turn into
// phone size) is the board with the terminal in its drawer.
const PHONE_FIX = { view: 'board', drawer: true } as const;

// Startup's place, whose view step doesn't run when it is the default
// (the terminals), gets the same fix once the router has started.
export function leaveTermsOnPhone(): void {
  if (phone.matches && here().view === 'terms') go(PHONE_FIX, 'replace');
}

export function initBoard(): void {
  onPlace('view', (to) => {
    const fix = to.view === 'terms' && phone.matches ? PHONE_FIX : undefined;
    showBoard(to.view === 'board' || !!fix);
    // Board alone parks terminals so a drag that launches an agent does not
    // flood xterm while the cards are on screen.
    syncTerminalVisibility();
    return fix;
  });
  phone.addEventListener('change', leaveTermsOnPhone);
  onPlace('drawer', (to) => {
    drawer.val = to.drawer;
    if (to.drawer) queueMicrotask(() => onScreen()?.term.focus()); // once VanJS shows it
    syncTerminalVisibility();
    return undefined;
  });
  const boardButton = document.getElementById('board-btn') as HTMLButtonElement;
  keyHint(boardButton, 'Board', 'keyToggleBoard');
  boardButton.onclick = () => cycleBoard(); // as its shortcut: terminals, columns, list
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
      cycleBoard();
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
    layout.val = s.boardLayout;
    if (!s.boardOnboarded) closeFilterMenu();
  });
  setInterval(() => (now.val = Math.floor(Date.now() / 1000)), 30_000);
}
