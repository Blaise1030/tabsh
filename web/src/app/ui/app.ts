// The page: the dialogs, the tab bar, the workspace under it and the drop
// glow. Features find their parts by id once this is mounted.
import van from 'vanjs-core';
import { Board, shown } from '../board/view.ts';
import { open as explorerOpen } from '../explorer/explorer.ts';
import { Sidebar } from '../explorer/sidebar.ts';
import { paneShown } from '../files/open.ts';
import { grouping, TabStrip } from '../sessions/groups.ts';
import { noTab } from '../sessions/store.ts';
import { Gate } from './gate.ts';
import { type Icon, icons } from './icons.ts';

const { aside, button, datalist, dialog, div, footer, form, h2, header, input, label, p, section, span } = van.tags;
const { table, tbody, textarea } = van.tags;

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

function About(): HTMLElement {
  return dialog(
    { id: 'about', class: 'dialog', 'aria-labelledby': 'about-title', 'aria-describedby': 'about-desc' },
    div(
      header(
        h2({ id: 'about-title' }, 'tabsh'),
        p({ id: 'about-desc' }, 'Terminals in your browser, served by a small Rust daemon.'),
      ),
      section(table({ class: 'table about-table' }, tbody({ id: 'about-list' }))),
      footer(button({ type: 'button', class: 'btn' }, 'Close')),
    ),
  );
}

const field = (text: string, hint: string | null, control: HTMLElement) =>
  label({ class: 'label' }, span(hint ? [`${text} `, span({ class: 'mark' }, hint)] : text), control);

function NewCard(): HTMLElement {
  return dialog(
    { id: 'new-card', class: 'dialog', 'aria-labelledby': 'new-card-title' },
    form(
      { method: 'dialog', id: 'new-card-form' },
      header(h2({ id: 'new-card-title' }, 'New card')),
      section(
        { class: 'new-card-fields' },
        field('Title', '(optional)', input({ class: 'input', name: 'name', maxlength: '100', autocomplete: 'off' })),
        field(
          'Folder',
          null,
          input({
            class: 'input',
            name: 'cwd',
            list: 'new-card-folders',
            placeholder: '~/code/app',
            autocomplete: 'off',
            spellcheck: false,
          }),
        ),
        datalist({ id: 'new-card-folders' }),
        field('First prompt', null, textarea({ class: 'textarea', name: 'prompt', rows: 3, required: true })),
        field(
          'Agent',
          '({prompt} is replaced by the prompt)',
          input({ class: 'input', name: 'command', list: 'new-card-commands', autocomplete: 'off', spellcheck: false }),
        ),
        datalist({ id: 'new-card-commands' }),
        p({ class: 'new-card-error', hidden: true }),
      ),
      footer(
        button({ type: 'button', class: 'btn', 'data-variant': 'outline', value: 'cancel' }, 'Cancel'),
        button({ type: 'submit', class: 'btn' }, 'Create'),
      ),
    ),
  );
}

// A ghost icon button in the tab bar.
const barButton = (icon: Icon, props: Record<string, string | (() => string)>) =>
  button({ type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', ...props }, icon());

// The tab bar spans the page: a tab owns the sidebar, terminal and file pane under it.
function TabBar(): HTMLElement {
  return div(
    { class: 'tabbar' },
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

function Workspace(): HTMLElement {
  return div(
    { id: 'workspace' },
    ...Sidebar(),
    div(
      { id: 'main' },
      Board(),
      div(
        { id: 'terms', hidden: () => shown.val },
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
  return [Palette(), About(), NewCard(), TabBar(), Workspace(), div({ id: 'drop-glow', 'aria-hidden': 'true' })];
}
