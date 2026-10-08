// A card's menu, as Basecoat's dropdown menu (its script opens and closes it,
// and moves through it by keyboard): a card's ⋯ button on the board, or the
// status's name in the drawer's bar, lists the stages to move it to (the
// current one checked, and not picked again), its Tags (a submenu,
// tags-submenu.ts), then Archive and Delete session.
// Open, its popover is fixed under the button, so a column that scrolls
// doesn't clip it.
import van from 'vanjs-core';
import { closeSession, type Session } from '../sessions/store.ts';
import { glyph, icons } from '../ui/icons.ts';
import { STATUS_NAMES } from './glyph.ts';
import { COLUMNS, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { TagsSubmenu } from './tags-submenu.ts';

const { button, div, hr, i, span } = van.tags;

// Basecoat's root, and this file's own: placing its fixed popover again.
type Dropdown = HTMLElement & { close?: (focusOnTrigger?: boolean) => void; place?: () => void };

const statusGlyph = (status: Status) => i({ class: 'status-glyph', 'data-status': status }, glyph(status));

function MoveMenu(s: () => Session | null, trigger: Record<string, string>, ...face: (() => Node)[]): HTMLElement {
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
        // Pointing at another row closes the Tags submenu.
        onmouseover: (e: MouseEvent) => {
          const row = (e.target as Element).closest('[role^="menuitem"]');
          if (row && row !== tags.row) tags.close();
        },
      },
      div({ role: 'group', 'aria-label': 'Move to' }, div({ role: 'heading' }, 'Move to'), stages),
      hr({ role: 'separator' }),
      tags.row,
      hr({ role: 'separator' }),
      div(
        {
          role: 'menuitem',
          'aria-disabled': () => String(now() === 'archived'),
          onclick: () => moveTo('archived'),
        },
        statusGlyph('archived'),
        span('Archive'),
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
      onclick: () => place(),
    },
    ...face,
  );
  // Under the button, its right edge at the button's.
  const place = () => {
    const r = open.getBoundingClientRect();
    popover.style.top = `${r.bottom + 4}px`;
    popover.style.right = `${innerWidth - r.right}px`;
  };
  // Clicks and keys inside stay here: they must not open or drag the card.
  const root: Dropdown = div(
    {
      class: 'dropdown-menu move-menu',
      onclick: (e: MouseEvent) => e.stopPropagation(),
      onkeydown: (e: KeyboardEvent) => e.stopPropagation(),
    },
    open,
    popover,
    tags.panel,
  );
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
  // The submenu closes with the dropdown.
  new MutationObserver(() => open.getAttribute('aria-expanded') !== 'true' && tags.close()).observe(open, {
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  root.place = () => {
    place();
    tags.close();
  };
  return root;
}

// A card's ⋯ button, opening its menu.
export const CardMenuButton = (s: Session): HTMLElement =>
  MoveMenu(
    () => s,
    { class: 'card-move', title: 'Card menu', 'aria-label': 'Card menu' },
    () => icons.more(),
  );

// The drawer bar's button: the active card's status, by name.
export const DrawerMoveButton = (s: () => Session | null): HTMLElement =>
  MoveMenu(s, { class: 'btn drawer-move', 'data-variant': 'ghost', 'data-size': 'sm', title: 'Move to…' }, () => {
    const status = s()?.card.val.status ?? 'backlog';
    return span({ class: 'drawer-move-label' }, statusGlyph(status), STATUS_NAMES[status], icons.chevronDown());
  });

// A fixed popover doesn't move with the page: as the board scrolls or the
// window resizes, an open one follows its button, and closes once the button
// is out of sight.
export function initMoveMenu(): void {
  const follow = () => {
    for (const m of document.querySelectorAll<Dropdown>('.move-menu')) {
      const button = m.querySelector('[aria-expanded="true"]');
      if (!button) continue;
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) m.close?.(false);
      else m.place?.();
    }
  };
  addEventListener('resize', follow);
  addEventListener('scroll', (e) => !(e.target as Element).closest?.('.move-menu') && follow(), true);
}
