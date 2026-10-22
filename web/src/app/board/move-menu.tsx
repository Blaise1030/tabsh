// A card's menu, as Basecoat's dropdown menu (its script opens and closes it,
// and moves through it by keyboard): right-clicking a card, or long-pressing
// one on a phone, opens it at the pointer (view.tsx); the drawer's status
// button opens it below itself. It lists the stages to move the card to (the
// current one checked, and not picked again), its Tags (a submenu,
// tags-submenu.tsx), Edit for a Backlog card still waiting on its prompt
// (in the New card dialog), then Archive (Restore, for an archived card) and
// Delete session.
// Open, its popover is fixed where it was placed, so a column that scrolls
// doesn't clip it; a pointer-opened menu closes once its card scrolls out of
// view.
// Its handlers are native: the root stops clicks and keys before they reach
// the card, so Solid's delegated handlers on the document never see them.
// A row's click goes on to Basecoat's menu, which closes the dropdown.
// biome-ignore-all lint/a11y/useFocusableInteractive: Basecoat's rows: the menu keeps focus and marks the active row
// biome-ignore-all lint/a11y/useSemanticElements: Basecoat's dropdown markup, which its script and styles read
// biome-ignore-all lint/a11y/useAriaPropsForRole: Basecoat's dropdown markup, which its script and styles read
// biome-ignore-all lint/a11y/noRedundantRoles: Basecoat's dropdown markup, which its script and styles read
import { createMemo, type JSX, onCleanup, Show } from 'solid-js';
import { closeSession, type Session } from '../sessions/store.ts';
import { glyph, icons } from '../ui/icons.tsx';
import { STATUS_NAMES } from './glyph.ts';
import { COLUMNS, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { TagsSubmenu } from './tags-submenu.tsx';

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

// Opens the New card dialog on a card, to edit it (set by new-card.tsx).
let editCard: (s: Session) => void = () => {};
export function setEditCard(fn: (s: Session) => void): void {
  editCard = fn;
}

const StatusGlyph = (props: { status: Status }): JSX.Element => (
  <i class="status-glyph" data-status={props.status}>
    {glyph(props.status)}
  </i>
);

// Built under its caller's owner (a card, or the drawer's bar), so its
// bindings go with it.
function MoveMenu(s: () => Session | null, trigger: Record<string, string>, face?: () => JSX.Element): CardMenuHandle {
  const now = createMemo((): Status | null => {
    const session = s();
    return session ? session.card().status : null;
  });
  const moveTo = (status: Status) => {
    const session = s();
    if (session && now() !== status) void setStatus(session, status).catch(console.error);
  };
  // Its prompt can change until it starts.
  const editable = () => {
    const session = s();
    const card = session?.card();
    return session && card?.status === 'backlog' && card.prompt ? session : null;
  };
  const archived = () => now() === 'archived';
  const tags = TagsSubmenu(s);
  const stages = COLUMNS.map(({ status }) => (
    <div
      role="menuitemradio"
      aria-checked={now() === status}
      aria-disabled={now() === status}
      on:click={() => moveTo(status)}
    >
      <StatusGlyph status={status} />
      <span>{STATUS_NAMES[status]}</span>
      {now() === status ? icons.check() : <span />}
    </div>
  ));
  const popover = (
    <div data-popover="" aria-hidden="true" data-align="end">
      <div
        role="menu"
        aria-label="Card"
        tabindex="-1"
        // Pointing at another row closes the Tags submenu.
        on:mouseover={(e) => {
          const row = (e.target as Element).closest('[role^="menuitem"]');
          if (row && row !== tags.row) tags.close();
        }}
      >
        <div role="group" aria-label="Move to">
          <div role="heading">Move to</div>
          {stages}
        </div>
        <hr role="separator" />
        {tags.row}
        <Show when={editable()} keyed fallback={<span hidden />}>
          {(session) => (
            <div role="menuitem" class="menu-edit" on:click={() => editCard(session)}>
              {icons.edit()}
              <span>Edit card</span>
            </div>
          )}
        </Show>
        <hr role="separator" />
        {/* Archive, or for an archived card, Restore (to Backlog). */}
        <div role="menuitem" on:click={() => moveTo(archived() ? 'backlog' : 'archived')}>
          <StatusGlyph status={archived() ? 'backlog' : 'archived'} />
          <span>{archived() ? 'Restore' : 'Archive'}</span>
        </div>
        <div
          role="menuitem"
          class="menu-danger"
          on:click={() => {
            const session = s();
            if (session) void closeSession(session);
          }}
        >
          {icons.trash()}
          <span>Delete session</span>
        </div>
      </div>
    </div>
  ) as HTMLElement;
  const faced = face?.();
  const open = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded="false"
      // Runs before Basecoat's own click (added later).
      on:click={() => placeUnderTrigger()}
    >
      {faced}
    </button>
  ) as HTMLElement;
  for (const [k, v] of Object.entries(trigger)) open.setAttribute(k, v);
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
  const root = (
    <div
      class="dropdown-menu move-menu"
      on:click={(e) => e.stopPropagation()}
      on:keydown={(e) => e.stopPropagation()}
      // A right-click inside the open menu keeps it where it is.
      on:contextmenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {open}
      {popover}
      {tags.panel}
    </div>
  ) as Dropdown;
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
  const closed = new MutationObserver(() => {
    if (open.getAttribute('aria-expanded') === 'true') return;
    tags.close();
    if (closeFocus && root.contains(document.activeElement)) closeFocus();
  });
  closed.observe(open, {
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  onCleanup(() => closed.disconnect());
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
    onCloseFocus(fn: () => void) {
      closeFocus = fn;
    },
    anchorAt(fn: () => HTMLElement) {
      anchor = fn;
    },
  };
}

// A card's menu: its trigger is hidden; the card opens it at the pointer.
export const CardMenu = (s: Session): CardMenuHandle =>
  MoveMenu(() => s, { hidden: '', tabindex: '-1', 'aria-hidden': 'true' });

// The drawer bar's button: the active card's status, by name.
export const DrawerMoveButton = (s: () => Session | null): HTMLElement =>
  MoveMenu(s, { class: 'btn drawer-move', 'data-variant': 'ghost', 'data-size': 'sm', title: 'Move to…' }, () => {
    const status = () => {
      const session = s();
      return session ? session.card().status : 'backlog';
    };
    return (
      <span class="drawer-move-label">
        <StatusGlyph status={status()} />
        {STATUS_NAMES[status()]}
        {icons.chevronDown()}
      </span>
    );
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
