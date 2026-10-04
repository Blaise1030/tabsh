// Opening a clicked path in the file pane. The pane (with CodeMirror) is
// fetched on first use.
import type { Host } from './pane.ts';

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
