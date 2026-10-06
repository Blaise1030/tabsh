// New card: a title, a folder (recent ones offered), an optional first
// prompt and the agent command to start on it (recent ones offered). With a
// prompt the terminal starts that agent and the card is In progress; without
// one it's a plain shell in the column it came from.
import { openTab, store } from '../sessions/store.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { DEFAULT_COMMAND, recentFolders, rememberCommand, type Status } from './model.ts';
import { setStatus } from './status.ts';
import { setNewCard, toggleBoard } from './view.ts';

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
    try {
      await openTab({ name, ...(cwd && { cwd }), ...(prompt && { prompt, command }) });
    } catch {
      error.textContent = cwd ? `No folder at ${cwd}` : "Couldn't create the card";
      error.hidden = false;
      return;
    }
    dialog().close();
    if (prompt) {
      // The next card offers it first.
      saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
    }
    const s = store.active;
    if (s && !prompt && column !== 'backlog') await setStatus(s, column).catch(() => {});
    toggleBoard(false);
  });
  setNewCard(openNewCard);
}
