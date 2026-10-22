// The touch key bar under the terminal: a paperclip to attach files, Paste,
// the keys a phone keyboard lacks (Esc, Ctrl, Tab, arrows), Space and Enter
// in reach, and symbols it hides a page away. Shown on touch screens
// only (CSS). Its buttons never take focus, so the keyboard stays up.
import type { JSX } from 'solid-js';
import { uploadFile } from '../daemon/client.ts';
import { shellQuote } from '../ui/drop-paths.ts';
import { icons } from '../ui/icons.tsx';
import { fromVan } from '../ui/interop.ts';
import type { ExtraKey } from './extra-keys.ts';
import { onScreen, type Session, screen } from './store.ts';
import { ctrlHeld, typeKey } from './terminal.tsx';

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

// On each button's own pointerdown, natively, so focus never moves.
const keep = (e: Event) => e.preventDefault();

// The bar, and its paste sheet (outside it: the bar is display: none off
// touch screens, and a hidden ancestor would hide the open sheet too).
export function KeyBar(): JSX.Element {
  const [esc, ...rest] = KEYS;
  const shown = fromVan(screen);
  const ctrl = fromVan(ctrlHeld);
  const [pasteButton, sheet] = Paste();
  let bar!: HTMLDivElement;
  const view = (
    <>
      <div ref={bar} class="keybar" role="toolbar" aria-label="Terminal keys" hidden={!shown()}>
        <Attach />
        {pasteButton}
        {key(...esc)}
        <button
          type="button"
          aria-label="Control"
          aria-pressed={ctrl()}
          on:pointerdown={keep}
          onClick={() => {
            ctrlHeld.val = !ctrlHeld.val;
          }}
        >
          Ctrl
        </button>
        {rest.map((k) => key(...k))}
      </div>
      {sheet}
    </>
  );
  // An edge fades while keys are scrolled past it, as the tab strip's does.
  const fades = () => {
    const end = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle('fade-left', bar.scrollLeft > 1);
    bar.classList.toggle('fade-right', bar.scrollLeft < end - 1);
  };
  bar.addEventListener('scroll', fades, { passive: true });
  new ResizeObserver(fades).observe(bar);
  return view;
}

function key(id: ExtraKey, label: string, name: string): JSX.Element {
  return (
    <button type="button" aria-label={name} on:pointerdown={keep} onClick={() => typeKey(id)}>
      {label}
    </button>
  );
}

// Picked files are uploaded and their saved copies' paths typed at the
// prompt, as a dropped file's are (ui/drop.ts).
function Attach(): JSX.Element {
  let picker!: HTMLInputElement;
  return (
    <>
      <button type="button" aria-label="Attach files" on:pointerdown={keep} onClick={() => picker.click()}>
        {icons.paperclip()}
      </button>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        on:change={async () => {
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
        }}
      />
    </>
  );
}

// Paste reads the clipboard where the page may (HTTPS, localhost). Over plain
// HTTP there is no clipboard API, and the terminal's long press selects
// rather than offering the system's Paste, so a sheet opens with a real text
// box: the phone's own Paste works there and goes straight to the terminal.
// A keyboard's clipboard chip types instead of pasting, so Send takes that.
function Paste(): [JSX.Element, JSX.Element] {
  let target: Session | null = null;
  let box!: HTMLTextAreaElement;
  let sheet!: HTMLDialogElement;
  const deliver = (text: string) => {
    if (text && target && !target.closed) target.term.paste(text);
    sheet.close();
  };
  const dialog = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop; Esc closes it from the keyboard
    <dialog
      ref={sheet}
      class="paste-sheet"
      aria-label="Paste"
      onClick={(e) => e.target === sheet && sheet.close()} // the backdrop
      on:close={() => {
        box.value = '';
        target?.term.focus();
        target = null;
      }}
    >
      <textarea
        ref={box}
        aria-label="Paste text"
        placeholder="Long-press here and Paste"
        rows={4}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        on:paste={(e) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          if (!text) return;
          e.preventDefault();
          deliver(text);
        }}
      />
      <div class="paste-actions">
        <button type="button" class="btn" data-variant="ghost" onClick={() => sheet.close()}>
          Cancel
        </button>
        <button type="button" class="btn" onClick={() => deliver(box.value)}>
          Send
        </button>
      </div>
    </dialog>
  );
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
  const pasteButton = (
    <button type="button" aria-label="Paste" on:pointerdown={keep} onClick={() => void open()}>
      {icons.clipboardPaste()}
    </button>
  );
  return [pasteButton, dialog];
}
