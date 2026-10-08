// New card: a folder (searched as it's typed, recent ones offered first; see
// folder-picker.ts), the first prompt, the agent command to start on it
// (recent ones offered) and optional tags, picked as chips (tag-picker.ts;
// the group it opens in gives its tag, which can be taken off). The board
// stays open and the card goes on top of its column. Made from Backlog's +,
// it waits there and its agent starts when it's dragged to In progress; from
// In progress's +, its agent starts at once. The card is titled by its prompt
// until its terminal gives it a title.
import van, { type State } from 'vanjs-core';
import { ApiError } from '../daemon/client.ts';
import { newTabGroup } from '../sessions/groups.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { setTags } from '../sessions/tags.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { keyed } from '../ui/keyed.ts';
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { initTagPicker, type TagPicker } from './tag-picker.ts';
import { moveToTop, setNewCard } from './view.ts';

const {
  button,
  datalist,
  dialog,
  div,
  footer,
  form,
  h2,
  header,
  input,
  label,
  option,
  p,
  section,
  span,
  textarea,
  ul,
} = van.tags;

let column: Status = 'backlog';
let host: HTMLDialogElement;
let formEl: HTMLFormElement;
let folder: FolderPicker;
let tags: TagPicker;

// Offered commands, and what the last try said (null: nothing).
const commands: State<string[]> = van.state([]);
const error: State<string | null> = van.state(null);

// The home folder as seen in other cards' paths, until the folder search
// hears the daemon's.
const cardsHome = () =>
  store.sessions.map((s) => s.card.val.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean) ?? null;

export function openNewCard(status: Status): void {
  column = status;
  formEl.reset();
  error.val = null;
  const recent = recentFolders(store.sessions.map((s) => ({ card: s.card.val })));
  folder.reset(recent, cardsHome());
  (formEl.elements.namedItem('cwd') as HTMLInputElement).value = recent[0] ?? '';
  const saved = current.saved.agentCommands;
  commands.val = saved;
  (formEl.elements.namedItem('command') as HTMLInputElement).value = saved[0] ?? DEFAULT_COMMAND;
  const { tag } = newTabGroup();
  tags.reset(tag ? [tag] : []);
  host.showModal();
}

const field = (text: string, hint: string | null, control: HTMLElement) =>
  label({ class: 'label' }, span(hint ? [`${text} `, span({ class: 'mark' }, hint)] : text), control);

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  const data = new FormData(formEl);
  const cwd = folder.value();
  const prompt = String(data.get('prompt') ?? '').trim();
  const command = String(data.get('command') ?? '').trim() || DEFAULT_COMMAND;
  const picked = tags.tags(); // a tag typed but not yet made a chip still counts
  let s: Session;
  try {
    s = await openTab({ ...(cwd && { cwd }), prompt, command }, false);
  } catch (err) {
    // The daemon answers 400 for a folder that isn't there.
    const badFolder = err instanceof ApiError && err.status === 400 && cwd;
    error.val = badFolder ? `No folder at ${cwd}` : "Couldn't create the card";
    return;
  }
  // Exactly the chips: the group's tag, given on opening, goes if taken off.
  setTags(s, picked);
  host.close();
  // The next card offers it first.
  saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
  await moveToTop(s, column === 'backlog' ? 'backlog' : 'in_progress'); // sets its status too
}

// The New card dialog lives as long as the page.
export function NewCard(): HTMLDialogElement {
  const cwd = input({ class: 'input', name: 'cwd', placeholder: '~/code/app', autocomplete: 'off', spellcheck: false });
  const folderList = ul({
    id: 'new-card-folders',
    class: 'picker-options',
    role: 'listbox',
    'aria-label': 'Folders',
    hidden: true,
  });
  const tag = input({
    id: 'new-card-tag',
    placeholder: 'Add or pick tags…',
    maxlength: '200',
    autocomplete: 'off',
    spellcheck: false,
  });
  const chips = span({ id: 'new-card-chips' });
  const tagList = ul({
    id: 'new-card-tag-options',
    class: 'picker-options tag-options',
    role: 'listbox',
    'aria-label': 'Tags',
    'aria-multiselectable': 'true',
    hidden: true,
  });
  const commandList = datalist({ id: 'new-card-commands' });
  formEl = form(
    { method: 'dialog', id: 'new-card-form', onsubmit: submit },
    header(h2({ id: 'new-card-title' }, 'New card')),
    section(
      { class: 'new-card-fields' },
      field('Folder', null, span({ class: 'picker' }, cwd, folderList)),
      field('First prompt', null, textarea({ class: 'textarea', name: 'prompt', rows: 3, required: true })),
      field(
        'Agent',
        '({prompt} is replaced by the prompt)',
        input({ class: 'input', name: 'command', list: 'new-card-commands', autocomplete: 'off', spellcheck: false }),
      ),
      commandList,
      div(
        { class: 'label' },
        label({ for: 'new-card-tag' }, 'Tags ', span({ class: 'mark' }, '(optional)')),
        div({ class: 'picker' }, div({ class: 'input tag-field' }, chips, tag), tagList),
      ),
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
  keyed(
    commandList,
    () => [...new Set(commands.val)],
    (v) => v,
    (v) => option({ value: v }),
  );
  folder = initFolderPicker(cwd, folderList);
  tags = initTagPicker(tag, chips, tagList);
  setNewCard(openNewCard);
  return host;
}
