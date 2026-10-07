// The file step: the place's file is the active tab's, shown in the file
// pane. The pane (with CodeMirror) is fetched on first use.
import { fileAction, type Place } from '../nav/place.ts';
import { go, here, onLeave, onPlace } from '../nav/router.ts';
import type { Host } from './pane.ts';
import { rememberedFiles, rememberFile } from './remember.ts';

type Pane = typeof import('./pane.ts');

let host: Host;
let activeId: () => string | null = () => null;
let pane: Pane | null = null; // the file-pane module, once loaded
let paneLoad: Promise<Pane> | null = null; // shared by clicks made while it loads, so init runs once
let loadFailed = false; // a second failure reloads the page instead
// The path last clicked: only a click may open a directory (in a new tab).
let clicked: { tab: string; file: string } | null = null;
const never = new AbortController().signal;

export function initFilePane(h: Host, active: () => string | null): void {
  host = h;
  activeId = active;
  // Replacing or closing a tab's file with unsaved edits asks first; a tab
  // switch doesn't (each tab keeps its file), nor does a move to another line.
  onLeave((to, from) => {
    const action = fileAction(from, to);
    if (!pane || !to.tab || (action !== 'open' && action !== 'close')) return true;
    if (!pane.isDirty(to.tab) || pane.fileOf(to.tab) === to.file) return true;
    return pane.confirmDiscard(to.tab);
  });
  onPlace('file', applyFile);
}

async function applyFile(to: Place, from: Place, signal: AbortSignal, initial: boolean) {
  const action = fileAction(from, to);
  if (action === 'keep') return;
  const tab = activeId();
  // Another tab, or one the tab step had to correct: whatever that tab shows.
  if (action === 'adopt' || !tab || tab !== to.tab) {
    const file = (tab && pane?.fileOf(tab)) || null;
    return file === to.file ? undefined : { file, line: null };
  }
  if (action === 'close') {
    pane?.showFile(tab, null, null, { focus: false, signal });
    if (!initial) host.focusTerminal();
    return;
  }
  const file = to.file as string;
  const dirTab = !initial && clicked?.tab === tab && clicked.file === file;
  clicked = null;
  let p: Pane;
  try {
    p = await filePane();
  } catch (err) {
    console.error(err);
    paneLoadFailed(() => go({ tab, file, line: to.line }), loadFailed);
    loadFailed = true;
    return { file: null, line: null };
  }
  const abs = await p.showFile(tab, file, to.line, { focus: !initial, signal, dirTab });
  // The daemon's absolute path, so a reload after a `cd` reopens the same file.
  if (abs !== file) return { file: abs, line: abs ? to.line : null };
}

export function loadedPane(): Pane | null {
  return pane;
}

// Once the router has started: reopens the files the other tabs showed
// before a reload, and forgets those of tabs that are gone. The active tab's
// file is the place's; when the URL names none, the tab's remembered one
// comes back through it. The pane is only fetched if there's something to show.
export function restoreFiles(sessionIds: string[]): void {
  const saved = rememberedFiles();
  for (const id of Object.keys(saved)) if (!sessionIds.includes(id)) rememberFile(id, null);
  const { tab, file } = here();
  if (tab && !file && saved[tab]) go({ file: saved[tab] }, 'replace');
  const ids = sessionIds.filter((id) => saved[id] && id !== tab);
  if (!ids.length) return;
  filePane().then((p) => {
    for (const id of ids) void p.showFile(id, saved[id], null, { focus: false, signal: never });
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

// A clicked path: a move to it, in its tab.
export function openInPane(s: { id: string; closed: boolean }, f: { text: string; line?: number }): void {
  if (s.closed) return;
  clicked = { tab: s.id, file: f.text };
  go({ tab: s.id, file: f.text, line: f.line ?? null });
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
