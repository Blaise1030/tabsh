// New card: a folder (searched as it's typed, recent ones offered first; see
// folder-picker.ts), the first prompt, the agent provider to start on it
// (set up in the palette; the last one used first) and optional tags, picked as chips (tag-picker.ts;
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
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { recentFolders, type Status } from './model.ts';
import { initTagPicker, type TagPicker } from './tag-picker.ts';
import { moveToTop, setNewCard } from './view.ts';

const { button, dialog, div, footer, form, h2, header, input, label, option, p, section, select, span, textarea, ul } =
  van.tags;

let column: Status = 'backlog';
let host: HTMLDialogElement;
let formEl: HTMLFormElement;
let folder: FolderPicker;
let tags: TagPicker;

let providerList: HTMLSelectElement;
// What the last try said (null: nothing).
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
  // Filled here, not from a state, so the last one used can be picked now.
  const names = current.saved.providers.map((p) => p.name);
  providerList.replaceChildren(...names.map((n) => option({ value: n }, n)));
  const last = current.saved.agentProvider;
  providerList.value = names.includes(last) ? last : names[0];
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
  const saved = current.saved.providers;
  const provider = saved.find((p) => p.name === data.get('provider')) ?? saved[0];
  const { command, resume } = provider;
  const picked = tags.tags(); // a tag typed but not yet made a chip still counts
  let s: Session;
  try {
    s = await openTab({ ...(cwd && { cwd }), prompt, command, resume }, false);
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
  saveSetting('agentProvider', provider.name);
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
  providerList = select({ class: 'select', name: 'provider' });
  formEl = form(
    { method: 'dialog', id: 'new-card-form', onsubmit: submit },
    header(h2({ id: 'new-card-title' }, 'New card')),
    section(
      { class: 'new-card-fields' },
      field('Folder', null, span({ class: 'picker' }, cwd, folderList)),
      field('First prompt', null, textarea({ class: 'textarea', name: 'prompt', rows: 3, required: true })),
      field('Agent', '(providers are set up in the command palette)', providerList),
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
  folder = initFolderPicker(cwd, folderList);
  tags = initTagPicker(tag, chips, tagList);
  setNewCard(openNewCard);
  return host;
}
