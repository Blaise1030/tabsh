// A card's menu, as Basecoat's dropdown menu (its script opens and closes it,
// and moves through it by keyboard): right-clicking a card, or long-pressing
// one on a phone, opens it at the pointer (view.ts); the drawer's status
// button opens it below itself. It lists the stages to move the card to (the
// current one checked, and not picked again), its Tags (a submenu,
// tags-submenu.ts), Edit for a Backlog card still waiting on its prompt
// (in the New card dialog), then Archive (Restore, for an archived card) and
// Delete session.
// Open, its popover is fixed where it was placed, so a column that scrolls
// doesn't clip it; a pointer-opened menu closes once its card scrolls out of
// view.
import van from 'vanjs-core';
import { closeSession, type Session } from '../sessions/store.ts';
import { glyph, icons } from '../ui/icons.tsx';
import { STATUS_NAMES } from './glyph.ts';
import { COLUMNS, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { TagsSubmenu } from './tags-submenu.ts';

const { button, div, hr, i, span } = van.tags;

// Basecoat's root, and this file's own: placing its fixed popover again.
type Dropdown = HTMLElement & {
  open?: (focusFirst?: boolean) => void;
  close?: (focusOnTrigger?: boolean) => void;
  place?: () => void;
  anchor?: () => HTMLElement | null;
};

// What a card needs to open its menu where it was clicked or long-pressed.
export interface CardMenuHandle {
  root: HTMLElement;
  openAt(x: number, y: number, focusFirst?: boolean): void;
  onCloseFocus(fn: () => void): void;
  anchorAt(fn: () => HTMLElement): void;
}

// Opens the New card dialog on a card, to edit it (set by new-card.ts).
let editCard: (s: Session) => void = () => {};
export function setEditCard(fn: (s: Session) => void): void {
  editCard = fn;
}

const statusGlyph = (status: Status) => i({ class: 'status-glyph', 'data-status': status }, glyph(status));

function MoveMenu(s: () => Session | null, trigger: Record<string, string>, ...face: (() => Node)[]): CardMenuHandle {
  const now = (): Status | null => s()?.card.val.status ?? null;
  const moveTo = (status: Status) => {
    const session = s();
    if (session && now() !== status) void setStatus(session, status).catch(console.error);
  };
  const stages = COLUMNS.map(({ status }) =>
    div(
      {
        role: 'menuitemradio',
        'aria-checked': () => String(now() === status),
        'aria-disabled': () => String(now() === status),
        onclick: () => moveTo(status),
      },
      statusGlyph(status),
      span(STATUS_NAMES[status]),
      () => (now() === status ? icons.check() : span()),
    ),
  );
  const tags = TagsSubmenu(s);
  const popover = div(
    { 'data-popover': '', 'aria-hidden': 'true', 'data-align': 'end' },
    div(
      {
        role: 'menu',
        'aria-label': 'Card',
        tabindex: '-1',
        // Pointing at another row closes the Tags submenu.
        onmouseover: (e: MouseEvent) => {
          const row = (e.target as Element).closest('[role^="menuitem"]');
          if (row && row !== tags.row) tags.close();
        },
      },
      div({ role: 'group', 'aria-label': 'Move to' }, div({ role: 'heading' }, 'Move to'), stages),
      hr({ role: 'separator' }),
      tags.row,
      // Its prompt can change until it starts.
      () => {
        const session = s();
        const card = session?.card.val;
        return session && card?.status === 'backlog' && card.prompt
          ? div(
              { role: 'menuitem', class: 'menu-edit', onclick: () => editCard(session) },
              icons.edit(),
              span('Edit card'),
            )
          : span({ hidden: true });
      },
      hr({ role: 'separator' }),
      // Archive, or for an archived card, Restore (to Backlog).
      div(
        { role: 'menuitem', onclick: () => moveTo(now() === 'archived' ? 'backlog' : 'archived') },
        () => statusGlyph(now() === 'archived' ? 'backlog' : 'archived'),
        () => span(now() === 'archived' ? 'Restore' : 'Archive'),
      ),
      div(
        {
          role: 'menuitem',
          class: 'menu-danger',
          onclick: () => {
            const session = s();
            if (session) void closeSession(session);
          },
        },
        icons.trash(),
        span('Delete session'),
      ),
    ),
  );
  const open: HTMLElement = button(
    {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      ...trigger,
      // Runs before Basecoat's own click (added later).
      onclick: () => placeUnderTrigger(),
    },
    ...face,
  );
  // Under the drawer's button, its right edge at the button's.
  const placeUnderTrigger = () => {
    const r = open.getBoundingClientRect();
    popover.style.left = '';
    popover.style.top = `${r.bottom + 4}px`;
    popover.style.right = `${innerWidth - r.right}px`;
  };
  // At the pointer, kept inside the window.
  const placeAt = (x: number, y: number) => {
    const width = popover.offsetWidth || 200;
    const height = popover.offsetHeight || 200;
    popover.style.right = '';
    popover.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  };
  // Clicks and keys inside stay here: they must not open or drag the card.
  const root: Dropdown = div(
    {
      class: 'dropdown-menu move-menu',
      onclick: (e: MouseEvent) => e.stopPropagation(),
      onkeydown: (e: KeyboardEvent) => e.stopPropagation(),
      // A right-click inside the open menu keeps it where it is.
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      },
    },
    open,
    popover,
    tags.panel,
  );
  let closeFocus: (() => void) | null = null;
  let anchor: (() => HTMLElement) | null = null;
  // → (or Enter, Space) on the highlighted Tags row opens the submenu; caught
  // before Basecoat's own keys, which would click the row and close.
  root.addEventListener(
    'keydown',
    (e) => {
      if (tags.panel.contains(e.target as Node)) return; // the submenu's own keys
      if (!tags.row.classList.contains('active') || !['ArrowRight', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      tags.open(true);
    },
    true,
  );
  // The submenu closes with the dropdown; a closed menu hands focus back to
  // whatever opened it (the card), since Basecoat's trigger is hidden.
  new MutationObserver(() => {
    if (open.getAttribute('aria-expanded') === 'true') return;
    tags.close();
    if (closeFocus && root.contains(document.activeElement)) closeFocus();
  }).observe(open, {
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  root.place = () => {
    placeUnderTrigger();
    tags.close();
  };
  const openAt = (x: number, y: number, focusFirst = false) => {
    root.open?.(focusFirst);
    placeAt(x, y);
    tags.close();
    if (focusFirst) popover.querySelector<HTMLElement>('[role="menu"]')?.focus();
  };
  root.anchor = () => (anchor ? anchor() : null);
  return {
    root,
    openAt,
    onCloseFocus(fn) {
      closeFocus = fn;
    },
    anchorAt(fn) {
      anchor = fn;
    },
  };
}

// A card's menu: its trigger is hidden; the card opens it at the pointer.
export const CardMenu = (s: Session): CardMenuHandle =>
  MoveMenu(() => s, { hidden: 'true', tabindex: '-1', 'aria-hidden': 'true' });

// The drawer bar's button: the active card's status, by name.
export const DrawerMoveButton = (s: () => Session | null): HTMLElement =>
  MoveMenu(s, { class: 'btn drawer-move', 'data-variant': 'ghost', 'data-size': 'sm', title: 'Move to…' }, () => {
    const status = s()?.card.val.status ?? 'backlog';
    return span({ class: 'drawer-move-label' }, statusGlyph(status), STATUS_NAMES[status], icons.chevronDown());
  }).root;

// A fixed popover doesn't move with the page: as the board scrolls or the
// window resizes, a drawer-opened one follows its button, and a pointer-opened
// one (its trigger is hidden) closes once its card scrolls away.
export function initMoveMenu(): void {
  const follow = () => {
    for (const m of document.querySelectorAll<Dropdown>('.move-menu')) {
      const button = m.querySelector<HTMLElement>(':scope > button[aria-expanded="true"]');
      if (!button) continue;
      if (button.hidden) {
        // A pointer-opened menu has no visible trigger to follow: close it
        // once its card scrolls out of view.
        const card = m.anchor?.();
        if (!card) continue;
        const c = card.getBoundingClientRect();
        if (c.width === 0 || c.right < 0 || c.left > innerWidth || c.bottom < 0 || c.top > innerHeight)
          m.close?.(false);
        continue;
      }
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) m.close?.(false);
      else m.place?.();
    }
  };
  addEventListener('resize', follow);
  addEventListener('scroll', (e) => !(e.target as Element).closest?.('.move-menu') && follow(), true);
  // A pointer-opened menu keeps focus on the card, outside Basecoat's root,
  // so its own Escape key never reaches the dropdown.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const m of document.querySelectorAll<Dropdown>('.move-menu')) {
      if (m.querySelector(':scope > button[aria-expanded="true"]')) m.close?.(false);
    }
  });
}
