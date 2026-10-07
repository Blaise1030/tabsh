// The screens shown while the daemon can't be reached: start it, open its
// own copy of the page (Safari), or pair this browser with it.
import van from 'vanjs-core';
import { gateMode } from '../daemon/client.ts';

const { a, button, div, form, h2, input, p, pre, span } = van.tags;

const heading = (text: string) => h2(span({ class: 'mark' }, '#'), ` ${text}`);
const command = () => pre({ class: 'cmd' }, span({ class: 'mark' }, '$'), ' tabsh');

export function Gate(): HTMLElement {
  return div(
    { class: 'empty', id: 'gate', hidden: () => gateMode.val === null },
    div(
      { 'data-gate': 'offline', hidden: () => gateMode.val !== 'offline' },
      heading("CAN'T REACH TABSH ON THIS COMPUTER"),
      p("Start it in a terminal. This page connects as soon as it's up."),
      command(),
      p({ class: 'mark' }, '> If your browser asks to let this site reach apps on your device, allow it.'),
    ),
    div(
      { 'data-gate': 'safari', hidden: () => gateMode.val !== 'safari' },
      heading('OPEN TABSH FROM YOUR COMPUTER'),
      p(
        "Safari doesn't let websites reach apps on your computer, so tabsh serves this page itself. Start it if it isn't running:",
      ),
      command(),
      p(a({ class: 'btn', id: 'open-local', href: '#' }, 'Open tabsh')),
      p({ class: 'mark' }, '> Add it to your Dock (File → Add to Dock) to open it like an app.'),
    ),
    div(
      { 'data-gate': 'pair', hidden: () => gateMode.val !== 'pair' },
      heading('PAIR THIS BROWSER WITH TABSH'),
      p('Open the link tabsh printed when it started, or paste it here.'),
    ),
    form(
      { 'data-gate': 'pair', id: 'pair-form', hidden: () => gateMode.val !== 'pair' },
      input({
        class: 'input',
        id: 'pair-input',
        placeholder: 'https://…/app/#token=…',
        autocomplete: 'off',
        spellcheck: false,
        'aria-label': 'Pairing link or token',
      }),
      button({ type: 'submit', class: 'btn' }, 'Pair'),
    ),
  );
}
