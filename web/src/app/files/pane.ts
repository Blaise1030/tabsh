// The file pane: one view per tab with a file, the current tab's shown. The
// header and the conflict bar are components following each view's states;
// the body is a host made once per load, filled with a sandboxed preview, an
// image, a message or CodeMirror. Nothing from a file goes in as markup: paths
// and messages are child strings or attribute values, previews are srcdoc in
// sandboxed frames, images and PDFs blob: URLs.
import van, { type State } from 'vanjs-core';
import { go, here } from '../nav/router.ts';
import { isMac } from '../ui/dom.ts';
import { icons } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import { createNotes, type Notes, type PasteResult } from './annotate.ts';
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
import { frameCsp, highlightCss, renderBlocks } from './comments.ts';
import { createEditor, type Editor } from './editor.ts';
import { paneShown } from './open.ts';
import frameScript from './preview-frame.ts?worker&url';
import { rememberFile } from './remember.ts';

const { button, div, header, iframe, img, p, section, span } = van.tags;

export interface PaneTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  light: boolean;
  fontFamily: string; // the terminal's font, already loaded
  fontSize: number;
}
export interface Host {
  fetch: Fetcher;
  theme(): PaneTheme;
  layout(): void; // refit the active terminal (sendSize(active))
  newTabAt(cwd: string): void; // POST /api/sessions {cwd} then activate
  focusTerminal(): void;
  // Pastes into a tab's terminal (bracketed, never pressing Enter).
  paste(sessionId: string, text: string): PasteResult;
}

interface PaneState {
  id: string;
  key: string; // the view's: the tab's id and which state this is, so a tab closed and reopened at once gets a new view
  // What the header shows: the absolute path (its title) and the path as shown.
  path: State<{ abs: string; text: string }>;
  dirty: State<boolean>;
  status: State<string>;
  conflict: State<string | null>; // the version found on disk when a save was refused; the bar shows while set
  editing: State<boolean>;
  editable: State<boolean>;
  scrolled: State<boolean>; // the body is scrolled: the header shows its shadow
  body: State<HTMLElement>; // this load's host: a preview, an image, a message or CodeMirror
  doc: string; // current text (\n endings) while no editor is mounted
  version: string;
  eol: 'crlf' | 'lf';
  saving: boolean;
  epoch: number; // bumped when the view is rebuilt, so a late save result is dropped
  previewSeq: number;
  timer: number | undefined;
  info: FileInfo | null;
  requested: string;
  line?: number;
  editor: Editor | null;
  blobUrl: string | null;
  markdown: string | null; // rendered HTML, re-wrapped when the theme changes
  frame: HTMLIFrameElement | null;
  notes: Notes; // the comments on a Markdown preview (annotate.ts)
  mark: string; // the Markdown preview's render mark (comments.ts's renderBlocks)
}

let host: Host;
let paneEl: HTMLElement;
const states = new Map<string, PaneState>();
// The views, in the order they were opened: `states`' values, assigned whole.
const panes = van.state<PaneState[]>([]);
// The tab whose view shows.
const current = van.state<string | null>(null);
// Bumped by every open and forget, so a slow response to a superseded one is dropped.
const seqs = new Map<string, number>();
const EDITABLE = new Set(['text', 'html', 'markdown', 'svg']);
// How often the shown file is checked for changes on disk (a stat, no content).
const POLL_MS = 2000;
let polling = false;

const currentState = (): PaneState | undefined => (current.val === null ? undefined : states.get(current.val));

// VanJS applies state changes in a microtask, queued by the first change; this
// resolves after it has run, so the views and the pane are on the page.
const applied = () => new Promise<void>((resolve) => queueMicrotask(resolve));

export function init(h: Host): void {
  host = h;
  paneEl = document.getElementById('pane')!;
  paneEl.replaceChildren(); // drop a "couldn't load" message from an earlier attempt
  keyed(
    paneEl,
    () => panes.val,
    (st) => st.key,
    PaneView,
  );
  // The pane shows while the current tab has a file (open.ts refits the terminal when it flips).
  van.derive(() => {
    const id = current.val;
    paneShown.val = id !== null && panes.val.some((st) => st.id === id);
  });
  // Esc goes back to the terminal, after CodeMirror's own Esc (closing search).
  paneEl.addEventListener('keydown', (e) => {
    const st = currentState();
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

const TextButton = (label: string, onclick: () => void) =>
  button({ type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', title: label, onclick }, label);

// `icon` is a binding: it may follow states.
const IconButton = (icon: () => Node, label: string | (() => string), onclick: () => void, disabled = () => false) =>
  button(
    {
      type: 'button',
      class: 'btn',
      'data-variant': 'ghost',
      'data-size': 'icon-sm',
      title: label,
      'aria-label': label,
      disabled,
      onclick,
    },
    icon,
  );

// The Edit/Preview toggle shows what pressing it does.
function EditToggle(st: PaneState): HTMLElement {
  const mod = isMac ? '⌘' : 'Ctrl-';
  return IconButton(
    () => (st.editing.val ? icons.preview : icons.edit)(),
    () => `${st.editing.val ? 'Preview' : 'Edit'} (${mod}E)`,
    () => toggleMode(st),
    () => !st.editable.val,
  );
}

// Shown while the preview has comments: pastes them into the tab's terminal.
function SendButton(st: PaneState): HTMLElement {
  const n = () => st.notes.comments.val.length;
  const label = () => `Send ${n()} comment${n() === 1 ? '' : 's'} to Claude`;
  return button(
    {
      type: 'button',
      class: 'btn pane-send',
      'data-variant': 'ghost',
      'data-size': 'icon-sm',
      title: label,
      'aria-label': label,
      hidden: () => n() === 0,
      onclick: () => st.notes.send(),
    },
    icons.send(),
  );
}

function PaneHead(st: PaneState): HTMLElement {
  return header(
    { class: () => (st.scrolled.val ? 'pane-head scrolled' : 'pane-head') },
    IconButton(icons.collapse, 'Close file', () => go({ file: null })),
    span({ class: 'pane-path', title: () => st.path.val.abs }, () => st.path.val.text),
    span({ class: 'pane-status', role: 'status' }, () => st.status.val),
    span({ class: 'pane-dot', title: 'Unsaved changes', hidden: () => !st.dirty.val }, '●'),
    SendButton(st),
    EditToggle(st),
  );
}

function ConflictBar(st: PaneState): HTMLElement {
  return div(
    { class: 'pane-bar', role: 'alert', hidden: () => st.conflict.val === null },
    span('Changed on disk. Your edits are unsaved.'),
    TextButton('Reload', () => void reload(st)),
    TextButton('Overwrite', () => void save(st, true)),
  );
}

function PaneView(st: PaneState): HTMLElement {
  const view = section(
    { class: 'pane-view', hidden: () => current.val !== st.id },
    PaneHead(st),
    () => st.body.val,
    ConflictBar(st),
    ...st.notes.pieces,
  );
  // Scroll doesn't bubble, so catch the editor's or body's on the way down.
  view.addEventListener(
    'scroll',
    (e) => {
      st.scrolled.val = (e.target as HTMLElement).scrollTop > 0;
    },
    true,
  );
  return view;
}

// A preview: `srcdoc` in a frame sandboxed by `sandbox`. The sandbox is set
// before the document, so the frame never loads without it.
function Frame(srcdoc: string, sandbox: string, title: string): HTMLIFrameElement {
  const frame = iframe({ class: 'pane-frame', title });
  frame.setAttribute('sandbox', sandbox);
  frame.srcdoc = srcdoc;
  return frame;
}

// An image or a PDF from a blob: URL. A raster image can't run scripts; a PDF
// gets the browser's own viewer.
function Blob(kind: 'image' | 'pdf', url: string, title: string): HTMLElement {
  return kind === 'pdf'
    ? iframe({ class: 'pane-frame', src: url, title })
    : img({ class: 'pane-img', src: url, alt: title });
}

function Msg(text: string): HTMLElement {
  return div({ class: 'pane-msg' }, p(text));
}

// Drops whatever the body shows, freeing the editor and any blob.
function clear(st: PaneState): void {
  st.notes.detach();
  st.editor?.destroy();
  st.editor = null;
  if (st.blobUrl) URL.revokeObjectURL(st.blobUrl);
  st.blobUrl = null;
  st.markdown = null;
  st.frame = null;
}

export function show(sessionId: string | null): void {
  current.val = sessionId;
  void poll();
}

export function forget(sessionId: string): void {
  seqs.set(sessionId, (seqs.get(sessionId) ?? 0) + 1);
  rememberFile(sessionId, null);
  const st = states.get(sessionId);
  if (!st) return;
  clear(st);
  st.notes.dispose();
  clearTimeout(st.timer);
  states.delete(sessionId);
  panes.val = [...states.values()];
}

const unsent = (st: PaneState) => st.notes.comments.val.length;

export function hasUnsaved(): boolean {
  for (const st of states.values()) if (st.dirty.val || unsent(st) > 0) return true;
  return false;
}

// Asks before unsaved edits or unsent comments are dropped.
export function confirmDiscard(sessionId: string): boolean {
  const st = states.get(sessionId);
  if (!st) return true;
  const n = unsent(st);
  if (!st.dirty.val && n === 0) return true;
  const name = (st.info?.path ?? st.requested).split('/').pop();
  const parts = [
    st.dirty.val ? `unsaved changes to ${name}` : '',
    n > 0 ? `${n} unsent comment${n === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return confirm(`Discard ${parts.join(' and ')}?`);
}

export function hasFile(sessionId: string): boolean {
  return states.has(sessionId);
}

// The absolute path the tab shows, once loaded.
export function fileOf(sessionId: string): string | null {
  return states.get(sessionId)?.info?.path ?? null;
}

// Unsaved edits or unsent comments: the router asks before they go.
export function isDirty(sessionId: string): boolean {
  const st = states.get(sessionId);
  return !!st && (st.dirty.val || unsent(st) > 0);
}

// A relative path is shown relative to the directory it was resolved from.
function shownPath(st: PaneState, abs: string): string {
  const rel = st.requested.replace(/^\.\//, '');
  if (rel.startsWith('/') || rel.startsWith('~') || !abs.endsWith('/' + rel)) return abs;
  return displayPath(abs, abs.slice(0, abs.length - rel.length));
}

function setStatus(st: PaneState, text: string, ms?: number): void {
  clearTimeout(st.timer);
  st.status.val = text;
  if (ms)
    st.timer = window.setTimeout(() => {
      st.status.val = '';
    }, ms);
}

function currentText(st: PaneState): string {
  return st.editor ? st.editor.text() : st.doc;
}

function toggleMode(st: PaneState): void {
  if (!st.editable.val || !st.info) return;
  const edit = !st.editing.val;
  if (st.info.kind === 'text') {
    st.editor?.setReadOnly(!edit);
    if (edit) st.editor?.view.focus();
    st.editing.val = edit;
    return;
  }
  if (st.editor) st.doc = st.editor.text();
  st.editing.val = edit;
  mountRich(st);
}

async function save(st: PaneState, overwrite = false): Promise<void> {
  const info = st.info;
  if (!info || !st.editable.val || st.saving) return;
  if (!overwrite && !st.dirty.val) return;
  const conflict = st.conflict.val;
  const version = overwrite && conflict !== null ? conflict : st.version;
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
    st.conflict.val = res.conflict;
    setStatus(st, '');
  } else if (res && !res.version) {
    // Written, but we can't tell the next save's base version.
    st.conflict.val = null;
    setStatus(st, "Saved, but the server didn't return a version; reload before saving again");
  } else if (res) {
    st.version = res.version;
    st.conflict.val = null;
    // Edits made while the save was in flight stay unsaved.
    if (currentText(st) === text) st.dirty.val = false;
    setStatus(st, 'Saved', 1500);
  } else {
    setStatus(st, error);
  }
}

// Re-reads the file, dropping the edits.
async function reload(st: PaneState, focus = true): Promise<void> {
  await load(st.id, st.info?.path ?? st.requested, { focus });
}

// Checks whether the shown file changed on disk. Without edits it's reloaded
// in place; with them the bar asks whether to reload or overwrite.
async function poll(): Promise<void> {
  const st = currentState();
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
  if (disk === null || disk === version || disk === st.conflict.val) return;
  if (st.dirty.val) st.conflict.val = disk;
  else await pull(st);
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
  if (st.epoch !== epoch || states.get(st.id) !== st || st.dirty.val || st.saving) return;
  const editable = info.content !== undefined && EDITABLE.has(info.kind);
  if (!editable || !st.editable.val || info.kind !== st.info!.kind) return reload(st, false);
  Object.assign(st, {
    info,
    version: info.version,
    eol: info.eol ?? 'lf',
    doc: fromDisk(info.content!),
  });
  st.conflict.val = null;
  if (st.editor) st.editor.setText(st.doc);
  else mountRich(st);
}

// A Markdown preview's look: the theme's colours, and the comments' highlight.
function previewCss(th: PaneTheme): string {
  return (
    `body{margin:0;padding:1rem 1.5rem;font:14px/1.6 system-ui,sans-serif;background:${th.background};color:${th.foreground}}` +
    `a{color:${th.cursor}}pre,code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}` +
    `pre{padding:.75rem;overflow:auto;background:color-mix(in srgb,${th.foreground} 8%,${th.background})}` +
    `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid color-mix(in srgb,${th.foreground} 20%,${th.background});padding:.25rem .5rem}` +
    // The preview scrolls inside its own frame, where the pane can't see it, so
    // it fades out under the header itself once scrolled (no script needed).
    `body::before{content:"";position:fixed;top:0;left:0;right:0;height:1rem;z-index:1;pointer-events:none;` +
    `background:linear-gradient(${th.background},transparent);opacity:0;` +
    `animation:fade linear both;animation-timeline:scroll(root);animation-range:0 1px}` +
    `@keyframes fade{to{opacity:1}}` +
    highlightCss(th.light, th.background)
  );
}

// A fresh random mark for a render: 32 hex digits.
const newMark = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// A Markdown preview's document. Its first tag after the charset is its own
// CSP: the one script that may run is tabsh's frame script, at its exact URL.
// The script takes this render's mark from its query (CSP ignores the query).
function markdownDoc(html: string, th: PaneTheme, mark: string): string {
  const url = new URL(frameScript, location.href);
  const policy = frameCsp(url.origin + url.pathname);
  url.searchParams.set('m', mark);
  return (
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">` +
    `<style id="tabsh-theme">${previewCss(th)}</style><script src="${url.href}"></script>${html}`
  );
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
      st.dirty.val = true;
      st.status.val = '';
    },
    onSave: () => void save(st),
    onCursor: (line) => reportLine(st, line),
  });
}

// The cursor's line goes in the place, by a replace, while this file is the
// place's; never in the middle of another move.
function reportLine(st: PaneState, line: number): void {
  const p = here();
  if (navigation.transition || current.val !== st.id || p.tab !== st.id) return;
  if (!st.info || p.file !== st.info.path || p.line === line) return;
  go({ line }, 'replace');
}

// Markdown, HTML and SVG: sandboxed preview of the current text, or its source in CodeMirror.
function mountRich(st: PaneState): void {
  const body = st.body.val,
    kind = st.info!.kind;
  const seq = ++st.previewSeq;
  st.editor?.destroy();
  st.editor = null;
  st.frame = null;
  st.markdown = null;
  st.notes.detach();
  body.replaceChildren();
  if (st.editing.val) {
    st.editor = newEditor(st, body, false);
    st.editor.view.focus();
    return;
  }
  const title = st.info!.path;
  const show = (srcdoc: string, sandbox: string) => {
    const frame = Frame(srcdoc, sandbox, title);
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
      .then(({ marked }) => {
        const mark = newMark();
        return { html: renderBlocks(marked, st.doc, mark), mark };
      })
      .then(
        ({ html, mark }) => {
          if (st.previewSeq !== seq || st.body.val !== body || st.editing.val) return;
          // Scripts, but only tabsh's frame script (its own CSP); an opaque
          // origin, away from the token.
          st.markdown = html;
          st.mark = mark;
          st.frame = show(markdownDoc(html, host.theme(), mark), 'allow-scripts');
          st.notes.attach(st.frame);
        },
        () => {
          if (st.previewSeq === seq) body.replaceChildren(Msg("Couldn't render the preview"));
        },
      );
  }
}

async function renderBody(st: PaneState, info: FileInfo, body: HTMLElement, isCurrent: () => boolean): Promise<void> {
  const tooLarge = () => Msg(`Too large to open here (${formatSize(info.size)})`);
  switch (info.kind) {
    case 'image':
    case 'pdf': {
      const url = await rawBlobUrl(host.fetch, info.path);
      if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return;
      }
      st.blobUrl = url;
      body.append(Blob(info.kind, url, info.path));
      return;
    }
    case 'binary':
      body.append(Msg(`Binary file, ${formatSize(info.size)}`));
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
      st.editor.goTo(st.line ?? 1);
      return;
    }
  }
}

// Shows `path` in the tab, or with null forgets its file, without asking
// about unsaved edits (the router's guard has). A file the tab already shows
// only moves to `line`. Resolves to the absolute path shown: null when the
// file couldn't be read, which with `quiet` is dropped quietly (else shown). A directory opens a new tab
// only with `dirTab` (a click, never a URL), and the tab keeps its file.
export async function showFile(
  sessionId: string,
  path: string | null,
  line: number | null,
  opts: { focus: boolean; signal: AbortSignal; dirTab?: boolean; quiet?: boolean },
): Promise<string | null> {
  if (path === null) {
    forget(sessionId);
    return null;
  }
  const st = states.get(sessionId);
  if (st?.info?.path === path) {
    if (line !== null && st.editor && st.editor.line() !== line) st.editor.goTo(line);
    return path;
  }
  const res = await load(sessionId, path, { ...opts, line: line ?? undefined });
  if (res === 'failed') forget(sessionId);
  return fileOf(sessionId);
}

let made = 0;
function newState(id: string, requested: string): PaneState {
  const notes = createNotes({
    path: () => st.path.val.text,
    paste: (text) => host.paste(id, text),
    status: (text) => setStatus(st, text),
  });
  const st: PaneState = {
    id,
    key: `${id}#${++made}`,
    path: van.state({ abs: requested, text: requested }),
    dirty: van.state(false),
    status: van.state(''),
    conflict: van.state<string | null>(null),
    editing: van.state(false),
    editable: van.state(false),
    scrolled: van.state(false),
    body: van.state(div({ class: 'pane-body' })),
    doc: '',
    version: '',
    eol: 'lf',
    saving: false,
    epoch: 0,
    previewSeq: 0,
    timer: undefined,
    info: null,
    requested,
    editor: null,
    blobUrl: null,
    markdown: null,
    frame: null,
    notes,
    mark: '',
  };
  return st;
}

// `focus` is false for a load nobody asked for, which mustn't take the
// keyboard. `quiet` drops a file that can't be read instead of showing why;
// `signal` drops a load whose navigation was overtaken.
async function load(
  sessionId: string,
  path: string,
  opts: { line?: number; focus?: boolean; quiet?: boolean; signal?: AbortSignal; dirTab?: boolean } = {},
): Promise<'shown' | 'failed' | 'dropped'> {
  const { line, focus = true, signal } = opts;
  const seq = (seqs.get(sessionId) ?? 0) + 1;
  seqs.set(sessionId, seq);
  let info: FileInfo | null = null;
  let error: string | null = null;
  try {
    info = await readFile(host.fetch, sessionId, path);
  } catch (err) {
    error = err instanceof FileError ? `${err.message}: ${path}` : `Couldn't reach tabsh: ${path}`;
  }
  if (seqs.get(sessionId) !== seq || signal?.aborted) return 'dropped';
  if (info?.kind === 'dir') {
    if (opts.dirTab) host.newTabAt(info.path);
    return 'dropped';
  }
  if (!info && opts.quiet) return 'failed';
  rememberFile(sessionId, info?.path ?? null);

  let st = states.get(sessionId);
  if (!st) {
    st = newState(sessionId, path);
    states.set(sessionId, st);
    panes.val = [...states.values()];
  }
  clear(st);
  clearTimeout(st.timer);
  st.epoch++;
  st.previewSeq++;
  const editable = !!info && info.content !== undefined && EDITABLE.has(info.kind);
  // Another file drops the comments (the router asked first); the same file
  // loaded again keeps them, to be found in its new preview.
  if (!info || st.info?.path !== info.path) st.notes.clear();
  Object.assign(st, {
    info,
    requested: path,
    line,
    saving: false,
    doc: editable ? fromDisk(info!.content!) : '',
    version: info?.version ?? '',
    eol: info?.eol ?? 'lf',
  });
  const abs = info?.path ?? path;
  st.path.val = { abs, text: info ? shownPath(st, abs) : abs };
  st.editable.val = editable;
  st.editing.val = false;
  st.dirty.val = false;
  st.conflict.val = null;
  st.status.val = '';
  st.scrolled.val = false;
  // The CodeMirror host, made once for this load.
  const body = div({ class: 'pane-body' });
  st.body.val = body;

  const state = st;
  const isCurrent = () => states.get(sessionId) === state && seqs.get(sessionId) === seq;
  // The view and the body are on the page once VanJS has applied the states:
  // CodeMirror mounts into (and focuses in) a pane that shows.
  await applied();
  if (!isCurrent()) return 'dropped';
  if (error || !info) {
    body.append(Msg(error ?? 'Not found'));
    return 'shown';
  }
  try {
    await renderBody(state, info, body, isCurrent);
    // So the keyboard (Cmd/Ctrl-E, -S) works at once; Esc goes back to the terminal.
    if (focus && isCurrent() && current.val === sessionId) {
      if (state.editor) state.editor.view.focus();
      else paneEl.focus();
    }
  } catch (err) {
    if (!isCurrent()) return 'dropped';
    const big = err instanceof FileError && err.status === 413;
    body.replaceChildren(
      big
        ? Msg(`Too large to open here (${formatSize(info.size)})`)
        : Msg(err instanceof FileError ? err.message : `Couldn't open ${info.path}`),
    );
  }
  return 'shown';
}

export function applyTheme(): void {
  const th = host.theme();
  for (const st of states.values()) {
    st.editor?.setTheme(th);
    // In place when the frame script is listening (the comments' highlights
    // stay), else by a new document.
    if (st.frame && st.markdown !== null && !st.notes.theme(previewCss(th))) {
      st.frame.srcdoc = markdownDoc(st.markdown, th, st.mark);
    }
  }
}
