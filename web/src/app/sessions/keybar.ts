// The touch key bar under the terminal: a paperclip to attach files, Paste,
// the keys a phone keyboard lacks (Esc, Ctrl, Tab, arrows), Space and Enter
// in reach, and symbols it hides a page away. Shown on touch screens
// only (CSS). Its buttons never take focus, so the keyboard stays up.
import van from 'vanjs-core';
import { uploadFile } from '../daemon/client.ts';
import { shellQuote } from '../ui/drop-paths.ts';
import { icons } from '../ui/icons.tsx';
import type { ExtraKey } from './extra-keys.ts';
import { onScreen, type Session } from './store.ts';
import { ctrlHeld, typeKey } from './terminal.ts';

const { button, dialog, div, input, textarea } = van.tags;

const KEYS: [ExtraKey, string, string][] = [
  ['esc', 'Esc', 'Escape'],
  ['ctrl-c', '^C', 'Control C'],
  ['tab', 'Tab', 'Tab'],
  ['shift-tab', '⇧Tab', 'Shift Tab'],
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

// The bar, and its paste sheet (outside it: the bar is display: none off
// touch screens, and a hidden ancestor would hide the open sheet too).
export function KeyBar(): HTMLElement[] {
  const [esc, ...rest] = KEYS;
  const [pasteButton, sheet] = Paste();
  const bar = div(
    { class: 'keybar', role: 'toolbar', 'aria-label': 'Terminal keys', hidden: () => !onScreen() },
    ...Attach(),
    pasteButton,
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
  // An edge fades while keys are scrolled past it, as the tab strip's does.
  const fades = () => {
    const end = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle('fade-left', bar.scrollLeft > 1);
    bar.classList.toggle('fade-right', bar.scrollLeft < end - 1);
  };
  bar.addEventListener('scroll', fades, { passive: true });
  new ResizeObserver(fades).observe(bar);
  return [bar, sheet];
}

function key(id: ExtraKey, label: string, name: string): HTMLElement {
  return button({ type: 'button', 'aria-label': name, onpointerdown: keep, onclick: () => typeKey(id) }, label);
}

// Picked files are uploaded and their saved copies' paths typed at the
// prompt, as a dropped file's are (ui/drop.ts).
function Attach(): HTMLElement[] {
  const picker = input({
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: async () => {
      const files = [...(picker.files ?? [])];
      picker.value = '';
      const target = onScreen();
      if (!target || !files.length) return;
      try {
        const paths = await Promise.all(files.map(uploadFile));
        if (target.closed) return;
        target.term.paste(`${paths.map(shellQuote).join(' ')} `);
        target.term.focus();
      } catch (err) {
        console.error(err);
      }
    },
  });
  return [
    button(
      { type: 'button', 'aria-label': 'Attach files', onpointerdown: keep, onclick: () => picker.click() },
      icons.paperclip(),
    ),
    picker,
  ];
}

// Paste reads the clipboard where the page may (HTTPS, localhost). Over plain
// HTTP there is no clipboard API, and the terminal's long press selects
// rather than offering the system's Paste, so a sheet opens with a real text
// box: the phone's own Paste works there and goes straight to the terminal.
// A keyboard's clipboard chip types instead of pasting, so Send takes that.
function Paste(): [HTMLElement, HTMLDialogElement] {
  let target: Session | null = null;
  const box = textarea({
    'aria-label': 'Paste text',
    placeholder: 'Long-press here and Paste',
    rows: 4,
    spellcheck: false,
    autocapitalize: 'off',
  });
  box.setAttribute('autocorrect', 'off');
  const deliver = (text: string) => {
    if (text && target && !target.closed) target.term.paste(text);
    sheet.close();
  };
  box.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    e.preventDefault();
    deliver(text);
  });
  const sheet = dialog(
    {
      class: 'paste-sheet',
      'aria-label': 'Paste',
      onclick: (e: MouseEvent) => e.target === sheet && sheet.close(), // the backdrop
      onclose: () => {
        box.value = '';
        target?.term.focus();
        target = null;
      },
    },
    box,
    div(
      { class: 'paste-actions' },
      button({ type: 'button', class: 'btn', 'data-variant': 'ghost', onclick: () => sheet.close() }, 'Cancel'),
      button({ type: 'button', class: 'btn', onclick: () => deliver(box.value) }, 'Send'),
    ),
  ) as HTMLDialogElement;
  const open = async () => {
    const s = onScreen();
    if (!s) return;
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          s.term.paste(text);
          s.term.focus();
          return;
        }
      } catch {
        // Refused: the sheet still works.
      }
    }
    target = s;
    sheet.showModal();
    box.focus();
  };
  const pasteButton = button(
    { type: 'button', 'aria-label': 'Paste', onpointerdown: keep, onclick: () => void open() },
    icons.clipboardPaste(),
  );
  return [pasteButton, sheet];
}
