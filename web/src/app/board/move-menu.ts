// A card's Move menu: its status glyph on the board, or the status's name in
// the drawer's bar, opens a list of the statuses to move it to. Archive is
// last; the current status is checked and can't be picked.
import van from 'vanjs-core';
import { menuStep } from '../explorer/listing.ts';
import type { Session } from '../sessions/store.ts';
import { glyph, icons } from '../ui/icons.ts';
import { STATUS_NAMES } from './glyph.ts';
import { STATUSES, type Status } from './model.ts';
import { setStatus } from './status.ts';

const { button, div, i, span } = van.tags;

let menu: HTMLElement | null = null;
let opener: HTMLElement | null = null;

function closeMenu(focusOpener = false): void {
  menu?.remove();
  menu = null;
  opener?.setAttribute('aria-expanded', 'false');
  if (focusOpener) opener?.focus();
  opener = null;
}

const statusGlyph = (status: Status) => i({ class: 'status-glyph', 'data-status': status }, glyph(status));

function moveMenu(s: Session): HTMLElement {
  const now = s.card.val.status;
  const items = STATUSES.map((status) =>
    button(
      {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(status === now),
        disabled: status === now,
        onclick: () => {
          closeMenu();
          void setStatus(s, status).catch(console.error);
        },
      },
      statusGlyph(status),
      span(status === 'archived' ? 'Archive' : STATUS_NAMES[status]),
      status === now ? icons.check() : '',
    ),
  );
  const m = div({ class: 'row-menu move-menu', role: 'menu', 'aria-label': 'Move to' }, items);
  // Arrows, Home and End move between the items that can be picked; Escape
  // closes and gives focus back to the button.
  const live = items.filter((b) => !b.disabled);
  m.addEventListener('keydown', (e) => {
    const to = menuStep(live.indexOf(document.activeElement as HTMLButtonElement), live.length, e.key);
    if (e.key !== 'Escape' && to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (to === null) closeMenu(true);
    else live[to]?.focus();
  });
  return m;
}

// Opens `s`'s menu under `from`, its right edge at the button's, kept inside
// the window.
function openMenu(s: Session, from: HTMLElement): void {
  const again = opener === from;
  closeMenu();
  if (again) return; // a second click closes it
  const m = moveMenu(s);
  const r = from.getBoundingClientRect();
  m.style.top = `${r.bottom + 4}px`;
  document.body.append(m);
  m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
  menu = m;
  opener = from;
  from.setAttribute('aria-expanded', 'true');
  m.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
}

// The button's click and keys stay its own: they must not open or drag the
// card under it.
const trigger = (s: () => Session | null, props: Record<string, string>, ...kids: (Node | (() => Node))[]) => {
  const b: HTMLElement = button(
    {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      ...props,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        const session = s();
        if (session) openMenu(session, b);
      },
      onkeydown: (e: KeyboardEvent) => e.stopPropagation(), // Enter/Space here must not open the card
    },
    ...kids,
  );
  return b;
};

// A card's status glyph, as the button that opens its menu.
export const CardMoveButton = (s: Session, status: () => Status): HTMLElement =>
  trigger(
    () => s,
    { class: 'card-move', title: 'Move to…', 'aria-label': 'Move to…' },
    () => statusGlyph(status()),
  );

// The drawer bar's button: the active card's status, by name.
export const DrawerMoveButton = (s: () => Session | null): HTMLElement =>
  trigger(s, { class: 'btn drawer-move', 'data-variant': 'ghost', 'data-size': 'sm', title: 'Move to…' }, () => {
    const status = s()?.card.val.status ?? 'backlog';
    return span({ class: 'drawer-move-label' }, statusGlyph(status), STATUS_NAMES[status], icons.chevronDown());
  });

export function initMoveMenu(): void {
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !opener?.contains(t)) closeMenu();
  });
  addEventListener('keydown', (e) => menu && e.key === 'Escape' && closeMenu(true));
  addEventListener('resize', () => closeMenu());
  // A board that scrolls under it leaves the menu pointing at nothing.
  addEventListener('scroll', () => closeMenu(), true);
}
