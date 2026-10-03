import {
  defaultHighlightStyle,
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorSelection, EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import type { PaneTheme } from './file-pane.ts';

export interface Editor {
  view: EditorView;
  setReadOnly(ro: boolean): void;
  setTheme(t: PaneTheme): void;
  goTo(line: number, col?: number): void;
  text(): string;
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
        '&': { color: th.foreground, backgroundColor: th.background, height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Monaco, monospace' },
        '.cm-content': { caretColor: th.cursor },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: th.cursor },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
          { backgroundColor: th.selectionBackground },
        '.cm-gutters': { backgroundColor: th.background, color: muted, border: 'none' },
        '.cm-activeLine, .cm-activeLineGutter': {
          backgroundColor: `color-mix(in srgb, ${th.foreground} 6%, transparent)`,
        },
        '.cm-goto-line': { backgroundColor: `color-mix(in srgb, ${th.cursor} 22%, transparent)` },
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

export function createEditor(
  parent: HTMLElement,
  opts: {
    doc: string;
    path: string;
    readOnly: boolean;
    theme: PaneTheme;
    onChange(): void;
    onSave(): void;
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
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange();
        }),
      ],
    }),
  });
  let destroyed = false;
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
    text: () => view.state.doc.toString(),
    destroy() {
      destroyed = true;
      view.destroy();
    },
  };
}
