// The card's own bar: Agent, its side terminals, and + for another shell.
import van from 'vanjs-core';
import { api } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { icons } from '../ui/icons.tsx';
import { active, closeSession, onScreen, type Session, type SessionInfo } from './store.ts';
import { openSession } from './terminal.ts';

const { button, div, span } = van.tags;

const mark = (el: HTMLElement, name: string, on: () => boolean) => van.derive(() => el.classList.toggle(name, on()));

export function SessionBar(): HTMLElement {
  return div(
    {
      id: 'session-bar',
      role: 'tablist',
      'aria-label': 'Card terminals',
      hidden: () => !active.val,
    },
    () => {
      const card = active.val;
      if (!card) return span();
      return div(
        { class: 'session-bar-row' },
        agentTab(card),
        ...card.sides.val.map((side) => sideTab(side)),
        button(
          {
            type: 'button',
            class: 'btn session-add',
            'data-variant': 'ghost',
            'data-size': 'icon-xs',
            'aria-label': 'New terminal',
            title: 'New terminal',
            onclick: () => void addSide(card),
          },
          icons.plus(),
        ),
      );
    },
  );
}

function agentTab(card: Session): HTMLButtonElement {
  const el = button(
    {
      type: 'button',
      class: 'side-tab',
      role: 'tab',
      onclick: () => {
        if (onScreen() === card) card.term.focus();
        else go({ term: null });
      },
    },
    span({ class: 'tab-name' }, 'Agent'),
  );
  mark(el, 'active', () => onScreen() === card);
  mark(el, 'bell', () => card.bell.val);
  mark(el, 'unread', () => card.unread.val);
  el.setAttribute('aria-selected', 'false');
  van.derive(() => el.setAttribute('aria-selected', String(onScreen() === card)));
  return el;
}

function sideTab(side: Session): HTMLElement {
  const el = div(
    {
      class: 'side-tab',
      role: 'tab',
      onclick: () => {
        if (onScreen() === side) side.term.focus();
        else go({ term: side.id });
      },
      onauxclick: (e: MouseEvent) => e.button === 1 && closeSession(side),
    },
    span({ class: 'tab-name' }, () => side.name.val),
    button(
      {
        type: 'button',
        class: 'btn',
        'data-variant': 'ghost',
        'data-size': 'icon-xs',
        'aria-label': 'Close terminal',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          void closeSession(side);
        },
      },
      icons.close(),
    ),
  );
  mark(el, 'active', () => onScreen() === side);
  mark(el, 'bell', () => side.bell.val);
  mark(el, 'unread', () => side.unread.val);
  van.derive(() => el.setAttribute('aria-selected', String(onScreen() === side)));
  return el;
}

async function addSide(card: Session): Promise<void> {
  const info = (await api<SessionInfo>('POST', '', { parent: card.id })) as SessionInfo | null;
  if (!info) return;
  openSession(info);
  go({ term: info.id });
}
