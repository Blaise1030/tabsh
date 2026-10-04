// Opening a clicked path in the file pane. The pane (with CodeMirror) is
// fetched on first use.
import type { Host } from './pane.ts';
import { rememberedFiles, rememberFile } from './remember.ts';

type Pane = typeof import('./pane.ts');

let host: Host;
let activeId: () => string | null = () => null;
let pane: Pane | null = null; // the file-pane module, once loaded
let paneLoad: Promise<Pane> | null = null; // shared by clicks made while it loads, so init runs once

export function initFilePane(h: Host, active: () => string | null): void {
  host = h;
  activeId = active;
}

export function loadedPane(): Pane | null {
  return pane;
}

// Reopens the files the tabs showed before a reload, and forgets those of
// tabs that are gone. The pane is only fetched if there's something to show.
export function restoreFiles(sessionIds: string[]): void {
  const saved = rememberedFiles();
  for (const id of Object.keys(saved)) if (!sessionIds.includes(id)) rememberFile(id, null);
  const ids = sessionIds.filter((id) => saved[id]);
  if (!ids.length) return;
  filePane().then((p) => {
    for (const id of ids) void p.restore(id, saved[id]);
  }, console.error);
}

function filePane(): Promise<Pane> {
  paneLoad ??= import('./pane.ts').then(
    (m) => {
      m.init(host);
      pane = m;
      m.show(activeId());
      return m;
    },
    (err) => {
      paneLoad = null;
      throw err;
    },
  );
  return paneLoad;
}

export async function openInPane(
  s: { id: string; closed: boolean },
  f: { text: string; line?: number; col?: number },
  retried = false,
): Promise<void> {
  let p: Pane;
  try {
    p = await filePane();
  } catch (err) {
    console.error(err);
    return paneLoadFailed(() => openInPane(s, f, true), retried);
  }
  if (!s.closed) await p.openPath(s.id, f.text, f.line, f.col);
}

// The bundle couldn't be fetched (offline, or a daemon that doesn't serve it yet).
// Chrome remembers a failed import(), so a second failure reloads the page
// instead; the shells survive that.
function paneLoadFailed(retry: () => void, retried: boolean): void {
  const box = document.getElementById('pane') as HTMLElement;
  const divider = document.getElementById('pane-divider') as HTMLElement;
  const msg = document.createElement('div');
  msg.className = 'pane-msg';
  const p = document.createElement('p');
  p.textContent = "Couldn't load the editor";
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn';
  again.textContent = 'Retry';
  again.onclick = () => {
    if (retried) return location.reload();
    pane = paneLoad = null;
    box.hidden = divider.hidden = true;
    box.replaceChildren();
    retry();
  };
  msg.append(p, again);
  box.replaceChildren(msg);
  box.hidden = divider.hidden = false;
  host.layout();
}
