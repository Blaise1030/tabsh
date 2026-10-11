// The welcome tour's dialog: one full-page screen per WELCOME_SCREENS entry,
// opened on first load (initWelcome), walked with Continue, left with Skip.
// The view, theme, font and sound screens carry their choices; the agents
// screen's setup comes with its own task.
import van from 'vanjs-core';
import { gateMode } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { FONTS, fontStack, THEMES, TYPING_SOUNDS } from '../settings/catalog.ts';
import { current, saveSetting, saveSettings } from '../settings/settings.ts';
import { previewSound } from '../sound/packs.ts';
import { clampStep, dismissWelcome, viewChoice, viewSettings, WELCOME_SCREENS } from './steps.ts';

const { button, dialog, div, footer, h2, p, span } = van.tags;

// Which screen is on show; showWelcome resets it.
const step = van.state(0);
// The view picked on this opening, null until one is: its being set is also
// what makes closing move the app there.
const pickedView = van.state<'tabs' | 'kanban' | 'list' | null>(null);

const on = () => WELCOME_SCREENS[step.val];
const el = () => document.getElementById('welcome') as HTMLDialogElement;

// The view screen's three choices, as the saved settings name the chosen one.
const chosenView = (): 'tabs' | 'kanban' | 'list' => viewChoice(current.saved.startView, current.saved.boardLayout);

function pickView(choice: 'tabs' | 'kanban' | 'list'): void {
  saveSettings(viewSettings(choice, current.saved.boardLayout));
  pickedView.val = choice;
}

// Every way out of the tour lands here: the dialog closes and, if this
// opening picked a view, the router moves the app there. It writes nothing —
// a caller saves first.
function closeWelcome(): void {
  el().close();
  if (pickedView.val !== null) go({ view: current.saved.startView });
}

// The view screen's three drawings: a strip, three columns, stacked rows —
// divs, not images, and hidden from a screen reader (the button names it).
const sketchShell =
  'display:flex; gap:3px; height:1.75rem; padding:4px; border:1px solid var(--border); border-radius:4px;';
const sketchPiece = (style: string): HTMLElement =>
  div({ style: `background:var(--muted-foreground); opacity:.35; border-radius:2px; ${style}` });

function sketchOf(kind: 'tabs' | 'kanban' | 'list'): HTMLElement {
  const align =
    kind === 'tabs'
      ? ' align-items:flex-start;'
      : kind === 'list'
        ? ' flex-direction:column; justify-content:center;'
        : '';
  const piece = kind === 'tabs' ? 'flex:1; height:4px;' : kind === 'kanban' ? 'flex:1;' : 'height:3px; width:100%;';
  return div(
    { style: `${sketchShell}${align}` },
    // Four tabs in the strip, three columns in the kanban, three rows in the list.
    ...Array.from({ length: kind === 'tabs' ? 4 : 3 }, () => sketchPiece(piece)),
  );
}

const VIEW_NAMES: Record<'tabs' | 'kanban' | 'list', string> = { tabs: 'Tabs', kanban: 'Kanban', list: 'List' };

function ViewChoices(): HTMLElement {
  return div(
    { style: 'display:flex; gap:.5rem;' },
    ...(['tabs', 'kanban', 'list'] as const).map((choice) =>
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          style: 'flex:1; display:flex; flex-direction:column; gap:.5rem; align-items:stretch;',
          'aria-pressed': () => ((pickedView.val ?? chosenView()) === choice ? 'true' : 'false'),
          onclick: () => pickView(choice),
        },
        sketchOf(choice),
        VIEW_NAMES[choice],
      ),
    ),
  );
}

// The theme, font and sound screens: a wrapping row of choices.
const rowStyle = 'display:flex; flex-wrap:wrap; gap:.375rem;';

function ThemeChoices(): HTMLElement {
  return div(
    { style: rowStyle },
    ...Object.entries(THEMES).map(([id, t]) =>
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          'data-size': 'sm',
          onclick: () => saveSetting('theme', id),
        },
        t.name,
      ),
    ),
  );
}

function FontChoices(): HTMLElement {
  return div(
    { style: rowStyle },
    ...Object.entries(FONTS).map(([id, f]) =>
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          'data-size': 'sm',
          // Each choice drawn in its own face.
          style: `font-family:${fontStack(f)}`,
          onclick: () => saveSetting('font', id),
        },
        f.name,
      ),
    ),
  );
}

function SoundChoices(): HTMLElement {
  return div(
    { style: rowStyle },
    ...Object.entries(TYPING_SOUNDS).map(([id, name]) =>
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          'data-size': 'sm',
          onclick: () => {
            saveSetting('typingSound', id);
            previewSound(id);
          },
        },
        name,
      ),
    ),
  );
}

// The choice controls a screen carries, if any. A child binding must hand
// van a node every time (a first null is pruned and never revisited), so the
// screens without choices hold an empty, hidden row instead.
function choiceRow(): HTMLElement {
  switch (on().id) {
    case 'view':
      return ViewChoices();
    case 'theme':
      return ThemeChoices();
    case 'font':
      return FontChoices();
    case 'sound':
      return SoundChoices();
    default:
      return div({ style: 'display:none' });
  }
}

export function Welcome(): HTMLDialogElement {
  return dialog(
    {
      id: 'welcome',
      'aria-label': 'Welcome',
      // A person expects Escape to dismiss a dialog; this one stays up.
      oncancel: (e: Event) => e.preventDefault(),
    },
    div(
      { class: 'welcome-page' },
      div(
        { class: 'welcome-body' },
        h2({ class: 'welcome-title' }, () => on().title),
        p({ class: 'welcome-text' }, () => on().body),
        () => choiceRow(),
      ),
      footer(
        { class: 'welcome-foot' },
        // One dot per screen, the current one marked; a decorative indicator
        // (the title and body announce where in the tour someone is), rebuilt
        // per step as the mark comes and goes.
        () =>
          div(
            { class: 'welcome-dots', 'aria-hidden': 'true' },
            ...WELCOME_SCREENS.map((_, i) =>
              span({ class: 'welcome-dot', ...(step.val === i ? { 'aria-current': 'step' } : {}) }),
            ),
          ),
        div(
          { class: 'welcome-actions' },
          button(
            {
              type: 'button',
              class: 'btn',
              'data-variant': 'ghost',
              hidden: () => step.val === 0 || !on().skip,
              onclick: () => (step.val = clampStep(step.val - 1)),
            },
            'Back',
          ),
          button(
            {
              type: 'button',
              class: 'btn',
              'data-variant': 'ghost',
              hidden: () => !on().skip,
              onclick: () => {
                saveSetting('welcomeSeen', dismissWelcome().welcomeSeen);
                closeWelcome();
              },
            },
            'Skip',
          ),
          button(
            {
              type: 'button',
              class: 'btn',
              // showModal() would put the first focus on Skip (Back is hidden
              // at step 0), and an accidental Enter there ends the tour for
              // good: focus lands on the safe button instead.
              autofocus: true,
              // The last screen's Continue sets things up with its own task;
              // until then clampStep keeps the tour on it.
              onclick: () => (step.val = clampStep(step.val + 1)),
            },
            'Continue',
          ),
        ),
      ),
    ),
  );
}

// Opens the tour on its first screen; held off while the gate is up — the
// connection comes first.
export function showWelcome(): void {
  if (gateMode.val !== null) return;
  step.val = 0;
  pickedView.val = null;
  el().showModal();
}

// Called once the daemon has answered and the settings are in: the tour is
// for someone tabsh hasn't met yet.
export function initWelcome(): void {
  if (!current.saved.welcomeSeen) showWelcome();
}
