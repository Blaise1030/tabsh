// The touch key bar under the terminal: the keys a phone keyboard lacks (Esc,
// Ctrl, Tab, arrows), Space and Enter in reach, and symbols it hides a page
// away. Shown on touch screens
// only (CSS). Its buttons never take focus, so the keyboard stays up.
import van from 'vanjs-core';
import type { ExtraKey } from './extra-keys.ts';
import { active } from './store.ts';
import { ctrlHeld, typeKey } from './terminal.ts';

const { button, div } = van.tags;

const KEYS: [ExtraKey, string, string][] = [
  ['esc', 'Esc', 'Escape'],
  ['tab', 'Tab', 'Tab'],
  ['space', 'Space', 'Space'],
  ['enter', '⏎', 'Enter'],
  ['up', '↑', 'Up'],
  ['down', '↓', 'Down'],
  ['left', '←', 'Left'],
  ['right', '→', 'Right'],
  ['|', '|', 'Pipe'],
  ['~', '~', 'Tilde'],
  ['/', '/', 'Slash'],
  ['-', '-', 'Dash'],
];

const keep = (e: Event) => e.preventDefault();

export function KeyBar(): HTMLElement {
  const [esc, ...rest] = KEYS;
  return div(
    { class: 'keybar', role: 'toolbar', 'aria-label': 'Terminal keys', hidden: () => !active.val },
    key(...esc),
    button(
      {
        type: 'button',
        'aria-label': 'Control',
        'aria-pressed': () => String(ctrlHeld.val),
        onpointerdown: keep,
        onclick: () => {
          ctrlHeld.val = !ctrlHeld.val;
        },
      },
      'Ctrl',
    ),
    ...rest.map((k) => key(...k)),
  );
}

function key(id: ExtraKey, label: string, name: string): HTMLElement {
  return button({ type: 'button', 'aria-label': name, onpointerdown: keep, onclick: () => typeKey(id) }, label);
}
