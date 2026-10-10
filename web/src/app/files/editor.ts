import {
  defaultHighlightStyle,
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  Annotation,
  type ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Text,
  Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { type Comment, mapComments } from './comments.ts';
import type { PaneTheme } from './pane.ts';

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// A non-empty selection that has rested, in source offsets.
export interface RestedSelection {
  from: number;
  to: number;
  quote: string;
  fromLine: number;
  toLine: number;
}

export interface CommentHover {
  id: number;
  rect: Rect;
}

export interface Editor {
  view: EditorView;
  setReadOnly(ro: boolean): void;
  setTheme(t: PaneTheme): void;
  goTo(line: number, col?: number): void;
  reveal(from: number, to: number): void; // select that range and scroll it into view
  line(): number; // the cursor's
  text(): string;
  setText(text: string): void; // the file changed on disk; not an edit
  setComments(comments: readonly Comment[]): void;
  rangeRect(from: number, to: number): Rect | null;
  destroy(): void;
}

const legacy = (load: () => Promise<StreamParser<unknown>>) => async () => StreamLanguage.define(await load());
const js = (typescript: boolean) => async () =>
  (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript });

// Each language is fetched the first time a file of that kind is opened.
const LANGS: Record<string, () => Promise<Extension>> = {
  js: js(false),
  mjs: js(false),
  cjs: js(false),
  jsx: js(false),
  ts: js(true),
  mts: js(true),
  cts: js(true),
  tsx: js(true),
  rs: async () => (await import('@codemirror/lang-rust')).rust(),
  py: async () => (await import('@codemirror/lang-python')).python(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  yml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  htm: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  md: async () => (await import('@codemirror/lang-markdown')).markdown(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  toml: legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml),
  sh: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  bash: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  zsh: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
};

function languageFor(path: string): (() => Promise<Extension>) | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  // Dotfiles like .zshrc have no extension; treat the rc files as shell.
  if (/^\.(bash|zsh)(rc|_profile|env)$|^\.profile$/.test(name)) return LANGS.sh;
  return dot > 0 ? LANGS[name.slice(dot + 1)] : undefined;
}

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#c678dd' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.comment, t.meta], color: '#7f848e', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d19a66' },
  { tag: [t.typeName, t.className, t.namespace], color: '#e5c07b' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#61afef' },
  { tag: [t.propertyName, t.attributeName], color: '#e06c75' },
  { tag: [t.tagName, t.heading], color: '#e06c75', fontWeight: 'bold' },
  { tag: t.link, color: '#56b6c2', textDecoration: 'underline' },
  { tag: t.invalid, color: '#ff5555' },
]);

function themeExtension(th: PaneTheme): Extension {
  const muted = `color-mix(in srgb, ${th.foreground} 45%, ${th.background})`;
  return [
    EditorView.theme(
      {
        '&': { color: th.foreground, backgroundColor: th.background, height: '100%', fontSize: `${th.fontSize}px` },
        '.cm-scroller': { fontFamily: th.fontFamily },
        '.cm-content': { caretColor: th.cursor },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: th.cursor },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
          { backgroundColor: th.selectionBackground },
        '.cm-gutters': { backgroundColor: th.background, color: muted, border: 'none' },
        '.cm-activeLine, .cm-activeLineGutter': {
          backgroundColor: `color-mix(in srgb, ${th.foreground} 6%, transparent)`,
        },
        '.cm-goto-line': { backgroundColor: `color-mix(in srgb, ${th.cursor} 22%, transparent)` },
        '.cm-comment': {
          backgroundColor: th.light
            ? 'oklch(0.93 0.08 85)'
            : `color-mix(in oklab, oklch(0.8 0.15 75) 30%, ${th.background})`,
          textDecorationLine: 'underline',
          textDecorationThickness: '2px',
          textDecorationColor: th.light ? 'oklch(0.72 0.16 70)' : 'oklch(0.8 0.15 75)',
          textUnderlineOffset: '3px',
        },
      },
      { dark: !th.light },
    ),
    syntaxHighlighting(th.light ? defaultHighlightStyle : darkHighlight),
  ];
}

// The line a link pointed at stays highlighted until another goTo.
const setGoto = StateEffect.define<number | null>();
const gotoLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setGoto)) {
        deco =
          e.value === null
            ? Decoration.none
            : Decoration.set([Decoration.line({ class: 'cm-goto-line' }).range(e.value)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Marks a change that came from disk, so it doesn't count as an edit.
const fromDisk = Annotation.define<boolean>();

const REST_MS = 150; // a selection reports once it rests, not on every move

const setCommentList = StateEffect.define<readonly Comment[]>();
const commentField = StateField.define<readonly Comment[]>({
  create: () => [],
  update(list, tr) {
    for (const e of tr.effects) if (e.is(setCommentList)) return e.value;
    if (!tr.docChanged) return list;
    return mapComments(tr.startState.doc, tr.changes, list);
  },
  provide: (f) => EditorView.decorations.compute([f], (state) => commentMarks(state.field(f))),
});

// One amber mark per stretch of commented text. Overlapping comments share a
// mark; which comment a point is in comes from the list, not the decoration.
function commentMarks(comments: readonly Comment[]): DecorationSet {
  const live = comments.filter((c) => !c.lost && c.from < c.to).sort((a, b) => a.from - b.from || a.to - b.to);
  const ranges: { from: number; to: number }[] = [];
  for (const c of live) {
    const last = ranges[ranges.length - 1];
    if (last && c.from <= last.to) last.to = Math.max(last.to, c.to);
    else ranges.push({ from: c.from, to: c.to });
  }
  if (!ranges.length) return Decoration.none;
  return Decoration.set(ranges.map((r) => Decoration.mark({ class: 'cm-comment' }).range(r.from, r.to)));
}

function rangeRect(view: EditorView, from: number, to: number): Rect | null {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to, -1);
  if (!start) return null;
  const tail = end ?? start;
  return {
    top: Math.min(start.top, tail.top),
    bottom: Math.max(start.bottom, tail.bottom),
    left: Math.min(start.left, tail.left),
    right: Math.max(start.right, tail.right),
  };
}

export function createEditor(
  parent: HTMLElement,
  opts: {
    doc: string;
    path: string;
    readOnly: boolean;
    theme: PaneTheme;
    onChange(): void;
    onSave(): void;
    onCursor(line: number): void; // the user moved the cursor; at most every 300 ms
    onSelection(sel: RestedSelection | null): void; // a non-empty selection, once it rests
    onDoc(doc: Text, changes: ChangeSet, comments: readonly Comment[]): void; // comments after this edit
    onHover(hit: CommentHover | null): void;
    onScroll(): void;
  },
): Editor {
  const readOnly = new Compartment(),
    theme = new Compartment(),
    language = new Compartment();
  const ro = (on: boolean) => EditorState.readOnly.of(on);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              opts.onSave();
              return true;
            },
          },
        ]),
        basicSetup,
        readOnly.of(ro(opts.readOnly)),
        theme.of(themeExtension(opts.theme)),
        language.of([]),
        gotoLine,
        commentField,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            if (!u.transactions.some((tr) => tr.annotation(fromDisk))) opts.onChange();
            opts.onDoc(u.startState.doc, u.changes, u.state.field(commentField));
          }
          // Only the user's moves: a goTo or a change from disk carries no user event.
          if (u.selectionSet && u.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined)) {
            cursorMoved();
            selectionRested();
          }
        }),
      ],
    }),
  });
  let destroyed = false;
  let cursorTimer: number | undefined;
  let selTimer: number | undefined;
  let hoverId: number | null = null;
  const cursorLine = () => view.state.doc.lineAt(view.state.selection.main.head).number;
  // Reports the cursor's line at most every 300 ms, the last move included.
  function cursorMoved(): void {
    if (cursorTimer !== undefined) return;
    cursorTimer = window.setTimeout(() => {
      cursorTimer = undefined;
      if (!destroyed) opts.onCursor(cursorLine());
    }, 300);
  }
  // The Comment button follows a selection that has settled, not the caret.
  function selectionRested(): void {
    clearTimeout(selTimer);
    const current = view.state.selection.main;
    if (current.empty) {
      opts.onSelection(null);
      return;
    }
    selTimer = window.setTimeout(() => {
      selTimer = undefined;
      if (destroyed) return;
      const sel = view.state.selection.main;
      if (sel.empty) {
        opts.onSelection(null);
        return;
      }
      opts.onSelection({
        from: sel.from,
        to: sel.to,
        quote: view.state.doc.sliceString(sel.from, sel.to),
        fromLine: view.state.doc.lineAt(sel.from).number,
        toLine: view.state.doc.lineAt(Math.max(sel.from, sel.to - 1)).number,
      });
    }, REST_MS);
  }
  function hoverAt(x: number, y: number): void {
    const pos = view.posAtCoords({ x, y });
    const hit =
      pos == null ? undefined : view.state.field(commentField).find((c) => !c.lost && pos >= c.from && pos < c.to);
    const id = hit?.id ?? null;
    if (id === hoverId) return;
    hoverId = id;
    if (!hit) {
      opts.onHover(null);
      return;
    }
    const rect = rangeRect(view, hit.from, hit.to);
    opts.onHover(rect ? { id: hit.id, rect } : null);
  }
  view.dom.addEventListener('mousemove', (e) => hoverAt(e.clientX, e.clientY));
  view.dom.addEventListener('mouseleave', () => {
    hoverId = null;
    opts.onHover(null);
  });
  view.scrollDOM.addEventListener('scroll', () => {
    hoverId = null;
    opts.onScroll();
  });
  // The last pointer move can be dropped when the button comes up in the same
  // frame. The selection is already in the editor by the next frame.
  view.dom.addEventListener('pointerup', () => {
    requestAnimationFrame(() => {
      if (!destroyed && !view.state.selection.main.empty) selectionRested();
    });
  });
  const load = languageFor(opts.path);
  load?.().then(
    (ext) => {
      if (!destroyed) view.dispatch({ effects: language.reconfigure(ext) });
    },
    () => {},
  ); // plain text if the chunk can't be fetched

  return {
    view,
    setReadOnly: (on) => view.dispatch({ effects: readOnly.reconfigure(ro(on)) }),
    setTheme: (th) => view.dispatch({ effects: theme.reconfigure(themeExtension(th)) }),
    goTo(line, col) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const pos = Math.min(l.from + Math.max((col ?? 1) - 1, 0), l.to);
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: [setGoto.of(l.from), EditorView.scrollIntoView(pos, { y: 'center' })],
      });
    },
    reveal(from, to) {
      const doc = view.state.doc;
      const start = Math.max(0, Math.min(from, doc.length));
      const end = Math.max(start, Math.min(to, doc.length));
      const range = EditorSelection.range(start, end);
      view.dispatch({
        selection: range,
        effects: EditorView.scrollIntoView(range, { y: 'center' }),
      });
      view.focus();
    },
    line: cursorLine,
    text: () => view.state.doc.toString(),
    setComments(comments) {
      hoverId = null;
      view.dispatch({ effects: setCommentList.of(comments) });
    },
    rangeRect: (from, to) => rangeRect(view, from, to),
    setText(text) {
      // Replace only what differs, so the cursor and scroll stay put around it.
      const old = view.state.doc.toString();
      let from = 0;
      while (from < old.length && from < text.length && old[from] === text[from]) from++;
      let end = 0;
      while (
        end < old.length - from &&
        end < text.length - from &&
        old[old.length - 1 - end] === text[text.length - 1 - end]
      )
        end++;
      if (from === old.length && from === text.length) return;
      view.dispatch({
        changes: { from, to: old.length - end, insert: text.slice(from, text.length - end) },
        annotations: fromDisk.of(true),
      });
    },
    destroy() {
      destroyed = true;
      clearTimeout(cursorTimer);
      clearTimeout(selTimer);
      view.destroy();
    },
  };
}
