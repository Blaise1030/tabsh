// New card: an optional title, a folder (recent ones offered), the first
// prompt and the agent command to start on it (recent ones offered). The
// board stays open. Made from Backlog's +, the card waits there and its agent
// starts when it's dragged to In progress; from any other column's +, it goes
// to In progress and its agent starts at once (a running agent's hooks would
// put it there anyway). With no title the card takes its terminal's title.
import { ApiError } from '../daemon/client.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { setNewCard } from './view.ts';

const dialog = () => document.getElementById('new-card') as HTMLDialogElement;
let column: Status = 'backlog';

// `~/x` is the home directory's x: the daemon only takes absolute paths, so
// it's expanded with the home folder seen in other cards' paths.
function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = store.sessions.map((s) => s.card.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean);
  return home ? home + p.slice(1) : p;
}

export function openNewCard(status: Status): void {
  column = status;
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  form.reset();
  (form.querySelector('.new-card-error') as HTMLElement).hidden = true;
  const folders = recentFolders(store.sessions);
  (document.getElementById('new-card-folders') as HTMLDataListElement).replaceChildren(
    ...folders.map((f) => el('option', { value: f })),
  );
  (form.elements.namedItem('cwd') as HTMLInputElement).value = folders[0] ?? '';
  const commands = current.saved.agentCommands;
  (document.getElementById('new-card-commands') as HTMLDataListElement).replaceChildren(
    ...commands.map((c) => el('option', { value: c })),
  );
  (form.elements.namedItem('command') as HTMLInputElement).value = commands[0] ?? DEFAULT_COMMAND;
  dialog().showModal();
}

export function initNewCard(): void {
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  const error = form.querySelector('.new-card-error') as HTMLElement;
  (form.querySelector('[value="cancel"]') as HTMLButtonElement).onclick = () => dialog().close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
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
      error.textContent = badFolder ? `No folder at ${cwd}` : "Couldn't create the card";
      error.hidden = false;
      return;
    }
    dialog().close();
    // The next card offers it first.
    saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
    if (column !== 'backlog') await setStatus(s, 'in_progress').catch(() => {});
  });
  setNewCard(openNewCard);
}
