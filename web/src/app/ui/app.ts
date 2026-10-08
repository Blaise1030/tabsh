// The page: the dialogs, the tab bar, the board or the workspace under it,
// and the drop glow. Features find their parts by id once this is mounted.
import van from 'vanjs-core';
import { NewCard } from '../board/new-card.ts';
import { Board, shown } from '../board/view.ts';
import { open as explorerOpen } from '../explorer/explorer.ts';
import { Sidebar } from '../explorer/sidebar.ts';
import { paneShown } from '../files/open.ts';
import { grouping, TabStrip } from '../sessions/groups.ts';
import { noTab } from '../sessions/store.ts';
import { About } from './about.ts';
import { Gate } from './gate.ts';
import { type Icon, icons } from './icons.ts';

const { aside, button, dialog, div, header, input, p } = van.tags;

function Palette(): HTMLElement {
  const search = input({
    type: 'text',
    id: 'palette-input',
    autocomplete: 'off',
    spellcheck: false,
    'aria-autocomplete': 'list',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-menu',
  });
  // Not a property everywhere, and where it is, a boolean.
  search.setAttribute('autocorrect', 'off');
  return dialog(
    { id: 'palette', class: 'command-dialog', 'aria-label': 'Command menu' },
    div(
      { class: 'command', id: 'palette-command' },
      header(icons.search(), search),
      div({ role: 'menu', id: 'palette-menu', 'aria-orientation': 'vertical', 'data-empty': 'No results found.' }),
    ),
  );
}

// A ghost icon button in the tab bar.
const barButton = (icon: Icon, props: Record<string, string | (() => string)>) =>
  button({ type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', ...props }, icon());

// The tab bar spans the page: a tab owns the sidebar, terminal and file pane
// under it. On the board it keeps only the Board and Settings buttons.
function TabBar(): HTMLElement {
  return div(
    { class: () => (shown.val ? 'tabbar on-board' : 'tabbar') },
    barButton(icons.board, {
      'aria-label': 'Board',
      title: 'Board',
      id: 'board-btn',
      'aria-pressed': () => String(shown.val),
    }),
    barButton(icons.explorer, {
      'aria-label': 'Toggle file explorer',
      title: 'Toggle file explorer',
      id: 'explorer-btn',
      'aria-pressed': () => String(explorerOpen.val),
    }),
    TabStrip(),
    barButton(icons.plus, { 'aria-label': 'New terminal', title: 'New terminal', 'data-new-session': '' }),
    barButton(icons.group, {
      'aria-label': 'Group tabs by repo or tag',
      title: 'Group tabs',
      id: 'tab-group-btn',
      // Grouping is on: the button stays lit.
      'aria-pressed': () => String(grouping.val !== 'none'),
    }),
    barButton(icons.settings, { class: 'btn settings-btn', 'aria-label': 'Settings', id: 'settings-btn' }),
  );
}

// The terminal layout: file sidebar, terminals and file pane. The board
// takes its place while shown.
function Workspace(): HTMLElement {
  return div(
    { id: 'workspace', hidden: () => shown.val },
    ...Sidebar(),
    div(
      { id: 'main' },
      div(
        { id: 'terms' },
        div(
          { class: 'empty', id: 'empty', hidden: () => !noTab.val },
          p('No terminals open.'),
          button({ type: 'button', class: 'btn', 'data-new-session': '' }, 'New terminal'),
        ),
        Gate(),
      ),
    ),
    div({ id: 'pane-divider', hidden: () => !paneShown.val }),
    aside({ id: 'pane', hidden: () => !paneShown.val, tabindex: '-1', 'aria-label': 'File' }),
  );
}

export function App(): HTMLElement[] {
  return [
    Palette(),
    About(),
    NewCard(),
    TabBar(),
    Board(),
    Workspace(),
    div({ id: 'drop-glow', 'aria-hidden': 'true' }),
  ];
}
