import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentSetupPatch,
  clampStep,
  closesAfterSetup,
  dismissWelcome,
  viewSettings,
  WELCOME_SCREENS,
} from './steps.ts';

test('the welcome screens match the tour copy', () => {
  assert.deepEqual(WELCOME_SCREENS, [
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
  ]);
});

test('clampStep keeps the step on the screens', () => {
  assert.equal(clampStep(-1), 0);
  assert.equal(clampStep(0), 0);
  assert.equal(clampStep(5), 5);
  assert.equal(clampStep(6), 5);
});

test('the view choice writes startView and the board layout', () => {
  assert.deepEqual(viewSettings('tabs', 'list'), { startView: 'terms', boardLayout: 'list' });
  assert.deepEqual(viewSettings('tabs', 'columns'), { startView: 'terms', boardLayout: 'columns' });
  assert.deepEqual(viewSettings('kanban', 'list'), { startView: 'board', boardLayout: 'columns' });
  assert.deepEqual(viewSettings('kanban', 'columns'), { startView: 'board', boardLayout: 'columns' });
  assert.deepEqual(viewSettings('list', 'list'), { startView: 'board', boardLayout: 'list' });
  assert.deepEqual(viewSettings('list', 'columns'), { startView: 'board', boardLayout: 'list' });
});

test('finishing on the agents screen marks the tour seen and sets the provider', () => {
  assert.deepEqual(agentSetupPatch('Codex'), { welcomeSeen: true, boardOnboarded: true, agentProvider: 'Codex' });
});

test('leaving the tour early only marks it seen', () => {
  assert.deepEqual(dismissWelcome(), { welcomeSeen: true });
});

test('the tour closes by itself after the setup screen was opened', () => {
  assert.equal(closesAfterSetup(false), false);
  assert.equal(closesAfterSetup(true), true);
});
