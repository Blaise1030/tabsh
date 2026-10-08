// A card's Move menu, as Basecoat's dropdown menu (its script opens and
// closes it, and moves through it by keyboard): the card's status glyph on
// the board, or the status's name in the drawer's bar, lists the statuses to
// move it to, Archive last. The current one is checked and can't be picked.
// Open, its popover is fixed under the button, so a column that scrolls
// doesn't clip it.
import van from 'vanjs-core';
import type { Session } from '../sessions/store.ts';
import { glyph, icons } from '../ui/icons.ts';
import { STATUS_NAMES } from './glyph.ts';
import { STATUSES, type Status } from './model.ts';
import { setStatus } from './status.ts';

const { button, div, i, span } = van.tags;

type Dropdown = HTMLElement & { close?: (focusOnTrigger?: boolean) => void };

const statusGlyph = (status: Status) => i({ class: 'status-glyph', 'data-status': status }, glyph(status));

function MoveMenu(s: () => Session | null, trigger: Record<string, string>, ...face: (() => Node)[]): HTMLElement {
  const now = (): Status | null => s()?.card.val.status ?? null;
  const items = STATUSES.map((status) =>
    div(
      {
        role: 'menuitemradio',
        'aria-checked': () => String(now() === status),
        'aria-disabled': () => String(now() === status),
        onclick: () => {
          const session = s();
          if (session && now() !== status) void setStatus(session, status).catch(console.error);
        },
      },
      statusGlyph(status),
      span(status === 'archived' ? 'Archive' : STATUS_NAMES[status]),
      () => (now() === status ? icons.check() : span()),
    ),
  );
  const popover = div(
    { 'data-popover': '', 'aria-hidden': 'true', 'data-align': 'end' },
    div({ role: 'menu', 'aria-label': 'Move to' }, items),
  );
  const open: HTMLElement = button(
    {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      ...trigger,
      // Runs before Basecoat's own click (added later): place the popover
      // under the button, its right edge at the button's.
      onclick: () => {
        const r = open.getBoundingClientRect();
        popover.style.top = `${r.bottom + 4}px`;
        popover.style.right = `${innerWidth - r.right}px`;
      },
    },
    ...face,
  );
  // Clicks and keys inside stay here: they must not open or drag the card.
  return div(
    {
      class: 'dropdown-menu move-menu',
      onclick: (e: MouseEvent) => e.stopPropagation(),
      onkeydown: (e: KeyboardEvent) => e.stopPropagation(),
    },
    open,
    popover,
  );
}

// A card's status glyph, as the button that opens its menu.
export const CardMoveButton = (s: Session, status: () => Status): HTMLElement =>
  MoveMenu(
    () => s,
    { class: 'card-move', title: 'Move to…', 'aria-label': 'Move to…' },
    () => statusGlyph(status()),
  );

// The drawer bar's button: the active card's status, by name.
export const DrawerMoveButton = (s: () => Session | null): HTMLElement =>
  MoveMenu(s, { class: 'btn drawer-move', 'data-variant': 'ghost', 'data-size': 'sm', title: 'Move to…' }, () => {
    const status = s()?.card.val.status ?? 'backlog';
    return span({ class: 'drawer-move-label' }, statusGlyph(status), STATUS_NAMES[status], icons.chevronDown());
  });

// A fixed popover stays put while the board scrolls or the window resizes:
// close it instead.
export function initMoveMenu(): void {
  const closeAll = () => {
    for (const m of document.querySelectorAll<Dropdown>('.move-menu')) {
      if (m.querySelector('[aria-expanded="true"]')) m.close?.(false);
    }
  };
  addEventListener('resize', closeAll);
  addEventListener('scroll', (e) => !(e.target as Element).closest?.('.move-menu') && closeAll(), true);
}
