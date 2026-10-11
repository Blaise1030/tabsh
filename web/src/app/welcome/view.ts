// The welcome tour's dialog: one full-page screen per WELCOME_SCREENS entry,
// opened on first load (initWelcome), walked with Continue, left with Skip.
// The choice controls on the view, theme, font, sound and agents screens come
// with their own tasks; until then those screens show their text.
import van from 'vanjs-core';
import { gateMode } from '../daemon/client.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { clampStep, dismissWelcome, WELCOME_SCREENS } from './steps.ts';

const { button, dialog, div, footer, h2, p, span } = van.tags;

// Which screen is on show; showWelcome resets it.
const step = van.state(0);

const on = () => WELCOME_SCREENS[step.val];
const el = () => document.getElementById('welcome') as HTMLDialogElement;

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
                el().close();
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
  el().showModal();
}

// Called once the daemon has answered and the settings are in: the tour is
// for someone tabsh hasn't met yet.
export function initWelcome(): void {
  if (!current.saved.welcomeSeen) showWelcome();
}
