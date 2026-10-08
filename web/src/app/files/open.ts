// The file step: the place's file is the active tab's, shown in the file
// pane. The pane (with CodeMirror) is fetched on first use.
import van from 'vanjs-core';
import { fileAction, type Place } from '../nav/place.ts';
import { go, here, onLeave, onPlace } from '../nav/router.ts';
import type { Host } from './pane.ts';
import { rememberedFiles, rememberFile } from './remember.ts';

type Pane = typeof import('./pane.ts');

const { button, div, p } = van.tags;

let host: Host;
let activeId: () => string | null = () => null;
let pane: Pane | null = null; // the file-pane module, once loaded
let paneLoad: Promise<Pane> | null = null; // shared by clicks made while it loads, so init runs once
let loadFailed = false; // a second failure reloads the page instead
// The path last clicked: only a click may open a directory (in a new tab).
let clicked: { tab: string; file: string } | null = null;
const never = new AbortController().signal;

// Whether #pane and its divider show: the active tab has a file (pane.ts
// derives it), or the editor couldn't load (the message says so).
export const paneShown = van.state(false);

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
  // The terminal refits once the pane has shown or hidden: VanJS applies the
  // state in a microtask queued before this one.
  let shown = false;
  van.derive(() => {
    if (paneShown.val === shown) return;
    shown = paneShown.val;
    queueMicrotask(() => host.layout());
  });
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
  const clicked_ = !initial && clicked?.tab === tab && clicked.file === file;
  const dirTab = clicked_;
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
  // A load the user clicked says why it failed; URL, startup and restore loads drop it quietly.
  const quiet = initial || !clicked_;
  const abs = await p.showFile(tab, file, to.line, { focus: !initial, signal, dirTab, quiet });
  // The daemon's absolute path, so a reload after a `cd` reopens the same file.
  if (abs !== file) return { file: abs, line: abs ? to.line : null };
}

export function loadedPane(): Pane | null {
  return pane;
}

// Once the router has started: reopens the files the other tabs showed
// before a reload, and forgets those of tabs that are gone. The active tab's
// file is the place's (main.ts puts its remembered one in the startup place).
// The pane is only fetched if there's something to show.
export function restoreFiles(sessionIds: string[]): void {
  const saved = rememberedFiles();
  for (const id of Object.keys(saved)) if (!sessionIds.includes(id)) rememberFile(id, null);
  const { tab } = here();
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
  const again = button(
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        if (retried) return location.reload();
        pane = paneLoad = null;
        paneShown.val = false;
        box.replaceChildren();
        retry();
      },
    },
    'Retry',
  );
  box.replaceChildren(div({ class: 'pane-msg' }, p("Couldn't load the editor"), again));
  paneShown.val = true;
}
