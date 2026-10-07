// A tab on the strip: its card's glyph, its name and its close button, all
// following its session's states. A click picks it, a middle-click or its
// button closes it, a right-click opens its tag menu. A copy (`.mirror`) is
// another group's place for a tab with several tags, and acts for it.
import van from 'vanjs-core';
import { STATUS_NAMES } from '../board/glyph.ts';
import type { Card } from '../board/model.ts';
import { glyph, icons } from '../ui/icons.ts';
import { scoped } from '../ui/keyed.ts';
import { tagBar } from './labels.ts';
import { active, closeSession, pick, type Session } from './store.ts';
import { openTagMenu } from './tags.ts';

const { button, div, i, span } = van.tags;

const statusTitle = (card: Card): string =>
  card.note ? `${STATUS_NAMES[card.status]}: ${card.note}` : STATUS_NAMES[card.status];

const tabSessions = new WeakMap<Element, Session>(); // a tab or copy → its session
const tabs = new WeakMap<Session, HTMLElement>(); // a session → its tab

export function Tab(s: Session, opts: { group?: string; copy?: boolean } = {}): HTMLElement {
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = van.derive(() => s.card.val.status);
  const t = div(
    {
      class: opts.copy ? 'tab mirror' : 'tab entering',
      role: 'tab',
      'aria-selected': () => String(active.val === s),
      title: () => s.name.val,
      onclick: () => pick(s),
      onauxclick: (e: MouseEvent) => e.button === 1 && closeSession(s), // middle-click closes
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        openTagMenu(s, e.clientX, e.clientY);
      },
    },
    i(
      {
        class: 'tab-status',
        'aria-hidden': 'true',
        'data-status': () => status.val,
        title: () => statusTitle(s.card.val),
      },
      () => glyph(status.val),
    ),
    span({ class: 'tab-name' }, () => s.name.val),
    button(
      {
        type: 'button',
        class: 'btn',
        'data-variant': 'ghost',
        'data-size': 'icon-xs',
        'aria-label': 'Close terminal',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          closeSession(s);
        },
      },
      icons.close(),
    ),
  );
  if (opts.group !== undefined) t.dataset.group = opts.group;
  // Toggled one by one, so the strip's own classes (dragging, …) stay.
  const mark = (name: string, on: () => boolean) => van.derive(() => t.classList.toggle(name, on()));
  mark('active', () => active.val === s);
  mark('bell', () => s.bell.val);
  mark('unread', () => s.unread.val);
  mark('archived', () => s.card.val.status === 'archived');
  mark('tagged', () => s.tags.val.length > 0);
  mark('leaving', () => s.leaving.val);
  // A tagged tab shows a bar in its tags' colors.
  van.derive(() => s.tags.val.length && t.style.setProperty('--tag', tagBar(s.tags.val)));
  tabSessions.set(t, s);
  if (opts.copy) return t;
  // It grows in from nothing: the collapsed state is drawn first, then let go.
  requestAnimationFrame(() => {
    void t.offsetWidth;
    t.classList.remove('entering');
  });
  // It was zero-width when activated; bring it fully into view once grown.
  t.addEventListener('transitionend', function grown(e) {
    if (e.propertyName !== 'max-width') return;
    t.removeEventListener('transitionend', grown);
    if (active.val === s) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  return t;
}

// A session's tab, made on first use. The grouped strip (groups.ts) moves
// these same nodes into its groups. Its derives go once it leaves the page.
export function tabOf(s: Session): HTMLElement {
  let t = tabs.get(s);
  if (!t) {
    t = scoped(() => Tab(s));
    tabs.set(s, t);
  }
  return t;
}

// The session a tab (or a copy of one) stands for.
export const sessionOfTab = (t: Element): Session | undefined => tabSessions.get(t);
