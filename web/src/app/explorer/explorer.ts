// The file explorer: a sidebar left of the terminals that lists the active
// tab's project. It opens from the tab bar's button, the palette or a
// keybinding, and clicking a file opens it in the file pane. Whether it is
// open and how wide are settings. The tree's library loads on first use.
import { daemonFetch } from '../daemon/client.ts';
import { openInPane } from '../files/open.ts';
import { onActivate, store } from '../sessions/store.ts';
import { matchesKey } from '../settings/keys.ts';
import { EXPLORER_WIDTH } from '../settings/schema.ts';
import { applySettings, current, onApply, saveSetting } from '../settings/settings.ts';
import { fetchTree } from './api.ts';
import { absolutePath, type Listing, shown } from './listing.ts';

type View = typeof import('./view.ts');

let aside: HTMLElement;
let mount: HTMLElement;
let message: HTMLElement;
let view: Promise<View> | null = null;
let listing: Listing | null = null; // what the tree shows
let seq = 0; // bumped by every fetch, so a slow answer to a superseded one is dropped

const isOpen = () => !aside.hidden;

export function toggleExplorer(): void {
  saveSetting('explorerOpen', !current.saved.explorerOpen);
}

export function initExplorer(): void {
  aside = document.getElementById('explorer') as HTMLElement;
  mount = document.getElementById('explorer-tree') as HTMLElement;
  message = document.getElementById('explorer-msg') as HTMLElement;
  const divider = document.getElementById('explorer-divider') as HTMLElement;
  const button = document.getElementById('explorer-btn') as HTMLButtonElement;

  button.onclick = toggleExplorer;
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

  onApply((s) => {
    const wasOpen = isOpen();
    aside.hidden = divider.hidden = !s.explorerOpen;
    button.setAttribute('aria-pressed', String(s.explorerOpen));
    aside.style.setProperty('--explorer-width', `${s.explorerWidth}px`);
    if (s.explorerOpen && !wasOpen) void refresh();
  });
  // A tab's project is fetched on opening and on switching tabs, not more.
  onActivate(() => void refresh());
  initResize(divider);
}

// Drag the divider to resize; the width is live while dragging and saved
// once on release. (main.ts refits the terminals when their area changes.)
function initResize(divider: HTMLElement): void {
  const ws = document.getElementById('workspace') as HTMLElement;
  let width: number | null = null;
  const widthAt = (x: number) =>
    Math.round(Math.min(EXPLORER_WIDTH.max, Math.max(EXPLORER_WIDTH.min, x - aside.getBoundingClientRect().left)));
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    ws.classList.add('dragging');
    width = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (width === null) return;
    width = widthAt(e.clientX);
    aside.style.setProperty('--explorer-width', `${width}px`);
  });
  const end = (e: PointerEvent) => {
    if (width === null) return;
    const w = width;
    width = null;
    ws.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('explorerWidth', w);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
}

async function refresh(): Promise<void> {
  const tab = store.active;
  if (!isOpen() || !tab) return;
  const mine = ++seq;
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
  if (s.kind === 'too-many') return say('Too many files to show here. cd into a project.');
  if (s.kind === 'empty') return say('This folder is empty');
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
  message.hidden = true;
  mount.hidden = false;
  v.showTree(mount, s.paths, (path) => {
    const t = store.active;
    if (t && listing) void openInPane(t, { text: absolutePath(listing.root, path) });
  });
}

// A message in place of the tree (the tree keeps its place, hidden).
function say(text: string): void {
  message.textContent = text;
  message.hidden = false;
  mount.hidden = true;
}
