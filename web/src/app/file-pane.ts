import {
  FileError, displayPath, editorUrl, formatSize, fromDisk, rawBlobUrl, readFile, type Fetcher, type FileInfo,
} from './files.ts';
import { createEditor, type Editor } from './editor.ts';

export interface PaneTheme { background: string; foreground: string; cursor: string; selectionBackground: string; light: boolean }
export interface Host {
  fetch: Fetcher;
  theme(): PaneTheme;
  editor(): 'vscode' | 'cursor' | 'zed';
  layout(): void;                                  // refit the active terminal (sendSize(active))
  newTabAt(cwd: string): void;                     // POST /api/sessions {cwd} then activate
  focusTerminal(): void;
}

interface PaneState {
  view: HTMLElement;          // this session's header and body, inside #pane
  info: FileInfo | null;
  requested: string;
  line?: number;
  col?: number;
  editor: Editor | null;
  blobUrl: string | null;
  markdown: string | null;    // rendered HTML, re-wrapped when the theme changes
  frame: HTMLIFrameElement | null;
}

let host: Host;
let paneEl: HTMLElement;
let dividerEl: HTMLElement;
const states = new Map<string, PaneState>();
// Bumped by every open and forget, so a slow response to a superseded one is dropped.
const seqs = new Map<string, number>();
let current: string | null = null;

export function init(h: Host): void {
  host = h;
  paneEl = document.getElementById('pane')!;
  dividerEl = document.getElementById('pane-divider')!;
  paneEl.replaceChildren(); // drop a "couldn't load" message from an earlier attempt
  // Esc goes back to the terminal, after CodeMirror's own Esc (closing search).
  paneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) host.focusTerminal();
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

function button(label: string, onclick: () => void, title = label): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', textContent: label, title, onclick });
  b.dataset.variant = 'ghost';
  b.dataset.size = 'sm';
  return b;
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

function close(sessionId: string): void {
  forget(sessionId);
  host.focusTerminal();
}

function openInEditor(st: PaneState): void {
  if (st.info) location.href = editorUrl(host.editor(), st.info.path, st.line, st.col);
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
  const edit = button('Edit', () => {});
  edit.disabled = true;
  const ext = button('Open in editor', () => openInEditor(st));
  ext.disabled = !info;
  const x = button('✕', () => close(sessionId), 'Close file');
  x.setAttribute('aria-label', 'Close file');
  return el('header', { className: 'pane-head' }, path, dot, edit, ext, x);
}

function message(text: string, st?: PaneState): HTMLElement {
  const box = el('div', { className: 'pane-msg' }, el('p', { textContent: text }));
  if (st) box.append(button('Open in editor', () => openInEditor(st)));
  return box;
}

function markdownDoc(html: string, th: PaneTheme): string {
  const style = `body{margin:0;padding:1rem 1.5rem;font:14px/1.6 system-ui,sans-serif;background:${th.background};color:${th.foreground}}` +
    `a{color:${th.cursor}}pre,code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}` +
    `pre{padding:.75rem;overflow:auto;background:color-mix(in srgb,${th.foreground} 8%,${th.background})}` +
    `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid color-mix(in srgb,${th.foreground} 20%,${th.background});padding:.25rem .5rem}`;
  return `<!doctype html><meta charset="utf-8"><style>${style}</style>${html}`;
}

function svgDoc(svg: string): string {
  return '<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}' +
    'body{display:grid;place-items:center}svg{max-width:100%;max-height:100%}</style>' + svg;
}

async function renderBody(st: PaneState, info: FileInfo, body: HTMLElement, isCurrent: () => boolean): Promise<void> {
  const tooLarge = () => message(`Too large to open here (${formatSize(info.size)})`, st);
  switch (info.kind) {
    case 'image': case 'pdf': {
      const url = await rawBlobUrl(host.fetch, info.path);
      if (!isCurrent()) { URL.revokeObjectURL(url); return; }
      st.blobUrl = url;
      // A raster image can't run scripts; a PDF gets the browser's own viewer.
      body.append(info.kind === 'pdf'
        ? el('iframe', { className: 'pane-frame', src: url, title: info.path })
        : el('img', { className: 'pane-img', src: url, alt: info.path }));
      return;
    }
    case 'binary':
      body.append(message(`Binary file, ${formatSize(info.size)}`));
      return;
    case 'html': {
      if (info.content === undefined) { body.append(tooLarge()); return; }
      // No allow-same-origin: the page gets an opaque origin, away from the token.
      const frame = el('iframe', { className: 'pane-frame', srcdoc: info.content, title: info.path });
      frame.setAttribute('sandbox', 'allow-scripts allow-popups');
      body.append(frame);
      return;
    }
    case 'svg': {
      if (info.content === undefined) { body.append(tooLarge()); return; }
      // Not a blob: an image/svg+xml blob URL has the app's origin, and opened
      // as a page it could run script there. An empty sandbox can't.
      const frame = el('iframe', { className: 'pane-frame', srcdoc: svgDoc(info.content), title: info.path });
      frame.setAttribute('sandbox', '');
      body.append(frame);
      return;
    }
    case 'markdown': {
      if (info.content === undefined) { body.append(tooLarge()); return; }
      const { marked } = await import('marked');
      const html = await marked.parse(info.content);
      if (!isCurrent()) return;
      // An empty sandbox: no scripts, an opaque origin.
      const frame = el('iframe', { className: 'pane-frame', srcdoc: markdownDoc(html, host.theme()), title: info.path });
      frame.setAttribute('sandbox', '');
      st.markdown = html;
      st.frame = frame;
      body.append(frame);
      return;
    }
    case 'text': {
      if (info.content === undefined) { body.append(tooLarge()); return; }
      st.editor = createEditor(body, {
        doc: fromDisk(info.content), path: info.path, readOnly: true, theme: host.theme(),
        onChange: () => {}, onSave: () => {},
      });
      st.editor.goTo(st.line ?? 1, st.col);
      return;
    }
  }
}

export async function openPath(sessionId: string, path: string, line?: number, col?: number): Promise<void> {
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
  if (info?.kind === 'dir') { host.newTabAt(info.path); return; }

  let st = states.get(sessionId);
  if (!st) {
    st = { view: el('section', { className: 'pane-view' }), info: null, requested: path, editor: null, blobUrl: null,
      markdown: null, frame: null };
    states.set(sessionId, st);
    paneEl.append(st.view);
  }
  clear(st);
  Object.assign(st, { info, requested: path, line, col });
  const body = el('div', { className: 'pane-body' });
  st.view.replaceChildren(header(sessionId, st, info), body);
  refresh();

  const state = st;
  const isCurrent = () => states.get(sessionId) === state && seqs.get(sessionId) === seq;
  if (error || !info) { body.append(message(error ?? 'Not found')); return; }
  try {
    await renderBody(state, info, body, isCurrent);
  } catch (err) {
    if (!isCurrent()) return;
    const big = err instanceof FileError && err.status === 413;
    body.replaceChildren(big ? message(`Too large to open here (${formatSize(info.size)})`, state)
      : message(err instanceof FileError ? err.message : `Couldn't open ${info.path}`));
  }
}

export function applyTheme(): void {
  const th = host.theme();
  for (const st of states.values()) {
    st.editor?.setTheme(th);
    if (st.frame && st.markdown !== null) st.frame.srcdoc = markdownDoc(st.markdown, th);
  }
}
