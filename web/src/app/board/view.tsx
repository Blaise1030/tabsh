// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Its columns, cards and setup screen follow the sessions' states.
// Names and notes are user text: child strings only.
import { batch, createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { DOCS_URL } from '../../site.ts';
import { focusAgentSurface } from '../chat/deliver.ts';
import { api } from '../daemon/client.ts';
import { go, here, onPlace } from '../nav/router.ts';
import { tagColor } from '../sessions/labels.ts';
import {
  isChatCard,
  newSession,
  onScreen,
  openTab,
  type Session,
  sendSize,
  sessionList,
  store,
} from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { onTagsChange, tagBadge } from '../sessions/tags.tsx';
import { syncTerminalVisibility } from '../sessions/terminal.tsx';
import { matchesKey } from '../settings/keys.ts';
import type { BoardLayout } from '../settings/schema.ts';
import { current, keyHint, onSaved, saveSetting } from '../settings/settings.ts';
import { phone } from '../ui/dom.ts';
import { glyph, icons, providerIcon } from '../ui/icons.tsx';
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
import { CardMenu, type CardMenuHandle } from './move-menu.tsx';
import { setStatus } from './status.ts';

// Whether the board is shown (else the terminals are): set only by the
// router's view step.
export const [shown, setShown] = createSignal(false);
// Whether the active tab's terminal shows in a drawer beside the board: set
// only by the router's drawer step.
export const [drawer, setDrawer] = createSignal(false);
// The drawer takes the whole page: the board and list step out of its way,
// and the drawer bar stays for the way back. It is not a workspace mode, so
// it does not change the place.
export const [drawerExpanded, setDrawerExpanded] = createSignal(false);
export function toggleDrawerExpanded(): void {
  if (!drawer()) return;
  setDrawerExpanded(!drawerExpanded());
}
// A new value each time the view or drawer step brings the terminal into
// view: the board then fits and focuses it. Written by the last of those
// steps to run, after `shown` and `drawer`, so observers see those (and the
// page shows them) before this is heard.
const [viewTurn, setViewTurn] = createSignal({});
// Unix seconds, ticking every 30 s: keeps "time in status" fresh.
const [now, setNow] = createSignal(Math.floor(Date.now() / 1000));
// Until the board is onboarded it shows its setup screen.
const [onboarded, setOnboarded] = createSignal(current.saved.boardOnboarded);
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
    localStorage.setItem(FILTER_KEY, JSON.stringify({ tags: filterTags(), folders: filterFolders() }));
  } catch {}
}
const saved = loadFilter();
const [filterTags, setFilterTags] = createSignal<string[]>(saved.tags);
const [filterFolders, setFilterFolders] = createSignal<string[]>(saved.folders);
const [filterOpen, setFilterOpen] = createSignal(false);
// What the open filter menu lists: the tags and folders in use when it opened.
const [filterChoices, setFilterChoices] = createSignal<{ tags: string[]; folders: string[] }>({
  tags: [],
  folders: [],
});
let filterMenu: HTMLElement | null = null;
// Columns side by side, or one list of rows under each status's heading.
export const [layout, setLayout] = createSignal<BoardLayout>(current.saved.boardLayout);
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
const [collapsed, setCollapsed] = createSignal<Status[]>(loadCollapsed());
function toggleCollapsed(status: Status): void {
  const rest = collapsed().filter((x) => x !== status);
  setCollapsed(rest.length < collapsed().length ? rest : [...rest, status]);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed()));
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

export const boardOpen = (): boolean => shown();

function closeFilterMenu(): void {
  filterMenu = null;
  setFilterOpen(false);
}

function CheckRow(props: {
  text: string;
  checked: boolean;
  color: string | null;
  change: (checked: boolean) => void;
}): JSX.Element {
  const dot = props.color ? `background:${props.color}` : '';
  let box!: HTMLInputElement;
  return (
    <label class={`label menu-check${props.color ? '' : ' repo'}`}>
      <input
        ref={box}
        type="checkbox"
        class="input"
        checked={props.checked}
        on:change={() => props.change(box.checked)}
      />
      <i style={dot} />
      <span>{props.text}</span>
    </label>
  );
}

function toggleFilter(kind: 'tags' | 'folders', value: string, checked: boolean): void {
  if (kind === 'tags') {
    const list = filterTags().filter((x) => x !== value);
    setFilterTags(checked ? [...list, value] : list);
  } else {
    const list = filterFolders().filter((x) => x !== value);
    setFilterFolders(checked ? [...list, value] : list);
  }
  saveFilter();
}

// Beside Settings: tags and folders in use, each a checkbox. Checking one
// narrows the columns; the menu stays open so several can be checked.
function openFilterMenu(): void {
  const items = sessionList().map((s) => ({ card: s.card(), tags: s.tags() }));
  const tags = tagsInUse(items);
  const folders = foldersOf(items);
  setFilterTags(filterTags().filter((t) => tags.includes(t)));
  setFilterFolders(filterFolders().filter((f) => folders.includes(f)));
  saveFilter();
  setFilterChoices({ tags, folders });
  setFilterOpen(true);
}

// The open filter menu, on the page's body: its rows are checked as the
// filter was when it opened, and stay as they're toggled.
function FilterMenu(): JSX.Element {
  const { tags, folders } = filterChoices();
  const checkedTags = filterTags();
  const checkedFolders = filterFolders();
  return (
    <Portal
      ref={(host) => {
        const menu = host.firstElementChild as HTMLElement;
        const r = (document.getElementById('board-filter-btn') as HTMLElement).getBoundingClientRect();
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
        filterMenu = menu;
      }}
    >
      <div class="row-menu tab-menu board-filter-menu" role="dialog" aria-label="Filter cards">
        <Show when={tags.length}>
          <div class="menu-heading">Tags</div>
          <div class="menu-list">
            {tags.map((tag) => (
              <CheckRow
                text={tag}
                checked={checkedTags.includes(tag)}
                color={tagColor(tag)}
                change={(checked) => toggleFilter('tags', tag, checked)}
              />
            ))}
          </div>
        </Show>
        <Show when={folders.length}>
          <Show when={tags.length}>
            <div class="menu-sep" />
          </Show>
          <div class="menu-heading">Folders</div>
          <div class="menu-list">
            {folders.map((folder) => (
              <CheckRow
                text={shortPath(folder) || folder}
                checked={checkedFolders.includes(folder)}
                color={null}
                change={(checked) => toggleFilter('folders', folder, checked)}
              />
            ))}
          </div>
        </Show>
        <Show when={!tags.length && !folders.length}>
          <div class="menu-hint">No tags or folders yet</div>
        </Show>
      </div>
    </Portal>
  );
}

// Shown only while the board is open and past its setup screen.
export function FilterButton(): JSX.Element {
  const open = filterOpen;
  const tags = filterTags;
  const folders = filterFolders;
  const board = shown;
  const ready = onboarded;
  return (
    <>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon-sm"
        aria-label="Filter"
        title="Filter"
        id="board-filter-btn"
        aria-expanded={open()}
        aria-pressed={tags().length > 0 || folders().length > 0}
        hidden={!(board() && ready())}
        onClick={() => (filterOpen() ? closeFilterMenu() : openFilterMenu())}
      >
        {icons.listFilter()}
      </button>
      <Show when={open()}>
        <FilterMenu />
      </Show>
    </>
  );
}

// The board's other layout: columns or list.
export function toggleBoardLayout(): void {
  saveSetting('boardLayout', layout() === 'list' ? 'columns' : 'list');
}

// The Board button and its shortcut switch the board's layout. From an
// expanded terminal they return to the board; the board is home, so they
// never leave for a terminals-only workspace.
export function cycleBoard(): void {
  if (drawerExpanded()) {
    setDrawerExpanded(false);
  } else if (!boardOpen()) {
    go({ view: 'board', drawer: !!store.active });
  } else {
    saveSetting('boardLayout', layout() === 'list' ? 'columns' : 'list');
  }
}

// The palette's Toggle board: show or hide the board. Hiding it gives the
// drawer the page rather than opening the old terminals workspace.
export function toggleBoard(): void {
  if (drawerExpanded()) {
    setDrawerExpanded(false);
  } else if (!boardOpen()) {
    go({ view: 'board', drawer: !!store.active });
  } else if (drawer()) {
    setDrawerExpanded(true);
  } else if (store.active) {
    go({ drawer: true });
  }
}

function showBoard(open: boolean): void {
  if (open) {
    setShown(true);
    return;
  }
  closeFilterMenu();
  // With the drawer open, the drawer step follows to close it, and turns then.
  batch(() => {
    setShown(false);
    setDrawerExpanded(false);
    if (!drawer()) setViewTurn({});
  });
}

const StatusGlyph = (props: { status: Status }): JSX.Element => (
  <i class="status-glyph" data-status={props.status}>
    {glyph(props.status)}
  </i>
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
// for the keyboard. Its own click is delegated; its menu stops clicks at its
// root, so they never reach it.
const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 8;

function CardFrame(props: {
  session: Session;
  class: string;
  ref: (el: HTMLElement) => void;
  children: JSX.Element;
}): JSX.Element {
  const s = props.session;
  const menu: CardMenuHandle = CardMenu(s);
  let el!: HTMLElement;
  // A long press opens the menu; the click that follows lifting must not open
  // the card (nor close the menu as an outside click).
  let press: { id: number; x: number; y: number; timer: number } | null = null;
  let ignoreClickUntil = 0;
  const cancelPress = () => {
    if (press) window.clearTimeout(press.timer);
    press = null;
  };
  onCleanup(cancelPress);
  menu.onCloseFocus(() => el.focus({ preventScroll: true }));
  menu.anchorAt(() => el);
  return (
    <article
      ref={(node) => {
        el = node;
        props.ref(node);
      }}
      class={props.class}
      draggable={true}
      tabindex="0"
      aria-haspopup="menu"
      aria-keyshortcuts="Shift+F10 ContextMenu"
      data-id={s.id}
      onContextMenu={(e) => {
        e.preventDefault();
        menu.openAt(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
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
      }}
      onPointerMove={(e) => {
        if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX)
          cancelPress();
      }}
      onPointerUp={(e) => {
        if (press && e.pointerId === press.id) cancelPress();
      }}
      on:pointercancel={cancelPress}
      // Native, so stopping it here keeps it from the page: Basecoat's
      // outside click on the document would close the menu just opened.
      on:click={(e) => {
        if (performance.now() < ignoreClickUntil) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={() => go({ tab: s.id, drawer: true })}
      onKeyDown={(e) => {
        if (e.target !== el) return;
        if (e.key === 'Enter') {
          el.click();
          return;
        }
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        menu.openAt(r.right - 8, r.top + 8, true);
      }}
      on:dragstart={(e) => {
        e.dataTransfer?.setData(CARD_DRAG, s.id);
        el.classList.add('dragging');
      }}
      on:dragend={() => {
        el.classList.remove('dragging');
        clearDropMarks();
      }}
    >
      {props.children}
      {menu.root}
    </article>
  );
}

function AgentIcon(props: { session: Session }): JSX.Element {
  const card = props.session.card;
  const agent = createMemo(() => card().agent);
  return (
    <Show when={agent()} keyed>
      {(name) => (
        <span class="card-agent" title={name}>
          {providerIcon(name)()}
        </span>
      )}
    </Show>
  );
}

// The badges of a card's tags; a row's also hold the pill its overflow
// collapses into (`layoutTags`). Called in a binding, so a change of tags
// rebuilds it whole.
function tagBox(tags: string[], pill: boolean): JSX.Element {
  if (!tags.length) return null;
  const badges = tags.map((t) => tagBadge(t));
  return pill ? (
    <span class="card-tags">
      {badges}
      <span class="badge tag-more" hidden />
    </span>
  ) : (
    <div class="card-tags">{badges}</div>
  );
}

// A card in the list layout: status and name, then note, tags, folder, agent
// and time. On a wide row the note follows the name and the rest sits on the
// right. On a narrow one they wrap to the next line: the note under the name,
// the rest at the bottom right. Tags and the folder still collapse when they
// themselves clip.
function Row(props: { session: Session }): JSX.Element {
  const s = props.session;
  const card = s.card;
  const name = s.name;
  const tags = s.tags;
  const time = now;
  const status = createMemo(() => card().status);
  const cwd = createMemo(() => card().cwd);
  let row!: HTMLElement;
  const fit = () => fitRowEnd(row, tags());
  createEffect(
    on([tags, cwd], () => {
      requestAnimationFrame(fit);
    }),
  );
  return (
    <CardFrame
      session={s}
      class="board-card board-row"
      ref={(el) => {
        row = el;
        measures.set(el, fit);
      }}
    >
      <StatusGlyph status={status()} />
      <span class="card-title" title={name()}>
        {name()}
      </span>
      <div class="row-end">
        <Show when={card().note}>{(note) => <span class="row-note">{note()}</span>}</Show>
        {tagBox(tags(), true)}
        <span class="card-meta row-folder" data-path={shortPath(cwd()) || '~'}>
          {icons.folder()}
          <span>{folderName(cwd()) || '~'}</span>
        </span>
        <span class="card-meta">
          <AgentIcon session={s} />
        </span>
        <span class="card-meta row-since">{since(card().statusAt, time())}</span>
      </div>
    </CardFrame>
  );
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
  more.replaceChildren(
    ...names.map((name) => {
      const dot = document.createElement('i');
      dot.style.setProperty('--tag', tagColor(name));
      dot.setAttribute('aria-hidden', 'true');
      return dot;
    }),
  );
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
  const pop = document.createElement('div');
  pop.className = 'tag-more-pop';
  pop.setAttribute('role', 'tooltip');
  pop.addEventListener('mouseenter', () => window.clearTimeout(hideTagPop));
  pop.addEventListener('mouseleave', () => scheduleHideTagPop());
  pop.append(...names.map((name) => tagBadge(name)));
  tagPop = pop;
  document.body.append(pop);
  const r = more.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
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
function Card(props: { session: Session }): JSX.Element {
  const s = props.session;
  const card = s.card;
  const name = s.name;
  const tags = s.tags;
  const time = now;
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = createMemo(() => card().status);
  const note = createMemo(() => card().note);
  const [open, setOpen] = createSignal(false);
  const [cut, setCut] = createSignal(false);
  let el!: HTMLElement;
  // A clamped box reports no overflow in scrollHeight, so this compares its
  // text's height with the clamp lifted. Hidden (height 0), nothing is cut.
  const measure = () => {
    const texts = [...el.querySelectorAll<HTMLElement>('.card-title, .card-note')];
    const heights = () => texts.map((t) => t.clientHeight);
    el.classList.remove('expanded');
    const clamped = heights();
    el.classList.add('expanded');
    const full = heights();
    el.classList.toggle('expanded', open());
    setCut(full.some((h, j) => h > clamped[j] + 1));
  };
  createEffect(() => el.classList.toggle('expanded', open()));
  createEffect(
    on([name, note], () => {
      requestAnimationFrame(measure); // once the new text is laid out
    }),
  );
  return (
    <CardFrame
      session={s}
      class="board-card"
      ref={(node) => {
        el = node;
        measures.set(node, measure);
      }}
    >
      <div class="card-top">
        <span class="card-title">{name()}</span>
        <StatusGlyph status={status()} />
      </div>
      <div class="card-meta">
        {icons.folder()}
        <span>{shortPath(card().cwd) || '~'}</span>
      </div>
      {tagBox(tags(), false)}
      <Show when={note()}>{(text) => <div class="card-note">{text()}</div>}</Show>
      <Show when={cut() || open()}>
        <button
          type="button"
          class="card-more"
          // Native and stopped: the card's own click must not open it.
          on:click={(e) => {
            e.stopPropagation();
            setOpen(!open());
          }}
          on:keydown={(e) => e.stopPropagation()} // Enter/Space on the button must not open the card
        >
          {open() ? 'Show less' : 'Show more'}
        </button>
      </Show>
      <div class="card-meta">
        <AgentIcon session={s} />
        {since(card().statusAt, time())}
      </div>
    </CardFrame>
  );
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
const cards = () => store.sessions.map((s) => ({ s, id: s.id, card: s.card() }));

async function move(id: string, status: Status, beforeId: string | null): Promise<void> {
  const s = store.sessions.find((x) => x.id === id);
  if (!s) return;
  const ids = dropOrder(cards(), id, status, beforeId);
  orderTabs(ids);
  api('PUT', '/order', { ids }).catch(() => {});
  if (s.card().status !== status) await setStatus(s, status).catch(console.error);
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

function NewCardButton(props: { status: Status; name: string }): JSX.Element {
  const { status, name } = props;
  return (
    <button
      ref={(btn) => {
        // The shortcut opens Backlog's dialog; In progress is only its own button.
        if (status === 'backlog') keyHint(btn, `New card in ${name}`, 'keyNewCard');
      }}
      type="button"
      class="btn"
      data-variant="ghost"
      data-size="icon-xs"
      title={`New card in ${name}`}
      aria-label={`New card in ${name}`}
      onClick={() => newCard(status)}
    >
      {icons.plus()}
    </button>
  );
}

// A status's cards: a column of cards, or in the list layout a heading over
// its rows, which the heading folds away.
function Column(props: { status: Status; name: string; columns: () => Columns; asList: boolean }): JSX.Element {
  const { status, name, columns, asList } = props;
  const folds = collapsed;
  const folded = () => asList && folds().includes(status);
  const count = () => String(columns()[status].length);
  let list!: HTMLDivElement;
  let col!: HTMLElement;
  const lists = (
    <div ref={list} class="board-cards" hidden={folded()}>
      <For each={columns()[status]}>{(s) => (asList ? <Row session={s} /> : <Card session={s} />)}</For>
    </div>
  ) as HTMLElement;
  list.addEventListener('scroll', () => updateListFades(list), { passive: true });
  listSized.observe(list);
  // Cards coming and going change the list's height without resizing it.
  const cardsMoved = new MutationObserver((changes) => {
    for (const c of changes) {
      for (const n of c.addedNodes) if (n instanceof Element) listSized.observe(n);
      for (const n of c.removedNodes) if (n instanceof Element) listSized.unobserve(n);
    }
    updateListFades(list);
  });
  cardsMoved.observe(list, { childList: true });
  for (const c of list.children) listSized.observe(c);
  onCleanup(() => {
    cardsMoved.disconnect();
    listSized.unobserve(list);
    for (const c of list.children) listSized.unobserve(c);
    resized.unobserve(col);
  });
  const header = asList ? (
    <button type="button" class="col-toggle" aria-expanded={!folded()} onClick={() => toggleCollapsed(status)}>
      {icons.chevronDown()}
      <StatusGlyph status={status} />
      <span class="col-name">{name}</span>
      <span class="col-count">{count()}</span>
    </button>
  ) : (
    <>
      <StatusGlyph status={status} />
      <span class="col-name">{name}</span>
      <span class="col-count">{count()}</span>
    </>
  );
  const node = (
    <section
      ref={col}
      class="board-col"
      data-status={status}
      on:dragover={(e) => {
        e.preventDefault();
        clearDropMarks();
        if (folded()) return void col.classList.add('drop-into');
        const before = cardBefore(list, e.clientY);
        if (before) before.classList.add('drop-before');
        else list.classList.add('drop-end');
      }}
      on:dragleave={(e) => !col.contains(e.relatedTarget as Node) && clearDropMarks()}
      on:drop={(e) => {
        e.preventDefault();
        const before = cardBefore(list, e.clientY)?.dataset.id ?? null; // while the dragged card is still marked
        endDrag();
        const id = e.dataTransfer?.getData(CARD_DRAG);
        if (id) void move(id, status, before);
      }}
    >
      <header>
        {header}
        {/* New cards start in Backlog or In progress; the others are reached by moving a card. */}
        {ADDABLE.includes(status) && <NewCardButton status={status} name={name} />}
      </header>
      {lists}
    </section>
  );
  // In the list layout, rows coming, going or folding move the board's own
  // scroll end.
  if (asList) resized.observe(col);
  return node;
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

function Onboarding(): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  async function setUp(): Promise<void> {
    setBusy(true);
    const s = await openSetupCard({ command: DEFAULT_COMMAND, focus: false });
    if (!s) {
      setBusy(false);
      return;
    }
    saveSetting('boardOnboarded', true);
    await setStatus(s, 'in_progress').catch(console.error); // starts its agent; the board stays open
  }
  // The shape of shadcn's Empty: header (icon, title, description), content, link.
  return (
    <div class="board-onboarding">
      <div class="board-onboarding-header">
        <div class="board-onboarding-icon">{icons.boardOnboarding()}</div>
        <h2>Connect your agents</h2>
        <p>
          Cards move on their own when your coding agent reports what it is doing. Let Claude Code wire up its own hooks
          to get started.
        </p>
      </div>
      <div class="board-onboarding-actions">
        <button type="button" class="btn" data-size="sm" disabled={busy()} onClick={() => void setUp()}>
          Set up with Claude Code
        </button>
        <button
          type="button"
          class="btn"
          data-variant="outline"
          data-size="sm"
          onClick={() => saveSetting('boardOnboarded', true)}
        >
          Skip
        </button>
      </div>
      {/* biome-ignore lint/a11y/noAmbiguousAnchorText: the setup screen's link to the board's docs, under its description */}
      <a class="board-onboarding-more" href={BOARD_DOCS} target="_blank" rel="noopener noreferrer">
        Learn more
        {icons.arrowUpRight()}
      </a>
    </div>
  );
}

// The board's columns: the stages, then Archived (reached from a card's menu
// or by a drop, never by a new card).
const BOARD_COLUMNS: typeof COLUMNS = [...COLUMNS, { status: 'archived', name: 'Archived' }];

export function Board(): JSX.Element {
  const isShown = shown;
  const inDrawer = drawer;
  const ready = onboarded;
  const shape = layout;
  const tagFilter = filterTags;
  const folderFilter = filterFolders;
  const list = sessionList;
  const sessions = createMemo((): Columns => {
    const filter = { tags: tagFilter(), folders: folderFilter() };
    const kept = list().filter((s) => matchesFilter({ card: s.card(), tags: s.tags() }, filter));
    const g = group(kept.map((s) => ({ s, card: s.card() })));
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.s)])) as Columns;
  });
  // Its parts: the setup screen, or its columns (keyed by layout too, so
  // switching layouts redraws them).
  const parts = () => (ready() ? BOARD_COLUMNS.map((c) => `${shape()}:${c.status}`) : ['onboarding']);
  let el!: HTMLElement;
  // Columns replacing the setup screen change the scroll width without resizing the board.
  createEffect(
    on([ready, isShown, shape], () => {
      requestAnimationFrame(updateBoardFades);
    }),
  );
  // Each view turn, once the board's and the drawer's changes are on the
  // page: the terminal now in view gets its size and the keyboard. A memo,
  // so a mirror that fires again without a new turn doesn't take the
  // keyboard back.
  const turn = createMemo(viewTurn);
  createEffect(
    on(
      turn,
      () => {
        const term = onScreen();
        if (!term || (isShown() && !inDrawer())) return;
        sendSize(term);
        focusAgentSurface(isChatCard(term), term.id, term.term);
      },
      { defer: true },
    ),
  );
  onCleanup(() => resized.unobserve(el));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on empty space closes the drawer; its own button does from the keyboard
    <section
      ref={(node) => {
        el = node;
        resized.observe(node);
        node.addEventListener('scroll', updateBoardFades, { passive: true });
      }}
      id="board"
      aria-label="Board"
      hidden={!isShown()}
      classList={{ list: shape() === 'list' }}
      // A click on the board's empty space closes the drawer; one on a card
      // opens that card in it instead, and controls keep their own clicks.
      onClick={(e) => {
        if (inDrawer() && !(e.target as Element).closest('.board-card, button, a, input, .move-menu')) {
          go({ drawer: false });
        }
      }}
    >
      <For each={parts()}>
        {(part) => {
          if (part === 'onboarding') return <Onboarding />;
          const [kind, status] = part.split(':');
          const c = BOARD_COLUMNS.find((x) => x.status === status) as (typeof COLUMNS)[number];
          return <Column status={c.status} name={c.name} columns={sessions} asList={kind === 'list'} />;
        }}
      </For>
    </section>
  );
}

// On a phone, the board keeps the active terminal in its drawer: a legacy
// terminals link and a board that started without one both get the drawer.
const PHONE_FIX = { view: 'board', drawer: true } as const;

// Once the router has started, and on a turn into phone size, open the active
// terminal's drawer. A board the person closed by hand is left alone after
// startup.
export function openTerminalOnPhone(): void {
  if (!phone.matches) return;
  if (here().view === 'terms' || (!here().drawer && store.active)) go(PHONE_FIX, 'replace');
}

export function initBoard(): void {
  onPlace('view', (to) => {
    const fix = to.view === 'terms' && phone.matches ? PHONE_FIX : undefined;
    const board = to.view === 'board' || !!fix;
    if (!board) setDrawerExpanded(false);
    showBoard(board);
    // Board alone parks terminals so a drag that launches an agent does not
    // flood xterm while the cards are on screen.
    syncTerminalVisibility();
    return fix;
  });
  phone.addEventListener('change', openTerminalOnPhone);
  onPlace('drawer', (to) => {
    batch(() => {
      setDrawer(to.drawer);
      if (!to.drawer) setDrawerExpanded(false);
      if (to.drawer || !shown()) setViewTurn({});
    });
    syncTerminalVisibility();
    return undefined;
  });
  const boardButton = document.getElementById('board-btn') as HTMLButtonElement;
  keyHint(boardButton, 'Board', 'keyToggleBoard');
  boardButton.onclick = () => cycleBoard(); // as its shortcut: list, columns, back from expanded
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    const btn = document.getElementById('board-filter-btn');
    if (filterMenu && !filterMenu.contains(t) && !btn?.contains(t)) closeFilterMenu();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilterMenu();
  });
  onTagsChange(() => {
    const tags = tagsInUse(sessionList().map((s) => ({ tags: s.tags() })));
    setFilterTags(filterTags().filter((t) => tags.includes(t)));
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
    setOnboarded(s.boardOnboarded); // e.g. the setup screen, once it's dealt with
    setLayout(s.boardLayout);
    if (!s.boardOnboarded) closeFilterMenu();
  });
  setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
}
