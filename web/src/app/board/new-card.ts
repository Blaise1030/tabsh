// New card: a folder (searched as it's typed, recent ones offered first; see
// folder-picker.ts), the first prompt, the agent
// command to start on it (recent ones offered) and optional tags, picked as
// chips (tag-picker.ts; the group it opens in gives its tag, which can be
// taken off). The board stays open. Made from Backlog's +, the card waits there and its agent
// starts when it's dragged to In progress; from any other column's +, it goes
// to In progress and its agent starts at once (a running agent's hooks would
// put it there anyway). The card is titled by its prompt until its terminal
// gives it a title.
import { ApiError } from '../daemon/client.ts';
import { newTabGroup } from '../sessions/groups.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { setTags } from '../sessions/tags.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { initTagPicker, type TagPicker } from './tag-picker.ts';
import { setNewCard } from './view.ts';

const dialog = () => document.getElementById('new-card') as HTMLDialogElement;
let column: Status = 'backlog';
let tags: TagPicker;
let folder: FolderPicker;

// The home folder as seen in other cards' paths, until the folder search
// hears the daemon's.
const cardsHome = () =>
  store.sessions.map((s) => s.card.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean) ?? null;

export function openNewCard(status: Status): void {
  column = status;
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  form.reset();
  (form.querySelector('.new-card-error') as HTMLElement).hidden = true;
  const folders = recentFolders(store.sessions);
  folder.reset(folders, cardsHome());
  (form.elements.namedItem('cwd') as HTMLInputElement).value = folders[0] ?? '';
  const commands = current.saved.agentCommands;
  (document.getElementById('new-card-commands') as HTMLDataListElement).replaceChildren(
    ...commands.map((c) => el('option', { value: c })),
  );
  (form.elements.namedItem('command') as HTMLInputElement).value = commands[0] ?? DEFAULT_COMMAND;
  const { tag } = newTabGroup();
  tags.reset(tag ? [tag] : []);
  dialog().showModal();
}

export function initNewCard(): void {
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  const error = form.querySelector('.new-card-error') as HTMLElement;
  folder = initFolderPicker(
    form.elements.namedItem('cwd') as HTMLInputElement,
    document.getElementById('new-card-folders') as HTMLUListElement,
  );
  (form.querySelector('[value="cancel"]') as HTMLButtonElement).onclick = () => dialog().close();
  tags = initTagPicker(
    document.getElementById('new-card-tag') as HTMLInputElement,
    document.getElementById('new-card-chips') as HTMLElement,
    document.getElementById('new-card-tag-options') as HTMLUListElement,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
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
      error.textContent = badFolder ? `No folder at ${cwd}` : "Couldn't create the card";
      error.hidden = false;
      return;
    }
    // Exactly the chips: the group's tag, given on opening, goes if taken off.
    setTags(s, picked);
    dialog().close();
    // The next card offers it first.
    saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
    if (column !== 'backlog') await setStatus(s, 'in_progress').catch(() => {});
  });
  setNewCard(openNewCard);
}
