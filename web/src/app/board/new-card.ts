// New card: an optional title, a folder (recent ones offered), the first
// prompt and the agent command to start on it (recent ones offered). The
// card waits in Backlog, and the board stays open: its agent starts when
// it's dragged to In progress (or made from that column's +). With no title
// the card takes its terminal's title.
import van, { type State } from 'vanjs-core';
import { ApiError } from '../daemon/client.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { keyed } from '../ui/keyed.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { setNewCard } from './view.ts';

const { button, datalist, dialog, footer, form, h2, header, input, label, option, p, section, span, textarea } =
  van.tags;

let column: Status = 'backlog';
let host: HTMLDialogElement;
let formEl: HTMLFormElement;

// Offered folders and commands, and what the last try said (null: nothing).
const folders: State<string[]> = van.state([]);
const commands: State<string[]> = van.state([]);
const error: State<string | null> = van.state(null);

// `~/x` is the home directory's x: the daemon only takes absolute paths, so
// it's expanded with the home folder seen in other cards' paths.
function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = store.sessions.map((s) => s.card.val.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean);
  return home ? home + p.slice(1) : p;
}

export function openNewCard(status: Status): void {
  column = status;
  formEl.reset();
  error.val = null;
  const recent = recentFolders(store.sessions.map((s) => ({ card: s.card.val })));
  folders.val = recent;
  (formEl.elements.namedItem('cwd') as HTMLInputElement).value = recent[0] ?? '';
  const saved = current.saved.agentCommands;
  commands.val = saved;
  (formEl.elements.namedItem('command') as HTMLInputElement).value = saved[0] ?? DEFAULT_COMMAND;
  host.showModal();
}

const field = (text: string, hint: string | null, control: HTMLElement) =>
  label({ class: 'label' }, span(hint ? [`${text} `, span({ class: 'mark' }, hint)] : text), control);

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  const data = new FormData(formEl);
  const name = String(data.get('name') ?? '').trim();
  const cwd = expandHome(String(data.get('cwd') ?? '').trim());
  const prompt = String(data.get('prompt') ?? '').trim();
  const command = String(data.get('command') ?? '').trim() || DEFAULT_COMMAND;
  let s: Session;
  try {
    s = await openTab({ ...(name && { name }), ...(cwd && { cwd }), prompt, command }, false);
  } catch (err) {
    // The daemon answers 400 for a folder that isn't there.
    const badFolder = err instanceof ApiError && err.status === 400 && cwd;
    error.val = badFolder ? `No folder at ${cwd}` : "Couldn't create the card";
    return;
  }
  host.close();
  // The next card offers it first.
  saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
  if (column !== 'backlog') await setStatus(s, column).catch(() => {});
}

// The New card dialog lives as long as the page.
export function NewCard(): HTMLDialogElement {
  const folderList = datalist({ id: 'new-card-folders' });
  const commandList = datalist({ id: 'new-card-commands' });
  formEl = form(
    { method: 'dialog', id: 'new-card-form', onsubmit: submit },
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
      folderList,
      field('First prompt', null, textarea({ class: 'textarea', name: 'prompt', rows: 3, required: true })),
      field(
        'Agent',
        '({prompt} is replaced by the prompt)',
        input({ class: 'input', name: 'command', list: 'new-card-commands', autocomplete: 'off', spellcheck: false }),
      ),
      commandList,
      p({ class: 'new-card-error', hidden: () => error.val === null }, () => error.val ?? ''),
    ),
    footer(
      button(
        { type: 'button', class: 'btn', 'data-variant': 'outline', value: 'cancel', onclick: () => host.close() },
        'Cancel',
      ),
      button({ type: 'submit', class: 'btn' }, 'Create'),
    ),
  );
  host = dialog({ id: 'new-card', class: 'dialog', 'aria-labelledby': 'new-card-title' }, formEl);
  const offer = (list: HTMLElement, items: State<string[]>) =>
    keyed(
      list,
      () => [...new Set(items.val)],
      (v) => v,
      (v) => option({ value: v }),
    );
  offer(folderList, folders);
  offer(commandList, commands);
  setNewCard(openNewCard);
  return host;
}
