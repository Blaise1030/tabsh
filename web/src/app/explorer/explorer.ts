// The file explorer: a sidebar left of the terminals that lists the active
// tab's project. It opens from the tab bar's button, the palette or a
// keybinding, and clicking a file opens it in the file pane. Whether it is
// open is part of the place (the setting only follows it); how wide is a
// setting. The tree's library loads on first use. The sidebar's chrome
// (sidebar.ts) follows the states below.
import van, { type State } from 'vanjs-core';
import { daemonFetch } from '../daemon/client.ts';
import { openInPane } from '../files/open.ts';
import { go, here, onPlace } from '../nav/router.ts';
import { newTabAt, onActivate, store } from '../sessions/store.ts';
import { matchesKey } from '../settings/keys.ts';
import { EXPLORER_WIDTH } from '../settings/schema.ts';
import { applySettings, current, onApply, saveSetting } from '../settings/settings.ts';
import { fetchTree } from './api.ts';
import { type Change, type Live, onMessage } from './changes.ts';
import {
  absolutePath,
  cdCommand,
  folderOf,
  type Listing,
  opensSearch,
  pastedPath,
  type RowAction,
  rootName,
  shown,
} from './listing.ts';
import { watchFiles } from './socket.ts';

type View = typeof import('./view.ts');

// Whether the sidebar is open: assigned only by the router's explorer step.
export const open: State<boolean> = van.state(false);
// The listed root, for the heading (its name, the path as its title).
export const root: State<{ name: string; path: string } | null> = van.state(null);
// Only folders are shown (too many files to list).
export const note: State<boolean> = van.state(false);
// A message in place of the tree; null while the tree shows. Before the
// first listing it is '', so neither shows.
export const message: State<string | null> = van.state<string | null>('');
// The sidebar's width in px, from the settings or a drag; null until they apply.
export const width: State<number | null> = van.state<number | null>(null);

let mount: HTMLElement; // the tree's host, made once by sidebar.ts
let view: Promise<View> | null = null;
let ready: View | null = null; // the loaded tree library, once there is a tree
let listing: Listing | null = null; // what the tree shows
const live: Live = { known: null, settling: false }; // the paths the tree has, and whether a new root's listing is awaited
let unwatch: (() => void) | null = null;
let watched: string | null = null; // the session the socket is open for
let wantSearch = false; // "Search files" was picked and the tree isn't there yet
let seq = 0; // bumped by every fetch, so a slow answer to a superseded one is dropped

const isOpen = () => open.val;
const treeShown = () => !!ready && message.val === null;

export function toggleExplorer(): void {
  go({ explorer: !here().explorer });
}

// Opens the sidebar if it is closed, then the tree's search field (once the
// tree is there). The palette that calls this closes after and hands focus
// back, so the field opens a moment later.
export function searchFiles(): void {
  wantSearch = true;
  if (!here().explorer) go({ explorer: true });
  else if (treeShown()) openSearchSoon();
}

function openSearchSoon(): void {
  wantSearch = false;
  setTimeout(() => ready?.openSearch(), 0);
}

export function initExplorer(): void {
  mount = document.getElementById('explorer-tree') as HTMLElement;
  const divider = document.getElementById('explorer-divider') as HTMLElement;
  (document.getElementById('explorer-btn') as HTMLButtonElement).onclick = toggleExplorer;
  // `/` in the tree opens the search; anywhere else it is a plain key.
  mount.addEventListener(
    'keydown',
    (e) => {
      if (!ready || !opensSearch(e, ready.isSearchOpen())) return;
      e.preventDefault();
      e.stopPropagation();
      ready.openSearch();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesKey(e, current.saved.keyToggleExplorer) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      toggleExplorer();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesKey(e, current.saved.keySearchFiles) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      searchFiles();
    },
    true,
  );

  // Open or closed comes from the place; settings only give the width.
  onPlace('explorer', (to) => {
    const wasOpen = open.val;
    // Hiding the sidebar under the keyboard would leave it on <body>.
    const heldFocus =
      wasOpen && !to.explorer && !!document.getElementById('explorer')?.contains(document.activeElement);
    open.val = to.explorer;
    if (to.explorer && !wasOpen) void refresh();
    watch();
    if (heldFocus) store.active?.term.focus();
    if (to.explorer !== current.saved.explorerOpen) saveSetting('explorerOpen', to.explorer);
    return undefined;
  });
  onApply((s) => {
    width.val = s.explorerWidth;
  });
  // A tab's project is fetched on opening and on switching tabs; after that
  // the socket keeps the tree current.
  onActivate(() => {
    void refresh();
    watch();
  });
  initResize(divider);
}

// Drag the divider to resize; the width is live while dragging and saved
// once on release. (main.ts refits the terminals when their area changes.)
function initResize(divider: HTMLElement): void {
  const aside = document.getElementById('explorer') as HTMLElement;
  const ws = document.getElementById('workspace') as HTMLElement;
  let dragged: number | null = null;
  const widthAt = (x: number) =>
    Math.round(Math.min(EXPLORER_WIDTH.max, Math.max(EXPLORER_WIDTH.min, x - aside.getBoundingClientRect().left)));
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    ws.classList.add('dragging');
    dragged = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (dragged === null) return;
    dragged = widthAt(e.clientX);
    width.val = dragged;
  });
  const end = (e: PointerEvent) => {
    if (dragged === null) return;
    const w = dragged;
    dragged = null;
    ws.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('explorerWidth', w);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
}

// The live socket is open while the sidebar is, for the active tab only.
function watch(): void {
  const want = isOpen() ? (store.active?.id ?? null) : null;
  if (want === watched) return;
  unwatch?.();
  unwatch = null;
  watched = want;
  if (want) unwatch = watchFiles(want, () => void refresh(), onChange);
}

// A live update: operations for the open tree, or a re-fetch (once, for a new
// root, whatever arrives before its listing does).
function onChange(change: Change): void {
  if (!treeShown()) live.known = null;
  const action = onMessage(live, change);
  if (action.kind === 'reset') void refresh();
  else if (action.kind === 'ops') ready?.applyOps(action.ops);
}

async function refresh(): Promise<void> {
  const mine = ++seq;
  await load(mine);
  if (mine === seq) live.settling = false;
}

async function load(mine: number): Promise<void> {
  const tab = store.active;
  if (!isOpen() || !tab) return;
  let l: Listing;
  try {
    l = await fetchTree(daemonFetch, tab.id);
  } catch (err) {
    console.error(err);
    if (mine === seq) say("Couldn't list the files here");
    return;
  }
  if (mine !== seq) return;
  const s = shown(l);
  live.known = null;
  root.val = { name: rootName(l.root), path: l.root };
  note.val = s.kind === 'folders';
  if (s.kind === 'too-many') return say('Too many files to show here. cd into a project.');
  if (s.kind === 'empty') return say('This folder is empty');
  if (listing && listing.root !== l.root) ready?.closeSearch(); // a new root starts unfiltered
  listing = l;
  view ??= import('./view.ts').catch((err) => {
    view = null;
    throw err;
  });
  let v: View;
  try {
    v = await view;
  } catch (err) {
    console.error(err);
    if (mine === seq) say("Couldn't load the file tree");
    return;
  }
  if (mine !== seq) return;
  ready = v;
  live.known = new Set(s.paths);
  message.val = null;
  // The host shows once VanJS applies that, in a microtask queued before
  // this await's: the tree is drawn into a shown host, as it always was.
  await Promise.resolve();
  if (mine !== seq) return;
  v.showTree(
    mount,
    s.paths,
    (path) => {
      const t = store.active;
      if (t && listing) void openInPane(t, { text: absolutePath(listing.root, path) });
    },
    act,
  );
  if (wantSearch) openSearchSoon();
}

// A pick from a row's menu. Paste never presses Enter (the front program may
// not be a shell); it leaves focus in the terminal so typing carries on.
function act(action: RowAction, path: string): void {
  const t = store.active;
  if (!t || t.closed || !listing) return;
  if (action === 'tab') {
    void newTabAt(folderOf(listing.root, path));
    return;
  }
  t.term.paste(action === 'cd' ? cdCommand(listing.root, path) : pastedPath(listing.root, path));
  t.term.focus();
}

// A message in place of the tree (the tree keeps its place, hidden).
function say(text: string): void {
  wantSearch = false;
  note.val = false;
  message.val = text;
}
