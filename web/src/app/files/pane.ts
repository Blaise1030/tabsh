import { el, isMac } from '../ui/dom.ts';
import {
  displayPath,
  type Fetcher,
  FileError,
  type FileInfo,
  fileVersion,
  formatSize,
  fromDisk,
  rawBlobUrl,
  readFile,
  saveFile,
  toDisk,
} from './api.ts';
import { createEditor, type Editor } from './editor.ts';

export interface PaneTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  light: boolean;
}
export interface Host {
  fetch: Fetcher;
  theme(): PaneTheme;
  layout(): void; // refit the active terminal (sendSize(active))
  newTabAt(cwd: string): void; // POST /api/sessions {cwd} then activate
  focusTerminal(): void;
}

interface PaneState {
  id: string;
  view: HTMLElement; // this session's header and body, inside #pane
  body: HTMLElement | null;
  ui: { edit: HTMLButtonElement; dot: HTMLElement; status: HTMLElement; bar: HTMLElement } | null;
  editable: boolean;
  mode: 'view' | 'edit';
  doc: string; // current text (\n endings) while no editor is mounted
  version: string;
  eol: 'crlf' | 'lf';
  dirty: boolean;
  saving: boolean;
  conflict: string | null; // the version found on disk when a save was refused
  epoch: number; // bumped when the view is rebuilt, so a late save result is dropped
  previewSeq: number;
  timer: number | undefined;
  info: FileInfo | null;
  requested: string;
  line?: number;
  col?: number;
  editor: Editor | null;
  blobUrl: string | null;
  markdown: string | null; // rendered HTML, re-wrapped when the theme changes
  frame: HTMLIFrameElement | null;
}

let host: Host;
let paneEl: HTMLElement;
let dividerEl: HTMLElement;
const states = new Map<string, PaneState>();
// Bumped by every open and forget, so a slow response to a superseded one is dropped.
const seqs = new Map<string, number>();
let current: string | null = null;
const EDITABLE = new Set(['text', 'html', 'markdown', 'svg']);
// How often the shown file is checked for changes on disk (a stat, no content).
const POLL_MS = 2000;
let polling = false;

export function init(h: Host): void {
  host = h;
  paneEl = document.getElementById('pane')!;
  dividerEl = document.getElementById('pane-divider')!;
  paneEl.replaceChildren(); // drop a "couldn't load" message from an earlier attempt
  // Esc goes back to the terminal, after CodeMirror's own Esc (closing search).
  paneEl.addEventListener('keydown', (e) => {
    const st = current === null ? undefined : states.get(current);
    const key = e.key.toLowerCase();
    const mod = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (mod && st && (key === 's' || key === 'e')) {
      // The editor's own Mod-s has already saved and set defaultPrevented.
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (!handled) {
        if (key === 's') void save(st);
        else toggleMode(st);
      }
    } else if (e.key === 'Escape' && !e.defaultPrevented) host.focusTerminal();
  });
  // Only while the page is visible; coming back checks at once.
  window.setInterval(() => void poll(), POLL_MS);
  document.addEventListener('visibilitychange', () => void poll());
  window.addEventListener('focus', () => void poll());
}

function button(label: string, onclick: () => void, title = label): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', textContent: label, title, onclick });
  b.dataset.variant = 'ghost';
  b.dataset.size = 'sm';
  return b;
}

// Lucide icons (ISC). Static markup only: nothing from a file goes in here.
const ICONS = {
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  preview:
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  collapse: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>',
};

function setIcon(b: HTMLButtonElement, icon: keyof typeof ICONS, label: string): void {
  b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  b.title = label;
  b.setAttribute('aria-label', label);
}

function iconButton(icon: keyof typeof ICONS, label: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', onclick });
  b.dataset.variant = 'ghost';
  b.dataset.size = 'icon-sm';
  setIcon(b, icon, label);
  return b;
}

// The Edit/Preview toggle shows what pressing it does.
function setEditIcon(st: PaneState, editing: boolean): void {
  const mod = isMac ? '⌘' : 'Ctrl-';
  setIcon(st.ui!.edit, editing ? 'preview' : 'edit', `${editing ? 'Preview' : 'Edit'} (${mod}E)`);
}

// Drops whatever the body shows, freeing the editor and any blob.
function clear(st: PaneState): void {
  st.editor?.destroy();
  st.editor = null;
  if (st.blobUrl) URL.revokeObjectURL(st.blobUrl);
  st.blobUrl = null;
  st.markdown = null;
  st.frame = null;
}

function refresh(): void {
  const st = current === null ? undefined : states.get(current);
  for (const s of states.values()) s.view.hidden = s !== st;
  const open = !!st;
  if (paneEl.hidden === !open && dividerEl.hidden === !open) return;
  paneEl.hidden = dividerEl.hidden = !open;
  host.layout();
}

export function show(sessionId: string | null): void {
  current = sessionId;
  refresh();
  void poll();
}

export function forget(sessionId: string): void {
  seqs.set(sessionId, (seqs.get(sessionId) ?? 0) + 1);
  const st = states.get(sessionId);
  if (!st) return;
  clear(st);
  st.view.remove();
  states.delete(sessionId);
  refresh();
}

export function hasUnsaved(): boolean {
  for (const st of states.values()) if (st.dirty) return true;
  return false;
}

export function confirmDiscard(sessionId: string): boolean {
  const st = states.get(sessionId);
  if (!st?.dirty) return true;
  const name = (st.info?.path ?? st.requested).split('/').pop();
  return confirm(`Discard unsaved changes to ${name}?`);
}

export function hasFile(sessionId: string): boolean {
  return states.has(sessionId);
}

export function close(sessionId: string): void {
  if (!confirmDiscard(sessionId)) return;
  forget(sessionId);
  host.focusTerminal();
}

// A relative path is shown relative to the directory it was resolved from.
function shownPath(st: PaneState, abs: string): string {
  const rel = st.requested.replace(/^\.\//, '');
  if (rel.startsWith('/') || rel.startsWith('~') || !abs.endsWith('/' + rel)) return abs;
  return displayPath(abs, abs.slice(0, abs.length - rel.length));
}

function header(sessionId: string, st: PaneState, info: FileInfo | null): HTMLElement {
  const abs = info?.path ?? st.requested;
  const path = el('span', { className: 'pane-path', textContent: info ? shownPath(st, abs) : abs, title: abs });
  const dot = el('span', { className: 'pane-dot', textContent: '●', title: 'Unsaved changes', hidden: true });
  const status = el('span', { className: 'pane-status', role: 'status' });
  const edit = iconButton('edit', 'Edit', () => toggleMode(st));
  edit.disabled = !st.editable;
  const x = iconButton('collapse', 'Close file', () => close(sessionId));
  const bar = el(
    'div',
    { className: 'pane-bar', hidden: true, role: 'alert' },
    el('span', { textContent: 'Changed on disk. Your edits are unsaved.' }),
    button('Reload', () => void reload(st)),
    button('Overwrite', () => void save(st, true)),
  );
  st.ui = { edit, dot, status, bar };
  setEditIcon(st, st.mode === 'edit');
  return el('header', { className: 'pane-head' }, x, path, status, dot, edit);
}

function setStatus(st: PaneState, text: string, ms?: number): void {
  clearTimeout(st.timer);
  st.ui!.status.textContent = text;
  if (ms)
    st.timer = window.setTimeout(() => {
      st.ui!.status.textContent = '';
    }, ms);
}

function setDirty(st: PaneState, on: boolean): void {
  st.dirty = on;
  if (st.ui) st.ui.dot.hidden = !on;
}

function currentText(st: PaneState): string {
  return st.editor ? st.editor.text() : st.doc;
}

function toggleMode(st: PaneState): void {
  if (!st.editable || !st.info) return;
  const edit = st.mode === 'view';
  if (st.info.kind === 'text') {
    st.editor?.setReadOnly(!edit);
    if (edit) st.editor?.view.focus();
  } else {
    if (st.editor) st.doc = st.editor.text();
    st.mode = edit ? 'edit' : 'view';
    mountRich(st);
    setEditIcon(st, edit);
    return;
  }
  st.mode = edit ? 'edit' : 'view';
  setEditIcon(st, edit);
}

async function save(st: PaneState, overwrite = false): Promise<void> {
  const info = st.info;
  if (!info || !st.editable || st.saving) return;
  if (!overwrite && !st.dirty) return;
  const version = overwrite && st.conflict !== null ? st.conflict : st.version;
  const text = currentText(st);
  const epoch = st.epoch;
  st.saving = true;
  let res: { version: string } | { conflict: string } | null = null;
  let error = '';
  try {
    res = await saveFile(host.fetch, info.path, toDisk(text, st.eol), version);
  } catch (err) {
    error = err instanceof FileError ? err.message : "Couldn't reach tabsh";
  }
  if (st.epoch !== epoch || states.get(st.id) !== st) return; // reloaded or closed meanwhile
  st.saving = false;
  if (res && 'conflict' in res) {
    st.conflict = res.conflict;
    st.ui!.bar.hidden = false;
    setStatus(st, '');
  } else if (res && !res.version) {
    // Written, but we can't tell the next save's base version.
    st.conflict = null;
    st.ui!.bar.hidden = true;
    setStatus(st, "Saved, but the server didn't return a version; reload before saving again");
  } else if (res) {
    st.version = res.version;
    st.conflict = null;
    st.ui!.bar.hidden = true;
    // Edits made while the save was in flight stay unsaved.
    if (currentText(st) === text) setDirty(st, false);
    setStatus(st, 'Saved', 1500);
  } else {
    setStatus(st, error);
  }
}

// Re-reads the file, dropping the edits.
function reload(st: PaneState, focus = true): Promise<void> {
  return load(st.id, st.info?.path ?? st.requested, undefined, undefined, focus);
}

// Checks whether the shown file changed on disk. Without edits it's reloaded
// in place; with them the bar asks whether to reload or overwrite.
async function poll(): Promise<void> {
  const st = current === null ? undefined : states.get(current);
  if (polling || document.hidden || !st?.info || st.info.kind === 'dir' || st.saving) return;
  const { epoch, version } = st;
  polling = true;
  let disk: string | null;
  try {
    disk = await fileVersion(host.fetch, st.id, st.info.path);
  } catch {
    return; // the daemon is away; try again next time
  } finally {
    polling = false;
  }
  // A save, reload or close since then has its own idea of the version.
  if (st.epoch !== epoch || st.version !== version || st.saving || states.get(st.id) !== st) return;
  if (disk === null || disk === version || disk === st.conflict) return;
  if (st.dirty) {
    st.conflict = disk;
    st.ui!.bar.hidden = false;
  } else await pull(st);
}

// Shows the disk's copy of a file with no edits, keeping the mode and, in the
// editor, the cursor and scroll. Other kinds are simply reloaded.
async function pull(st: PaneState): Promise<void> {
  const epoch = st.epoch;
  let info: FileInfo;
  try {
    info = await readFile(host.fetch, st.id, st.info!.path);
  } catch {
    return;
  }
  if (st.epoch !== epoch || states.get(st.id) !== st || st.dirty || st.saving) return;
  const editable = info.content !== undefined && EDITABLE.has(info.kind);
  if (!editable || !st.editable || info.kind !== st.info!.kind) return reload(st, false);
  Object.assign(st, {
    info,
    version: info.version,
    eol: info.eol ?? 'lf',
    doc: fromDisk(info.content!),
    conflict: null,
  });
  st.ui!.bar.hidden = true;
  if (st.editor) st.editor.setText(st.doc);
  else mountRich(st);
}

function message(text: string): HTMLElement {
  return el('div', { className: 'pane-msg' }, el('p', { textContent: text }));
}

function markdownDoc(html: string, th: PaneTheme): string {
  const style =
    `body{margin:0;padding:1rem 1.5rem;font:14px/1.6 system-ui,sans-serif;background:${th.background};color:${th.foreground}}` +
    `a{color:${th.cursor}}pre,code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}` +
    `pre{padding:.75rem;overflow:auto;background:color-mix(in srgb,${th.foreground} 8%,${th.background})}` +
    `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid color-mix(in srgb,${th.foreground} 20%,${th.background});padding:.25rem .5rem}` +
    // The preview scrolls inside its own frame, where the pane can't see it, so
    // it fades out under the header itself once scrolled (no script needed).
    `body::before{content:"";position:fixed;top:0;left:0;right:0;height:1rem;z-index:1;pointer-events:none;` +
    `background:linear-gradient(${th.background},transparent);opacity:0;` +
    `animation:fade linear both;animation-timeline:scroll(root);animation-range:0 1px}` +
    `@keyframes fade{to{opacity:1}}`;
  return `<!doctype html><meta charset="utf-8"><style>${style}</style>${html}`;
}

function svgDoc(svg: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}' +
    'body{display:grid;place-items:center}svg{max-width:100%;max-height:100%}</style>' +
    svg
  );
}

function newEditor(st: PaneState, body: HTMLElement, readOnly: boolean): Editor {
  return createEditor(body, {
    doc: st.doc,
    path: st.info!.path,
    readOnly,
    theme: host.theme(),
    onChange: () => {
      setDirty(st, true);
      if (st.ui) st.ui.status.textContent = '';
    },
    onSave: () => void save(st),
  });
}

// Markdown, HTML and SVG: sandboxed preview of the current text, or its source in CodeMirror.
function mountRich(st: PaneState): void {
  const body = st.body!,
    kind = st.info!.kind;
  const seq = ++st.previewSeq;
  st.editor?.destroy();
  st.editor = null;
  st.frame = null;
  st.markdown = null;
  body.replaceChildren();
  if (st.mode === 'edit') {
    st.editor = newEditor(st, body, false);
    st.editor.view.focus();
    return;
  }
  const title = st.info!.path;
  const show = (srcdoc: string, sandbox: string) => {
    const frame = el('iframe', { className: 'pane-frame', srcdoc, title });
    frame.setAttribute('sandbox', sandbox);
    body.append(frame);
    return frame;
  };
  if (kind === 'html') {
    // No allow-same-origin: the page gets an opaque origin, away from the token.
    show(st.doc, 'allow-scripts allow-popups');
  } else if (kind === 'svg') {
    // Not a blob: an image/svg+xml blob URL has the app's origin, and opened
    // as a page it could run script there. An empty sandbox can't.
    show(svgDoc(st.doc), '');
  } else {
    void import('marked')
      .then(({ marked }) => marked.parse(st.doc))
      .then(
        (html) => {
          if (st.previewSeq !== seq || st.body !== body || st.mode !== 'view') return;
          // An empty sandbox: no scripts, an opaque origin.
          st.markdown = html;
          st.frame = show(markdownDoc(html, host.theme()), '');
        },
        () => {
          if (st.previewSeq === seq) body.replaceChildren(message("Couldn't render the preview"));
        },
      );
  }
}

async function renderBody(st: PaneState, info: FileInfo, body: HTMLElement, isCurrent: () => boolean): Promise<void> {
  const tooLarge = () => message(`Too large to open here (${formatSize(info.size)})`);
  switch (info.kind) {
    case 'image':
    case 'pdf': {
      const url = await rawBlobUrl(host.fetch, info.path);
      if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return;
      }
      st.blobUrl = url;
      // A raster image can't run scripts; a PDF gets the browser's own viewer.
      body.append(
        info.kind === 'pdf'
          ? el('iframe', { className: 'pane-frame', src: url, title: info.path })
          : el('img', { className: 'pane-img', src: url, alt: info.path }),
      );
      return;
    }
    case 'binary':
      body.append(message(`Binary file, ${formatSize(info.size)}`));
      return;
    case 'html':
    case 'svg':
    case 'markdown':
      if (info.content === undefined) {
        body.append(tooLarge());
        return;
      }
      mountRich(st);
      return;
    case 'text': {
      if (info.content === undefined) {
        body.append(tooLarge());
        return;
      }
      st.editor = newEditor(st, body, true);
      st.editor.goTo(st.line ?? 1, st.col);
      return;
    }
  }
}

export function openPath(sessionId: string, path: string, line?: number, col?: number): Promise<void> {
  if (!confirmDiscard(sessionId)) return Promise.resolve();
  return load(sessionId, path, line, col);
}

// `focus` is false for a reload nobody asked for, which mustn't take the keyboard.
async function load(sessionId: string, path: string, line?: number, col?: number, focus = true): Promise<void> {
  const seq = (seqs.get(sessionId) ?? 0) + 1;
  seqs.set(sessionId, seq);
  let info: FileInfo | null = null;
  let error: string | null = null;
  try {
    info = await readFile(host.fetch, sessionId, path);
  } catch (err) {
    error = err instanceof FileError ? `${err.message}: ${path}` : `Couldn't reach tabsh: ${path}`;
  }
  if (seqs.get(sessionId) !== seq) return;
  if (info?.kind === 'dir') {
    host.newTabAt(info.path);
    return;
  }

  let st = states.get(sessionId);
  if (!st) {
    st = {
      id: sessionId,
      view: el('section', { className: 'pane-view' }),
      body: null,
      ui: null,
      editable: false,
      mode: 'view',
      doc: '',
      version: '',
      eol: 'lf',
      dirty: false,
      saving: false,
      conflict: null,
      epoch: 0,
      previewSeq: 0,
      timer: undefined,
      info: null,
      requested: path,
      editor: null,
      blobUrl: null,
      markdown: null,
      frame: null,
    };
    states.set(sessionId, st);
    paneEl.append(st.view);
    // Scroll doesn't bubble, so catch the editor's or body's on the way down.
    const view = st.view;
    view.addEventListener(
      'scroll',
      (e) => {
        const target = e.target as HTMLElement;
        view.querySelector('.pane-head')?.classList.toggle('scrolled', target.scrollTop > 0);
      },
      true,
    );
  }
  clear(st);
  clearTimeout(st.timer);
  st.epoch++;
  st.previewSeq++;
  const editable = !!info && info.content !== undefined && EDITABLE.has(info.kind);
  Object.assign(st, {
    info,
    requested: path,
    line,
    col,
    editable,
    mode: 'view',
    dirty: false,
    saving: false,
    conflict: null,
    doc: editable ? fromDisk(info!.content!) : '',
    version: info?.version ?? '',
    eol: info?.eol ?? 'lf',
  });
  const body = el('div', { className: 'pane-body' });
  st.body = body;
  st.view.replaceChildren(header(sessionId, st, info), body, st.ui!.bar);
  refresh();

  const state = st;
  const isCurrent = () => states.get(sessionId) === state && seqs.get(sessionId) === seq;
  if (error || !info) {
    body.append(message(error ?? 'Not found'));
    return;
  }
  try {
    await renderBody(state, info, body, isCurrent);
    // So the keyboard (Cmd/Ctrl-E, -S) works at once; Esc goes back to the terminal.
    if (focus && isCurrent() && current === sessionId) {
      if (state.editor) state.editor.view.focus();
      else paneEl.focus();
    }
  } catch (err) {
    if (!isCurrent()) return;
    const big = err instanceof FileError && err.status === 413;
    body.replaceChildren(
      big
        ? message(`Too large to open here (${formatSize(info.size)})`)
        : message(err instanceof FileError ? err.message : `Couldn't open ${info.path}`),
    );
  }
}

export function applyTheme(): void {
  const th = host.theme();
  for (const st of states.values()) {
    st.editor?.setTheme(th);
    if (st.frame && st.markdown !== null) st.frame.srcdoc = markdownDoc(st.markdown, th);
  }
}
