// New card: a folder (searched as it's typed, recent ones offered first; see
// folder-picker.ts), the first prompt, the agent
// command to start on it (recent ones offered) and optional tags, picked as
// chips (tags in use offered; the group it opens in gives its tag, which can
// be taken off). The board stays open. Made from Backlog's +, the card waits there and its agent
// starts when it's dragged to In progress; from any other column's +, it goes
// to In progress and its agent starts at once (a running agent's hooks would
// put it there anyway). The card is titled by its prompt until its terminal
// gives it a title.
import { ApiError } from '../daemon/client.ts';
import { newTabGroup } from '../sessions/groups.ts';
import { addTag } from '../sessions/labels.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { setTags, tagBadge, usedTags } from '../sessions/tags.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { setNewCard } from './view.ts';

const dialog = () => document.getElementById('new-card') as HTMLDialogElement;
const tagInput = () => document.getElementById('new-card-tag') as HTMLInputElement;
let column: Status = 'backlog';
let picked: string[] = []; // the card's tags, shown as chips

// The chips, each with a button taking it off, and the tags in use not yet
// picked as suggestions.
function drawTags(): void {
  const chips = picked.map((tag) => {
    const off = el('button', { type: 'button', className: 'tag-off', textContent: '×', ariaLabel: `Remove ${tag}` });
    off.onclick = () => {
      picked = picked.filter((t) => t !== tag);
      drawTags();
      tagInput().focus();
    };
    return tagBadge(tag, off);
  });
  (document.getElementById('new-card-chips') as HTMLElement).replaceChildren(...chips);
  (document.getElementById('new-card-tags') as HTMLDataListElement).replaceChildren(
    ...usedTags()
      .filter((t) => !picked.includes(t))
      .map((t) => el('option', { value: t })),
  );
}

// What's typed in the tag box becomes chips.
function commitTag(): void {
  const input = tagInput();
  picked = addTag(picked, input.value);
  input.value = '';
  drawTags();
}
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
  picked = tag ? [tag] : [];
  drawTags();
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
  const input = tagInput();
  // A click in the box, beside the chips, goes to its text.
  (input.parentElement as HTMLElement).onclick = (e) => e.target === e.currentTarget && input.focus();
  // Enter or a comma makes a chip (Enter on an empty box creates the card);
  // Backspace on an empty box takes the last one off.
  input.onkeydown = (e) => {
    if (e.isComposing) return;
    if ((e.key === 'Enter' && input.value.trim()) || e.key === ',') {
      e.preventDefault();
      commitTag();
    } else if (e.key === 'Backspace' && !input.value && picked.length) {
      picked = picked.slice(0, -1);
      drawTags();
    }
  };
  // A suggestion picked from the list, or a pasted list, is taken at once.
  input.oninput = (e) => {
    const type = (e as InputEvent).inputType;
    if (!type || type === 'insertReplacementText' || input.value.includes(',')) commitTag();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const cwd = folder.value();
    const prompt = String(data.get('prompt') ?? '').trim();
    const command = String(data.get('command') ?? '').trim() || DEFAULT_COMMAND;
    commitTag(); // a tag typed but not yet made a chip still counts
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
