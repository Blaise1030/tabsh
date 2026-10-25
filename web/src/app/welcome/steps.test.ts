import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentSetupPatch,
  clampStep,
  closesAfterSetup,
  dismissWelcome,
  typingBeats,
  viewChoice,
  viewSettings,
  WELCOME_SCREENS,
  welcomeFromQuery,
} from './steps.ts';

test('the welcome screens match the tour copy', () => {
  assert.deepEqual(WELCOME_SCREENS, [
    {
      id: 'intro',
      title: 'Welcome to Tabsh.',
      body: 'Close the tab, reload, or shut the laptop. Your shells keep running, and tabsh reattaches when you come back.',
      skip: true,
      setup: false,
    },
    {
      id: 'view',
      title: 'Choose your workspace.',
      body: 'A kanban for the cards, or the same cards as a list.',
      skip: true,
      setup: false,
    },
    { id: 'theme', title: 'Theme.', body: 'The colours of the terminal and the page.', skip: true, setup: false },
    { id: 'font', title: 'Font.', body: 'The face the terminal draws in.', skip: true, setup: false },
    {
      id: 'sound',
      title: 'Typing sound.',
      body: 'Put on your headphone and never bother your girlfriend/boyfriend again.',
      skip: true,
      setup: false,
    },
    {
      id: 'agents',
      title: 'Connect your agents.',
      body: 'Cards move on their own when your coding agent reports what it is doing. Pick one and let it wire up its own hooks.',
      skip: false,
      setup: true,
    },
  ]);
});

test('clampStep keeps the step on the screens', () => {
  assert.equal(clampStep(-1), 0);
  assert.equal(clampStep(0), 0);
  assert.equal(clampStep(5), 5);
  assert.equal(clampStep(6), 5);
});

test('the view choice writes only the board layout', () => {
  assert.deepEqual(viewSettings('kanban'), { boardLayout: 'columns' });
  assert.deepEqual(viewSettings('list'), { boardLayout: 'list' });
});

test('viewChoice names the chosen button from the saved layout, inverting viewSettings', () => {
  assert.equal(viewChoice('columns'), 'kanban');
  assert.equal(viewChoice('list'), 'list');
});

test('finishing on the agents screen marks the tour seen and sets the provider', () => {
  assert.deepEqual(agentSetupPatch('Codex'), { welcomeSeen: true, boardOnboarded: true, agentProvider: 'Codex' });
});

test('leaving the tour early only marks it seen', () => {
  assert.deepEqual(dismissWelcome(), { welcomeSeen: true });
});

test('welcome=1 in the query opens the tour', () => {
  assert.equal(welcomeFromQuery(new URLSearchParams('welcome=1')), true);
  assert.equal(welcomeFromQuery(new URLSearchParams('welcome=1&view=board')), true);
  assert.equal(welcomeFromQuery(new URLSearchParams('')), false);
  assert.equal(welcomeFromQuery(new URLSearchParams('welcome=0')), false);
  assert.equal(welcomeFromQuery(new URLSearchParams('view=board')), false);
});

test('the tour closes by itself after the setup screen was opened', () => {
  assert.equal(closesAfterSetup(false), false);
  assert.equal(closesAfterSetup(true), true);
});

test('the sound preview types the command, then the run prints', () => {
  const beats = typingBeats('cargo test', 5);
  assert.deepEqual(
    beats.flatMap((beat) => (beat.key ? [beat.key] : [])),
    ['c', 'a', 'r', 'g', 'o', ' ', 't', 'e', 's', 't', 'Enter'],
  );
  assert.equal(beats[9].chars, 10);
  assert.equal(beats.at(-1)?.lines, 5);
  assert.equal(beats.at(-1)?.key, null);
});
