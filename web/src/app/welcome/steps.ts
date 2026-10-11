// The welcome tour: the screens it shows, and the settings its choices write.
// Pure data and decisions — the dialog lives in `view.ts`.
import type { BoardLayout, StartView } from '../settings/schema.ts';

// The tour's screens, in order. `skip` says whether the screen offers Skip
// (the tour can be left early); `setup` marks the agents screen, the last
// one, which sets up a provider and finishes the tour.
export interface WelcomeScreen {
  id: 'intro' | 'view' | 'theme' | 'font' | 'sound' | 'agents';
  title: string;
  body: string;
  skip: boolean;
  setup: boolean;
}

export const WELCOME_SCREENS: readonly WelcomeScreen[] = [
  {
    id: 'intro',
    title: 'Shells that outlive this tab.',
    body: 'Close the tab, reload, or shut the laptop. Your shells keep running, and tabsh reattaches when you come back.',
    skip: true,
    setup: false,
  },
  {
    id: 'view',
    title: 'How you look at the work.',
    body: 'Tabs for the terminals, a kanban for the cards, or the same cards as a list.',
    skip: true,
    setup: false,
  },
  { id: 'theme', title: 'Theme.', body: 'The colours of the terminal and the page.', skip: true, setup: false },
  { id: 'font', title: 'Font.', body: 'The face the terminal draws in.', skip: true, setup: false },
  { id: 'sound', title: 'Typing sound.', body: 'Played as you type. Pick one to hear it.', skip: true, setup: false },
  {
    id: 'agents',
    title: 'Connect your agents.',
    body: 'Cards move on their own when your coding agent reports what it is doing. Pick one and let it wire up its own hooks.',
    skip: false,
    setup: true,
  },
];

// The step to show, kept on the screens.
export function clampStep(index: number): number {
  return Math.min(Math.max(index, 0), WELCOME_SCREENS.length - 1);
}

// The settings the view screen's choice writes: tabs keep the tour's terms
// view and the layout as it is; kanban and list open on the board with
// their layout.
export function viewSettings(
  choice: 'tabs' | 'kanban' | 'list',
  boardLayout: BoardLayout,
): { startView: 'terms' | 'board'; boardLayout: BoardLayout } {
  if (choice === 'tabs') return { startView: 'terms', boardLayout };
  if (choice === 'kanban') return { startView: 'board', boardLayout: 'columns' };
  return { startView: 'board', boardLayout: 'list' };
}

// The view screen's choice, as the saved settings name the chosen one: tabs
// are the tour's terms view, kanban and list are the board in their layout —
// the inverse of viewSettings.
export function viewChoice(startView: StartView, boardLayout: BoardLayout): 'tabs' | 'kanban' | 'list' {
  if (startView === 'terms') return 'tabs';
  return boardLayout === 'list' ? 'list' : 'kanban';
}

// The settings written when the agents screen sets up a provider: the tour
// and the board's setup screen are both dealt with.
export function agentSetupPatch(providerName: string): {
  welcomeSeen: true;
  boardOnboarded: true;
  agentProvider: string;
} {
  return { welcomeSeen: true, boardOnboarded: true, agentProvider: providerName };
}

// The settings written when the tour is left early.
export function dismissWelcome(): { welcomeSeen: true } {
  return { welcomeSeen: true };
}

// Whether closing the dialog ends the tour on its own: only after the setup
// screen was opened (the tour was finished); before it, closing is leaving.
export function closesAfterSetup(opened: boolean): boolean {
  return opened;
}
