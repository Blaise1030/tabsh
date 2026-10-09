# Markdown Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a tab's Markdown preview, select passages, comment on them, and
paste the comments, with their line numbers, into that tab's Claude prompt.

**Architecture:**
- **The frame.** The Markdown preview becomes an `allow-scripts` frame,
  still opaque-origin. Its own CSP lets exactly one script run: tabsh's
  `preview-frame.ts`, built as its own asset. That script reports selections
  and hovers to the pane by `postMessage`, and draws highlights with the CSS
  Custom Highlight API.
- **The pane side.** `annotate.ts` holds each view's comments and draws the
  Comment button, the comment box and the hover card. Send pastes through a
  new `Host.paste`, which only pastes into a terminal in bracketed-paste
  mode.
- **Pure logic.** Line numbers, message text and message parsing live in
  `comments.ts` and `frame-protocol.ts`, unit-tested.

**Tech Stack:** TypeScript, VanJS 1.6, `marked` 18, Vite `?worker&url` (via
Astro 7), xterm 5.5, `node --test`, Playwright, Rust (axum) asset tests.

**Spec:** `docs/superpowers/specs/2026-10-09-markdown-comments-design.md`.
Read it before starting; this plan argues from it.

## Global Constraints

- **Existing CSS doesn't change.** `web/src/styles/app.css` gets one
  appended block for the new classes (`.pane-send`, `.comment-menu`,
  `.comment-box`, `.comment-hover` and their children). No existing rule is
  edited.
- **No markup strings.** There is no `innerHTML`, `outerHTML` or
  `insertAdjacentHTML` in `web/src/app` (`ui/no-markup.test.ts`). User text
  goes in as VanJS child strings or `textarea.value`.
- **The page CSP doesn't change.** `web/public/_headers` and `APP_CSP`
  (`src/web/pages.rs`) are untouched.
- **Sandboxes.**
  - Markdown frames are exactly `sandbox="allow-scripts"`.
  - SVG stays `sandbox=""`.
  - HTML stays `allow-scripts allow-popups`.
  - Never `allow-same-origin`.
- **The frame's CSP** is the first element after `<meta charset>`:
  `default-src 'none'; script-src <origin>/_astro/preview-frame-<hash>.js; style-src 'unsafe-inline'; img-src data: blob:`.
- **The highlight's colours:**
  - dark themes: `color-mix(in oklab, oklch(0.8 0.15 75) 30%, <background>)`,
    underlined `2px oklch(0.8 0.15 75)`;
  - light themes: `oklch(0.93 0.08 85)`, underlined `2px oklch(0.72 0.16 70)`;
  - both with `text-underline-offset: 3px`.
- **The message, exactly:**
  `Make these changes to <path as the header shows it> for me:` then one
  line per comment, `- line N, "<quote>": <note>` (or `lines N-M`). The
  quote is cut at 200 characters with `…`. Control, zero-width and bidi
  characters in the path, quote and note become spaces, and whitespace runs
  become one space.
- **Copy, exactly:**
  - the Comment button: `Comment`;
  - the box: placeholder `What should change?`, buttons `Cancel` and
    `Comment` (`Save` when editing);
  - Send's tooltip: `Send 1 comment to Claude` or `Send N comments to Claude`;
  - when Send refuses: `Not sent: this tab's terminal is closed` and
    `Not sent: the terminal isn't at a prompt that takes a paste safely`;
  - lost comments: `1 comment no longer matches the file` or
    `N comments no longer match the file`;
  - the discard prompt: `Discard 1 unsent comment?` or
    `Discard N unsent comments?`, or
    `Discard unsaved changes to <name> and N unsent comment(s)?` when both
    apply.
- **Send.** It pastes with xterm's `term.paste()`, only when
  `term.modes.bracketedPasteMode` is on. It never presses Enter.
- **The pane stays lazy.** The frame script is reached only by URL from the
  lazy pane chunk, and `entry_script_does_not_bundle_the_editor` keeps
  passing.
- **Commits.** Conventional commits, each ending with the line
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  After `npm run build`, commit `src/app.html` and `src/app-assets/` as
  `chore(app): rebuild the embedded app`.
- **Before any e2e run,** from the repo root:
  `cd web && npm run build && cd .. && cargo build --locked`. The e2e
  daemon serves the embedded copy of the app.

## Review Focus

1. **The same passage appearing twice, after Claude inserts lines above
   it.** The comment must stay on the occurrence you picked, not jump to the
   nearer twin. It's kept by occurrence number while the number of matches is
   unchanged; Task 5 has the e2e test.
2. **A selection right under the pane header, or near the pane's right
   edge.** The Comment button goes below when there's no room above, and
   stays inside the pane. Task 4 has the e2e test.
3. **Selecting the whole document.** The frame caps the quote at 2000
   characters, and the pasted quote is cut at 200 characters with `…`.
   Task 1 has the unit test and Task 4 the e2e test.
4. **A path or quote containing control characters** (a newline in a file
   name, an ESC in the text). The message stays one line per comment, and a
   paste can't end early. Task 1 has the unit tests and Task 4 an e2e test
   at a real shell prompt.
5. **Comments in two tabs at once.** Each tab keeps its own, and Send pastes
   only into its own terminal. Task 5 has the e2e test.

---

### Task 1: Pure comment logic (`files/comments.ts`)

**Files:**
- Create: `web/src/app/files/comments.ts`
- Test: `web/src/app/files/comments.test.ts`

**Interfaces:**
- Consumes: `marked` types (`Token`, `TokensList`).
- Produces:
  - `interface Comment { id: number; quote: string; from: number; to: number; nth: number; of: number; note: string; lost: boolean }`
  - `interface MarkedLike { lexer(src: string): TokensList; parser(tokens: Token[]): string }`
  - `renderBlocks(m: MarkedLike, src: string, mark: string): string`
  - `oneLine(s: string, max: number): string`
  - `linesLabel(c: { from: number; to: number }): string`, giving `line 3` or `lines 5-6`
  - `shortLines(c: { from: number; to: number }): string`, giving `L3` or `L5-6`
  - `commentMessage(path: string, comments: readonly Comment[]): string`
  - `frameCsp(scriptUrl: string): string`
  - `highlightCss(light: boolean, background: string): string`
  - `QUOTE_MAX = 200`

- [ ] **Step 1: Write the failing tests**

`web/src/app/files/comments.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marked } from 'marked';
import {
  type Comment,
  commentMessage,
  frameCsp,
  highlightCss,
  linesLabel,
  oneLine,
  renderBlocks,
  shortLines,
} from './comments.ts';

const MARK = '0123456789abcdef0123456789abcdef';

// Each block's [from, to] in the rendered output, in order.
function ranges(html: string): [number, number][] {
  return [...html.matchAll(/data-from="(\d+)" data-to="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const comment = (c: Partial<Comment>): Comment => ({
  id: 1,
  quote: 'q',
  from: 1,
  to: 1,
  nth: 0,
  of: 1,
  note: 'n',
  lost: false,
  ...c,
});

test('blocks carry their source lines', () => {
  const src = '# Title\n\nFirst para.\n\nSecond para\nspans two.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n';
  assert.deepEqual(ranges(renderBlocks(marked, src, MARK)), [
    [1, 1],
    [3, 3],
    [5, 6],
    [8, 9],
    [11, 13],
  ]);
});

test('fenced code, raw html and leading blank lines count their lines', () => {
  const src = '\n\n```js\na\n\nb\n```\n\n<div>raw\n\nhtml</div>\n\nend\n';
  assert.deepEqual(ranges(renderBlocks(marked, src, MARK)), [
    [3, 7],
    [9, 11],
    [13, 13],
  ]);
});

test('every block carries the mark; blank lines and link definitions render nothing', () => {
  const html = renderBlocks(marked, 'see [it]\n\n[it]: https://example.com\n', MARK);
  assert.equal(html.match(/data-tabsh-block="/g)?.length, 1);
  assert.ok(html.includes(`data-tabsh-block="${MARK}"`));
  assert.ok(html.includes('href="https://example.com"'), 'a reference link still resolves');
});

test('a mark that is not long hex is refused', () => {
  assert.throws(() => renderBlocks(marked, 'x', 'abc'));
  assert.throws(() => renderBlocks(marked, 'x', `${MARK}" onclick="x`));
});

test('oneLine makes control, zero-width and bidi characters spaces, and collapses whitespace', () => {
  assert.equal(oneLine('a\u001b[201~b', 100), 'a [201~b');
  assert.equal(oneLine('a\u0000b\u007fc\u0085d', 100), 'a b c d');
  assert.equal(oneLine('x​y‮z⁦w﻿v', 100), 'x y z w v');
  assert.equal(oneLine('  one\n\n two\tthree  ', 100), 'one two three');
});

test('oneLine cuts at max characters with an ellipsis', () => {
  assert.equal(oneLine('abcdef', 6), 'abcdef');
  assert.equal(oneLine('abcdefg', 6), 'abcde…');
  assert.equal(oneLine('x'.repeat(10_000), 200).length, 200);
  // A character outside the BMP counts once and is never split.
  assert.equal(oneLine('😀😀😀', 2), '😀…');
});

test('line labels', () => {
  assert.equal(linesLabel({ from: 3, to: 3 }), 'line 3');
  assert.equal(linesLabel({ from: 5, to: 6 }), 'lines 5-6');
  assert.equal(shortLines({ from: 3, to: 3 }), 'L3');
  assert.equal(shortLines({ from: 5, to: 6 }), 'L5-6');
});

test('the message: one instruction, then one line per comment', () => {
  const text = commentMessage('docs/plan.md', [
    comment({ quote: 'tabsh has two parts:', from: 3, to: 3, note: 'Make this a full sentence.' }),
    comment({ id: 2, quote: 'The daemon\nalso embeds', from: 7, to: 8, note: 'Say why,\nin one clause.' }),
  ]);
  assert.equal(
    text,
    'Make these changes to docs/plan.md for me:\n' +
      '- line 3, "tabsh has two parts:": Make this a full sentence.\n' +
      '- lines 7-8, "The daemon also embeds": Say why, in one clause.',
  );
});

test('the message cuts long quotes and cleans the path', () => {
  const text = commentMessage('a\nb\u001b.md', [comment({ quote: 'q'.repeat(500) })]);
  const [first, second] = text.split('\n');
  assert.equal(first, 'Make these changes to a b .md for me:');
  assert.equal(second, `- line 1, "${'q'.repeat(199)}…": n`);
  assert.equal(text.split('\n').length, 2);
});

test('the frame CSP allows exactly the one script', () => {
  assert.equal(
    frameCsp('http://127.0.0.1:7812/_astro/preview-frame-abc.js'),
    "default-src 'none'; script-src http://127.0.0.1:7812/_astro/preview-frame-abc.js; style-src 'unsafe-inline'; img-src data: blob:",
  );
});

test('the highlight is amber, tuned for light and dark', () => {
  assert.equal(
    highlightCss(false, '#0a0a0a'),
    '::highlight(tabsh-comment){background-color:color-mix(in oklab, oklch(0.8 0.15 75) 30%, #0a0a0a);' +
      'text-decoration:underline 2px oklch(0.8 0.15 75);text-underline-offset:3px}',
  );
  assert.equal(
    highlightCss(true, '#ffffff'),
    '::highlight(tabsh-comment){background-color:oklch(0.93 0.08 85);' +
      'text-decoration:underline 2px oklch(0.72 0.16 70);text-underline-offset:3px}',
  );
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && node --test src/app/files/comments.test.ts`
Expected: FAIL, `Cannot find module './comments.ts'`.

- [ ] **Step 3: Write `comments.ts`**

`web/src/app/files/comments.ts`:

```ts
// Comments on a Markdown preview, without the DOM (node --test loads this):
// each rendered block's source lines, the preview frame's policy and
// highlight, and the message Send pastes into the tab's terminal.
import type { Token, TokensList } from 'marked';

export interface Comment {
  id: number;
  quote: string; // the selected text, as the frame reported it
  from: number; // the first source line of the block the selection starts in
  to: number; // the last source line of the block it ends in
  nth: number; // which match of the quote it was, when made (-1: unknown)
  of: number; // how many matches the quote had then
  note: string;
  lost: boolean; // not found again after the preview was re-rendered
}

// What renderBlocks needs from `marked`: pane.ts passes the module it imports lazily.
export interface MarkedLike {
  lexer(src: string): TokensList;
  parser(tokens: Token[]): string;
}

const newlines = (s: string) => s.split('\n').length - 1;

// The Markdown rendered block by block, each top-level block in a <div>
// carrying its source lines. `mark` is this render's random mark: the frame
// script trusts only blocks carrying it, so a <div data-from> written in the
// Markdown can't pass for one. Blank lines and link definitions render nothing.
export function renderBlocks(m: MarkedLike, src: string, mark: string): string {
  if (!/^[0-9a-f]{32}$/.test(mark)) throw new Error('renderBlocks: the mark must be 32 hex digits');
  let line = 1;
  let out = '';
  for (const t of m.lexer(src)) {
    const to = line + newlines(t.raw.replace(/\n+$/, ''));
    if (t.type !== 'space' && t.type !== 'def') {
      out += `<div data-tabsh-block="${mark}" data-from="${line}" data-to="${to}">${m.parser([t])}</div>`;
    }
    line += newlines(t.raw);
  }
  return out;
}

// Characters that must not reach the terminal: C0 and C1 controls and DEL
// (an ESC could end a bracketed paste early, ESC [201~, and have the shell
// run the rest), and the zero-width and bidi controls that make text read
// differently from what it is.
function hidden(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

// `s` on one line and safe to paste: hidden characters become spaces,
// whitespace runs one space, and past `max` characters it's cut with "…".
export function oneLine(s: string, max: number): string {
  const text = Array.from(s, (c) => (hidden(c.codePointAt(0)!) ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

export const QUOTE_MAX = 200;
const NOTE_MAX = 2000;
const PATH_MAX = 1000;

export const linesLabel = (c: { from: number; to: number }): string =>
  c.from === c.to ? `line ${c.from}` : `lines ${c.from}-${c.to}`;

export const shortLines = (c: { from: number; to: number }): string =>
  c.from === c.to ? `L${c.from}` : `L${c.from}-${c.to}`;

// What Send pastes: one instruction, then one line per comment, in the order they were made.
export function commentMessage(path: string, comments: readonly Comment[]): string {
  return [
    `Make these changes to ${oneLine(path, PATH_MAX)} for me:`,
    ...comments.map((c) => `- ${linesLabel(c)}, "${oneLine(c.quote, QUOTE_MAX)}": ${oneLine(c.note, NOTE_MAX)}`),
  ].join('\n');
}

// The preview frame's own policy, the first thing in its document: tabsh's
// frame script, at exactly `scriptUrl`, is the one script that may run. (The
// page's policy, which the frame inherits too, already forbids inline script.)
export function frameCsp(scriptUrl: string): string {
  return `default-src 'none'; script-src ${scriptUrl}; style-src 'unsafe-inline'; img-src data: blob:`;
}

// A comment's highlight: one amber in every theme, like a marker pen, lighter
// or darker to suit it, and never the theme's selection colour.
export function highlightCss(light: boolean, background: string): string {
  const amber = light ? 'oklch(0.72 0.16 70)' : 'oklch(0.8 0.15 75)';
  const tint = light ? 'oklch(0.93 0.08 85)' : `color-mix(in oklab, ${amber} 30%, ${background})`;
  return `::highlight(tabsh-comment){background-color:${tint};text-decoration:underline 2px ${amber};text-underline-offset:3px}`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && node --test src/app/files/comments.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Lint, type-check, commit**

Run: `cd web && npm run lint && npm run check`
Expected: both clean.

```bash
git add web/src/app/files/comments.ts web/src/app/files/comments.test.ts
git commit -m "feat(pane): line ranges and the paste message for Markdown comments

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The frame message protocol (`files/frame-protocol.ts`)

**Files:**
- Create: `web/src/app/files/frame-protocol.ts`
- Test: `web/src/app/files/frame-protocol.test.ts`

**Interfaces:**
- Produces:
  - `MAX_QUOTE = 2000`
  - `interface Rect { top; bottom; left; right: number }`
  - `type FromFrame` (`ready`, `select {sel, quote, from, to, nth, of, rect}`,
    `clear`, `hover {id, rect}`, `unhover`, `scroll`, `located {id, from, to}`,
    `lost {id}`)
  - `type ToFrame` (`keep {id, sel}`, `drop {id}`, `dropAll`,
    `locate {id, quote, from, nth, of}`, `theme {css}`)
  - `parseFromFrame(data: unknown): FromFrame | null`
  - `parseToFrame(data: unknown): ToFrame | null`

- [ ] **Step 1: Write the failing tests**

`web/src/app/files/frame-protocol.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_QUOTE, parseFromFrame, parseToFrame } from './frame-protocol.ts';

const rect = { top: 1, bottom: 2, left: 3, right: 4 };
const select = { type: 'select', sel: 1, quote: 'hi', from: 2, to: 3, nth: 0, of: 1, rect };

test('well-formed messages from the frame pass, rebuilt with only their fields', () => {
  assert.deepEqual(parseFromFrame({ type: 'ready', extra: 1 }), { type: 'ready' });
  assert.deepEqual(parseFromFrame({ ...select, extra: 'x' }), select);
  assert.deepEqual(parseFromFrame({ type: 'hover', id: 4, rect }), { type: 'hover', id: 4, rect });
  assert.deepEqual(parseFromFrame({ type: 'located', id: 4, from: 5, to: 5 }), {
    type: 'located',
    id: 4,
    from: 5,
    to: 5,
  });
  assert.deepEqual(parseFromFrame({ type: 'lost', id: 4 }), { type: 'lost', id: 4 });
  for (const type of ['clear', 'unhover', 'scroll']) assert.deepEqual(parseFromFrame({ type }), { type });
  assert.deepEqual(parseFromFrame({ ...select, nth: -1 }), { ...select, nth: -1 });
});

test('malformed messages from the frame are dropped', () => {
  for (const bad of [
    null,
    'select',
    [],
    { type: 'nope' },
    { ...select, quote: '   ' },
    { ...select, quote: 'x'.repeat(MAX_QUOTE + 1) },
    { ...select, quote: 3 },
    { ...select, from: 0 },
    { ...select, from: 4, to: 3 },
    { ...select, from: 1.5 },
    { ...select, sel: 0 },
    { ...select, nth: -2 },
    { ...select, of: -1 },
    { ...select, rect: { ...rect, top: Number.NaN } },
    { ...select, rect: { ...rect, left: '3' } },
    { ...select, rect: null },
    { type: 'hover', id: 0, rect },
    { type: 'hover', id: 1 },
    { type: 'located', id: 1, from: 3, to: 2 },
    { type: 'lost', id: '1' },
  ]) {
    assert.equal(parseFromFrame(bad), null, JSON.stringify(bad));
  }
});

test('well-formed messages to the frame pass', () => {
  assert.deepEqual(parseToFrame({ type: 'keep', id: 1, sel: 2 }), { type: 'keep', id: 1, sel: 2 });
  assert.deepEqual(parseToFrame({ type: 'drop', id: 1 }), { type: 'drop', id: 1 });
  assert.deepEqual(parseToFrame({ type: 'dropAll' }), { type: 'dropAll' });
  const locate = { type: 'locate', id: 1, quote: 'q', from: 3, nth: 1, of: 2 };
  assert.deepEqual(parseToFrame(locate), locate);
  assert.deepEqual(parseToFrame({ type: 'theme', css: 'body{}' }), { type: 'theme', css: 'body{}' });
});

test('malformed messages to the frame are dropped', () => {
  for (const bad of [
    undefined,
    { type: 'keep', id: 1 },
    { type: 'keep', id: -1, sel: 1 },
    { type: 'drop', id: Number.POSITIVE_INFINITY },
    { type: 'locate', id: 1, quote: '', from: 3, nth: 0, of: 1 },
    { type: 'locate', id: 1, quote: 'q', from: 3, nth: 0 },
    { type: 'theme', css: 4 },
    { type: 'theme', css: 'x'.repeat(20_001) },
  ]) {
    assert.equal(parseToFrame(bad), null, JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && node --test src/app/files/frame-protocol.test.ts`
Expected: FAIL, `Cannot find module './frame-protocol.ts'`.

- [ ] **Step 3: Write `frame-protocol.ts`**

`web/src/app/files/frame-protocol.ts`:

```ts
// The messages between the pane (annotate.ts) and a Markdown preview's frame
// script (preview-frame.ts). Each side parses what it receives with these,
// rebuilding it from the fields it expects, and drops anything else. No DOM:
// node --test loads this.

export const MAX_QUOTE = 2000; // the frame cuts a selection's text here
const MAX_CSS = 20_000;

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type FromFrame =
  | { type: 'ready' }
  | { type: 'select'; sel: number; quote: string; from: number; to: number; nth: number; of: number; rect: Rect }
  | { type: 'clear' }
  | { type: 'hover'; id: number; rect: Rect }
  | { type: 'unhover' }
  | { type: 'scroll' }
  | { type: 'located'; id: number; from: number; to: number }
  | { type: 'lost'; id: number };

export type ToFrame =
  | { type: 'keep'; id: number; sel: number }
  | { type: 'drop'; id: number }
  | { type: 'dropAll' }
  | { type: 'locate'; id: number; quote: string; from: number; nth: number; of: number }
  | { type: 'theme'; css: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isQuote = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_QUOTE;

function rect(v: unknown): Rect | null {
  if (!isObj(v) || !isNum(v.top) || !isNum(v.bottom) || !isNum(v.left) || !isNum(v.right)) return null;
  return { top: v.top, bottom: v.bottom, left: v.left, right: v.right };
}

export function parseFromFrame(d: unknown): FromFrame | null {
  if (!isObj(d)) return null;
  switch (d.type) {
    case 'ready':
      return { type: 'ready' };
    case 'clear':
      return { type: 'clear' };
    case 'unhover':
      return { type: 'unhover' };
    case 'scroll':
      return { type: 'scroll' };
    case 'select': {
      const r = rect(d.rect);
      if (!r || !isInt(d.sel, 1) || !isQuote(d.quote) || !isInt(d.from, 1) || !isInt(d.to, d.from)) return null;
      if (!isInt(d.nth, -1) || !isInt(d.of, 0)) return null;
      return { type: 'select', sel: d.sel, quote: d.quote, from: d.from, to: d.to, nth: d.nth, of: d.of, rect: r };
    }
    case 'hover': {
      const r = rect(d.rect);
      return r && isInt(d.id, 1) ? { type: 'hover', id: d.id, rect: r } : null;
    }
    case 'located':
      return isInt(d.id, 1) && isInt(d.from, 1) && isInt(d.to, d.from)
        ? { type: 'located', id: d.id, from: d.from, to: d.to }
        : null;
    case 'lost':
      return isInt(d.id, 1) ? { type: 'lost', id: d.id } : null;
    default:
      return null;
  }
}

export function parseToFrame(d: unknown): ToFrame | null {
  if (!isObj(d)) return null;
  switch (d.type) {
    case 'keep':
      return isInt(d.id, 1) && isInt(d.sel, 1) ? { type: 'keep', id: d.id, sel: d.sel } : null;
    case 'drop':
      return isInt(d.id, 1) ? { type: 'drop', id: d.id } : null;
    case 'dropAll':
      return { type: 'dropAll' };
    case 'locate':
      return isInt(d.id, 1) && isQuote(d.quote) && isInt(d.from, 1) && isInt(d.nth, -1) && isInt(d.of, 0)
        ? { type: 'locate', id: d.id, quote: d.quote, from: d.from, nth: d.nth, of: d.of }
        : null;
    case 'theme':
      return typeof d.css === 'string' && d.css.length <= MAX_CSS ? { type: 'theme', css: d.css } : null;
    default:
      return null;
  }
}
```

**Note on `isInt(d.to, d.from)`:** `d.from` is already checked to be an
integer at that point, but TypeScript may still type it as `unknown`. If
`npm run check` complains, write `isInt(d.to, d.from as number)`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && node --test src/app/files/frame-protocol.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint, type-check, commit**

Run: `cd web && npm run lint && npm run check`

```bash
git add web/src/app/files/frame-protocol.ts web/src/app/files/frame-protocol.test.ts
git commit -m "feat(pane): the checked messages between a Markdown preview and the pane

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The preview frame runs tabsh's script, and only it

This task lands the one security change by itself. Markdown renders block by
block into an `allow-scripts` frame with its own CSP and tabsh's frame
script. The frame script is written whole here. Task 4 uses its selection and
hover messages, and Task 5 uses its re-finding of quotes. `annotate.ts` starts
as the frame link only (ready and theme).

**Files:**
- Create: `web/src/app/files/preview-frame.ts`
- Create: `web/src/app/files/annotate.ts` (the frame link; Task 4 replaces it)
- Modify: `web/src/app/files/pane.ts`
- Modify: `web/e2e/fixture.ts` (move `pickTheme` here)
- Modify: `web/e2e/pane.spec.ts` (import `pickTheme`)
- Create: `web/e2e/comments.spec.ts`
- Modify: `src/web/pages.rs` (tests)
- Modify: `docs/architecture.md` (the security invariant)

**Interfaces:**
- Consumes: Task 1's `renderBlocks`, `frameCsp` and `highlightCss`. Task 2's
  `parseToFrame`, `parseFromFrame`, `MAX_QUOTE`, `FromFrame`, `ToFrame` and
  `Rect`.
- Produces:
  - `annotate.ts`:
    `interface NotesHost { path(): string; status(text: string): void }`,
    `interface Notes { comments: State<readonly Comment[]>; pieces: HTMLElement[]; attach(frame: HTMLIFrameElement): void; detach(): void; theme(css: string): boolean; send(): void; clear(): void; dispose(): void }`
    and `createNotes(host: NotesHost): Notes`.
  - `PaneState` gains `notes: Notes` and `mark: string`.
  - The frame document carries `<style id="tabsh-theme">`.

- [ ] **Step 1: Share `pickTheme` between e2e specs**

In `web/e2e/pane.spec.ts`, delete the local `pickTheme` function and its
comment, and import it instead:

```ts
import { cdInTerminal, expect, openApp, pickTheme, test } from './fixture.ts';
```

Append it to `web/e2e/fixture.ts`, unchanged:

```ts
// Picks `name` from the palette's theme page.
export async function pickTheme(page: Page, name: string): Promise<void> {
  await page.locator('#settings-btn').click();
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
  await page.locator('#palette-input').fill('theme');
  await expect(page.locator('#palette-menu [role="menuitem"].active')).toHaveAttribute('data-filter', 'Theme…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /Search themes/);
  await page.locator('#palette-input').fill(name);
  await expect(page.locator('#palette-menu [role="menuitem"].active')).toHaveAttribute('data-filter', name);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#palette').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
}
```

- [ ] **Step 2: Write the failing e2e tests**

`web/e2e/comments.spec.ts`:

```ts
// Markdown comments, end to end: the preview's frame runs only tabsh's
// script; a comment pastes into the tab's terminal; comments outlive a
// re-render, and stay with their tab.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, openApp, pickTheme, test } from './fixture.ts';

const shown = (page: Page) => page.locator('#pane .pane-view:not([hidden])');
const preview = (page: Page) => shown(page).frameLocator('.pane-frame');

// Opens `name`, in `project`, from the explorer in the active tab.
async function openFile(page: Page, project: string, name: string): Promise<void> {
  await cdInTerminal(page, project, `in-${name}`);
  if ((await page.locator('#explorer-btn').getAttribute('aria-pressed')) !== 'true') {
    await page.locator('#explorer-btn').click();
  }
  await page.locator('#explorer').getByRole('treeitem', { name, exact: true }).click();
  await expect(shown(page).locator('.pane-head')).toContainText(name);
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);
}

test("a Markdown preview runs tabsh's frame script and nothing from the file", async ({ page, daemon, project }) => {
  writeFileSync(
    path.join(project, 'hostile.md'),
    [
      '# Hostile',
      '',
      'Plain text stays.',
      '',
      '<script>document.body.dataset.inline = "ran"</script>',
      '',
      '<script type="module">document.body.dataset.module = "ran"</script>',
      '',
      '<img src="x" onerror="document.body.dataset.handler = \'ran\'">',
      '',
      '<script src="data:text/javascript,document.body.dataset.data=%22ran%22"></script>',
      '',
      '<meta http-equiv="refresh" content="0;url=data:text/html,moved">',
      '',
    ].join('\n'),
  );
  await openApp(page, daemon);
  await openFile(page, project, 'hostile.md');
  const frame = shown(page).locator('.pane-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute(
    'srcdoc',
    /^<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src http:\/\/[^/" ]+\/_astro\/preview-frame-[\w-]+\.js; style-src 'unsafe-inline'; img-src data: blob:">/,
  );
  // The refresh's 0 s and the handlers have had their chance.
  await page.waitForTimeout(1000);
  const body = preview(page).locator('body');
  await expect(body).toContainText('Plain text stays.');
  for (const name of ['inline', 'module', 'handler', 'data']) {
    expect(await body.getAttribute(`data-${name}`)).toBeNull();
  }
});

test('a theme change re-themes a Markdown preview in place', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'themed.md'), '# Themed\n\nSome text.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'themed.md');
  const frame = shown(page).locator('.pane-frame');
  const srcdoc = await frame.getAttribute('srcdoc');
  const style = preview(page).locator('#tabsh-theme');
  await pickTheme(page, 'Nord');
  const nord = await style.textContent();
  await pickTheme(page, 'Dracula');
  await expect(style).not.toHaveText(nord ?? '');
  // tabsh's frame script took the theme: the document was never replaced.
  await expect(frame).toHaveAttribute('srcdoc', srcdoc ?? '');
  await expect(frame).toHaveCount(1);
});
```

- [ ] **Step 3: Write the failing Rust tests**

In `src/web/pages.rs`, inside `mod tests`, next to
`csp_has_no_inline_scripts_and_matches_the_hosted_policy`:

```rust
    /// Markdown previews run tabsh's frame script, so a frame must never load
    /// anything but a blob: a link or a refresh in the Markdown can't swap the
    /// preview for a page of its own, with its own policy.
    #[test]
    fn frames_may_only_load_blobs() {
        let frame_src = APP_CSP
            .split(';')
            .map(str::trim)
            .find(|d| d.starts_with("frame-src"))
            .expect("the CSP has a frame-src");
        assert_eq!(frame_src, "frame-src blob:");
    }

    /// The Markdown preview's script is a file of its own, reached only by its
    /// URL from the lazy pane chunk, never by the page itself.
    #[test]
    fn preview_frame_script_is_its_own_asset() {
        let assets = crate::web::assets::app_assets();
        let (name, _) = assets
            .iter()
            .find(|(n, _)| n.starts_with("preview-frame-") && n.ends_with(".js"))
            .expect("no preview-frame asset: run npm run build in web/");
        let url = format!("/_astro/{name}");
        assert!(
            assets
                .iter()
                .any(|(n, bytes)| n != name && String::from_utf8_lossy(bytes).contains(&url)),
            "nothing refers to {url}"
        );
        assert!(!APP_HTML.contains(&url), "the page loads the frame script itself");
    }
```

- [ ] **Step 4: Run them to see them fail**

Run: `cargo test --locked preview_frame_script_is_its_own_asset frames_may_only_load_blobs`
Expected: `frames_may_only_load_blobs` PASSES (it pins today's policy).
`preview_frame_script_is_its_own_asset` FAILS with "no preview-frame asset".

- [ ] **Step 5: Write the frame script**

`web/src/app/files/preview-frame.ts`:

```ts
// Runs inside a Markdown preview's frame and nowhere else: an opaque origin
// under its own CSP (pane.ts's markdownDoc). It reports selections and hovers
// to the pane and draws the comments' highlights; the comments' text stays
// with the pane. Built as its own classic script: pane.ts imports its URL
// (`?worker&url`), so nothing else in the app bundles it.
import { type FromFrame, MAX_QUOTE, parseToFrame, type Rect } from './frame-protocol.ts';

// The Markdown can name this script again (the frame's CSP allows it): only
// the first copy runs. A symbol, so no element's id can stand in for it.
const RAN = Symbol.for('tabsh.preview-frame');

interface Spot {
  node: Text;
  offset: number;
  line: number; // the source line its block starts on
}

function start(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[RAN]) return;
  g[RAN] = true;
  // Without the Custom Highlight API there are no comments; the preview still shows.
  if (typeof Highlight === 'undefined' || !('highlights' in CSS)) return;
  // Taken now, while this script is the last thing parsed: nothing in the
  // Markdown below it can stand in for either.
  const self = document.currentScript;
  const theme = document.getElementById('tabsh-theme');
  const mark = self instanceof HTMLScriptElement ? new URL(self.src).searchParams.get('m') : null;
  if (!mark || !/^[0-9a-f]{32}$/.test(mark) || !(theme instanceof HTMLStyleElement)) return;

  const post = (m: FromFrame) => parent.postMessage(m, '*');
  const highlight = new Highlight();
  CSS.highlights.set('tabsh-comment', highlight);
  const kept = new Map<number, Range>(); // comment id → its passage
  const picks = new Map<number, Range>(); // selections reported, by number, until kept
  let picked = 0;
  let over: number | null = null;
  let frame = 0;

  // The nearest enclosing block of this render, by its mark.
  const blockOf = (node: Node | null): Element | null => {
    for (let el = node instanceof Element ? node : (node?.parentElement ?? null); el; el = el.parentElement) {
      if (el.getAttribute('data-tabsh-block') === mark) return el;
    }
    return null;
  };
  const lineOf = (el: Element, which: 'from' | 'to') => Number(el.getAttribute(`data-${which}`));
  const box = (r: DOMRect): Rect => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  // The text of this render's blocks with whitespace runs as one space (blocks
  // apart by one), and where each of its characters came from.
  function index(): { flat: string; at: Spot[] } {
    let flat = '';
    const at: Spot[] = [];
    for (const block of document.querySelectorAll(`[data-tabsh-block="${mark}"]`)) {
      const line = lineOf(block, 'from');
      if (flat && !flat.endsWith(' ')) {
        flat += ' ';
        at.push(at[at.length - 1]);
      }
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = (n as Text).data;
        for (let i = 0; i < text.length; i++) {
          const space = /\s/.test(text[i]);
          if (space && (flat === '' || flat.endsWith(' '))) continue;
          flat += space ? ' ' : text[i];
          at.push({ node: n as Text, offset: i, line });
        }
      }
    }
    return { flat, at };
  }

  function matches(flat: string, want: string): number[] {
    const found: number[] = [];
    if (want) for (let i = flat.indexOf(want); i !== -1; i = flat.indexOf(want, i + 1)) found.push(i);
    return found;
  }

  function report(): void {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const quote = sel.toString().slice(0, MAX_QUOTE);
    if (!quote.trim()) return;
    const range = sel.getRangeAt(0);
    const a = blockOf(range.startContainer);
    const b = blockOf(range.endContainer);
    if (!a || !b) return;
    // Which of the quote's matches this is, so it can be found again after
    // lines are added above it.
    const { flat, at } = index();
    const found = matches(flat, squash(quote));
    const nth = found.findIndex((i) => range.isPointInRange(at[i].node, at[i].offset));
    picked++;
    picks.set(picked, range.cloneRange());
    if (picks.size > 20) picks.delete(picks.keys().next().value as number);
    post({
      type: 'select',
      sel: picked,
      quote,
      from: lineOf(a, 'from'),
      to: lineOf(b, 'to'),
      nth,
      of: found.length,
      rect: box(range.getBoundingClientRect()),
    });
  }

  // A comment's passage found again after a re-render: the same match while
  // the quote has as many matches as when it was made, else the match whose
  // block starts nearest `from`.
  function locate(quote: string, from: number, nth: number, of: number): Range | null {
    const { flat, at } = index();
    const want = squash(quote);
    const found = matches(flat, want);
    if (!found.length) return null;
    const near = found.reduce((a, b) => (Math.abs(at[b].line - from) < Math.abs(at[a].line - from) ? b : a));
    const first = nth >= 0 && found.length === of ? found[nth] : near;
    const last = at[first + want.length - 1];
    const range = document.createRange();
    range.setStart(at[first].node, at[first].offset);
    range.setEnd(last.node, last.offset + 1);
    return range;
  }

  // The comment under the pointer, if any.
  function hit(x: number, y: number): [number, DOMRect] | null {
    for (const [id, range] of kept) {
      for (const r of range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return [id, r];
      }
    }
    return null;
  }
  const leave = () => {
    if (over === null) return;
    over = null;
    post({ type: 'unhover' });
  };

  document.addEventListener('mousedown', () => post({ type: 'clear' }));
  // After the browser has settled the selection.
  document.addEventListener('mouseup', () => setTimeout(report));
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey) report();
  });
  document.addEventListener('mousemove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const sel = getSelection();
      const h = sel && !sel.isCollapsed ? null : hit(e.clientX, e.clientY);
      if ((h ? h[0] : null) === over) return;
      over = h ? h[0] : null;
      post(h ? { type: 'hover', id: h[0], rect: box(h[1]) } : { type: 'unhover' });
    });
  });
  document.documentElement.addEventListener('mouseleave', leave);
  addEventListener(
    'scroll',
    () => {
      leave();
      post({ type: 'scroll' });
    },
    { passive: true },
  );

  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = parseToFrame(e.data);
    if (!m) return;
    switch (m.type) {
      case 'keep': {
        const range = picks.get(m.sel);
        picks.delete(m.sel);
        if (!range) post({ type: 'lost', id: m.id });
        else if (!kept.has(m.id)) {
          kept.set(m.id, range);
          highlight.add(range);
        }
        getSelection()?.removeAllRanges();
        break;
      }
      case 'drop': {
        const range = kept.get(m.id);
        if (range) highlight.delete(range);
        kept.delete(m.id);
        leave();
        break;
      }
      case 'dropAll':
        highlight.clear();
        kept.clear();
        leave();
        break;
      case 'locate': {
        if (kept.has(m.id)) break;
        const range = locate(m.quote, m.from, m.nth, m.of);
        const a = range && blockOf(range.startContainer);
        const b = range && blockOf(range.endContainer);
        if (!range || !a || !b) {
          post({ type: 'lost', id: m.id });
          break;
        }
        kept.set(m.id, range);
        highlight.add(range);
        post({ type: 'located', id: m.id, from: lineOf(a, 'from'), to: lineOf(b, 'to') });
        break;
      }
      case 'theme':
        theme.textContent = m.css;
        break;
    }
  });
  // Once the Markdown below has been parsed, the pane may send comments to find.
  document.addEventListener('DOMContentLoaded', () => post({ type: 'ready' }));
}

start();
```

- [ ] **Step 6: Write the frame link (`annotate.ts`, first version)**

`web/src/app/files/annotate.ts`:

```ts
// Comments on a Markdown preview, the pane's side. This first version is only
// the link to the frame: it knows when the frame script is listening, so a
// theme change can re-theme the preview in place.
import van, { type State } from 'vanjs-core';
import type { Comment } from './comments.ts';
import { parseFromFrame, type ToFrame } from './frame-protocol.ts';

export interface NotesHost {
  path(): string; // the file's path as the pane header shows it
  status(text: string): void; // the pane header's status line
}

export interface Notes {
  comments: State<readonly Comment[]>;
  pieces: HTMLElement[]; // the floating parts, for the pane view
  attach(frame: HTMLIFrameElement): void; // a new preview frame
  detach(): void; // the preview is gone (source view, another file)
  theme(css: string): boolean; // re-themes a listening frame; false when none is
  send(): void;
  clear(): void;
  dispose(): void;
}

export function createNotes(_host: NotesHost): Notes {
  const comments = van.state<readonly Comment[]>([]);
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  const tell = (m: ToFrame) => frame?.contentWindow?.postMessage(m, '*');

  function onMessage(e: MessageEvent): void {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = parseFromFrame(e.data);
    if (m?.type === 'ready') ready = true;
  }
  window.addEventListener('message', onMessage);

  return {
    comments,
    pieces: [],
    attach(f) {
      frame = f;
      ready = false;
    },
    detach() {
      frame = null;
      ready = false;
    },
    theme(css) {
      if (!frame || !ready) return false;
      tell({ type: 'theme', css });
      return true;
    },
    send() {},
    clear() {
      comments.val = [];
      tell({ type: 'dropAll' });
    },
    dispose() {
      window.removeEventListener('message', onMessage);
    },
  };
}
```

- [ ] **Step 7: Render Markdown into the scripted frame (`pane.ts`)**

Make these edits in `web/src/app/files/pane.ts`.

**(a)** Add these imports after `import { createEditor, type Editor } from './editor.ts';`:

```ts
import { createNotes, type Notes } from './annotate.ts';
import { frameCsp, highlightCss, renderBlocks } from './comments.ts';
import frameScript from './preview-frame.ts?worker&url';
```

Then run `npm run lint` and let Biome's import sorting place them where it
wants.

**(b)** In `interface PaneState`, after `frame: HTMLIFrameElement | null;`, add:

```ts
  notes: Notes; // the comments on a Markdown preview (annotate.ts)
  mark: string; // the Markdown preview's render mark (comments.ts's renderBlocks)
```

**(c)** In `PaneView`, change the `section(...)` children to end with the
floating pieces:

```ts
  const view = section(
    { class: 'pane-view', hidden: () => current.val !== st.id },
    PaneHead(st),
    () => st.body.val,
    ConflictBar(st),
    ...st.notes.pieces,
  );
```

**(d)** In `clear(st)`, add `st.notes.detach();` as its first line. In
`forget()`, after `clear(st);`, add `st.notes.dispose();`.

**(e)** Replace `markdownDoc` with these three functions:

```ts
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
const newMark = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// A Markdown preview's document. Its first tag after the charset is its own
// CSP: the one script that may run is tabsh's frame script, at its exact URL.
// The script takes this render's mark from its query (CSP ignores the query).
function markdownDoc(html: string, th: PaneTheme, mark: string): string {
  const url = new URL(frameScript, location.href);
  const policy = frameCsp(url.origin + url.pathname);
  url.search = '';
  url.searchParams.set('m', mark);
  return (
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">` +
    `<style id="tabsh-theme">${previewCss(th)}</style><script src="${url.href}"></script>${html}`
  );
}
```

**(f)** In `mountRich`, add `st.notes.detach();` right after `st.markdown = null;`.
Then replace the Markdown `else` branch with:

```ts
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
```

**(g)** In `newState`, build the notes before the object literal, and add the
two new fields to it:

```ts
function newState(id: string, requested: string): PaneState {
  const notes = createNotes({
    path: () => st.path.val.text,
    status: (text) => setStatus(st, text),
  });
  const st: PaneState = {
    // …every existing field, unchanged…
    notes,
    mark: '',
  };
  return st;
}
```

The closures use `st` only when they're called, which is after it exists.

**(h)** Replace `applyTheme`'s frame line:

```ts
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
```

- [ ] **Step 8: Update the security invariant (`docs/architecture.md`)**

In "Security invariants", replace this line:

```
  - Markdown and SVG render in `<iframe sandbox="">`.
```

with:

```
  - SVG renders in `<iframe sandbox="">`.
  - Markdown renders in `<iframe sandbox="allow-scripts">`. Its `srcdoc`
    opens with its own CSP, whose `script-src` is exactly tabsh's frame
    script (`files/preview-frame.ts`, built as its own asset). That is the
    only script that runs there: the page's inherited CSP blocks inline
    script and handlers, and its `frame-src blob:` keeps the frame from being
    navigated to a page with a policy of its own (`frames_may_only_load_blobs`).
```

- [ ] **Step 9: Build, then run every check**

Run:
```bash
cd web && npm run lint && npm run check && npm test && npm run build && cd ..
cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
cargo build --locked && cd web && npx playwright test e2e/comments.spec.ts e2e/pane.spec.ts
```

Expected:
- every check passes;
- `ls ../src/app-assets | grep preview-frame` shows one `preview-frame-<hash>.js`;
- both new Rust tests pass;
- both new e2e tests pass, and `pane.spec.ts` still passes.

If `npm run check` can't find the type of `./preview-frame.ts?worker&url`,
add `/// <reference types="vite/client" />` as the first line of
`web/src/app/globals.d.ts`.

- [ ] **Step 10: Commit**

```bash
git add web/src/app/files/preview-frame.ts web/src/app/files/annotate.ts web/src/app/files/pane.ts \
  web/e2e/comments.spec.ts web/e2e/fixture.ts web/e2e/pane.spec.ts src/web/pages.rs docs/architecture.md
git commit -m "feat(pane): Markdown previews run tabsh's frame script, and only it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add src/app.html src/app-assets
git commit -m "chore(app): rebuild the embedded app

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Comment, hover, edit, delete and Send

**Files:**
- Modify: `web/src/app/files/annotate.ts` (replace it whole)
- Modify: `web/src/app/files/pane.ts` (`Host.paste`, the Send button, notes host)
- Modify: `web/src/app/main.ts` (`paste`)
- Modify: `web/src/app/ui/icons.ts` (`send`, `messageSquarePlus`)
- Modify: `web/src/styles/app.css` (append only)
- Modify: `web/e2e/comments.spec.ts`

**Interfaces:**
- Consumes: Task 3's frame messages, Task 1's `commentMessage`, `oneLine`
  and `shortLines`, and `icons.edit` and `icons.close` (both exist).
- Produces:
  - `type PasteResult = 'pasted' | 'closed' | 'unsafe'`
  - `NotesHost.paste(text: string): PasteResult`
  - `Host.paste(sessionId: string, text: string): PasteResult`
  - `icons.send`, `icons.messageSquarePlus`
  - CSS classes `.pane-send`, `.comment-menu`, `.comment-box`,
    `.comment-quote`, `.comment-hover`, `.comment-note`, `.comment-lines`

- [ ] **Step 1: Write the failing e2e tests**

Change the imports at the top of `web/e2e/comments.spec.ts` to:

```ts
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, openApp, pickTheme, test, typeInTerminal } from './fixture.ts';
```

Append these helpers after `openFile`:

```ts
const rows = (page: Page) => page.locator('.term.active .xterm-rows');
const status = (page: Page) => shown(page).locator('.pane-status');
const highlights = (page: Page) =>
  preview(page)
    .locator('body')
    .evaluate(() => CSS.highlights.get('tabsh-comment')?.size ?? 0);

// Selects the whole text of the `nth` element in the preview holding `text`,
// then lets the frame script see the mouseup that ends a drag.
async function select(page: Page, text: string, nth = 0): Promise<void> {
  await preview(page)
    .getByText(text)
    .nth(nth)
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
}

// Comments `note` on the `nth` element holding `text`.
async function comment(page: Page, text: string, note: string, nth = 0): Promise<void> {
  await select(page, text, nth);
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  await shown(page).locator('.comment-box textarea').fill(note);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(shown(page).locator('.comment-box')).toBeHidden();
}

// Runs `cat` in the active terminal with bracketed paste on or off, so a paste
// shows as cat's echo and nothing runs it. Waits until cat is running.
async function catWithPasteMode(page: Page, on: boolean): Promise<void> {
  await typeInTerminal(page, `printf '\\033[?2004${on ? 'h' : 'l'}'; echo cat-$((40+2)); cat`);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toContainText('cat-42');
}

// Points at the middle of the first element in the preview holding `text`.
async function hover(page: Page, text: string): Promise<void> {
  const box = await preview(page).getByText(text).first().boundingBox();
  if (!box) throw new Error(`no box for ${text}`);
  await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
}

const PLAN = '# Plan\n\nFirst paragraph.\n\nSecond paragraph\nspans two lines.\n';
```

Then append these tests:

```ts
test("comments paste into the tab's terminal, one line each", async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await comment(page, 'Second paragraph', 'Say more.');
  expect(await highlights(page)).toBe(2);
  const send = shown(page).locator('.pane-send');
  await expect(send).toHaveAttribute('title', 'Send 2 comments to Claude');

  await catWithPasteMode(page, true);
  await send.click();
  await expect(rows(page)).toContainText('plan.md for me:');
  await expect(rows(page)).toContainText('- line 3, "First paragraph.": Make it shorter.');
  await expect(rows(page)).toContainText('- lines 5-6, "Second paragraph spans two lines.": Say more.');
  // Sent: the comments and highlights are gone, and the terminal has the keyboard.
  await expect(send).toBeHidden();
  expect(await highlights(page)).toBe(0);
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Control+C');
});

test('Send refuses a terminal without bracketed paste, and keeps the comments', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await catWithPasteMode(page, false);
  await shown(page).locator('.pane-send').click();
  await expect(status(page)).toHaveText("Not sent: the terminal isn't at a prompt that takes a paste safely");
  await expect(rows(page)).not.toContainText('for me:');
  await expect(shown(page).locator('.pane-send')).toBeVisible();
  await page.keyboard.press('Control+C');
});

test("a quote can't end the paste early and run a command", async ({ page, daemon, project }) => {
  const pwned = path.join(project, 'pwned');
  writeFileSync(path.join(project, 'trap.md'), `# Trap\n\nharmless\u001b[201~ touch '${pwned}'\n`);
  await openApp(page, daemon);
  await openFile(page, project, 'trap.md');
  await comment(page, 'harmless', 'Fix this.');
  // At the shell's own prompt: a paste that ended early would run the rest.
  await shown(page).locator('.pane-send').click();
  await expect
    .poll(
      async () =>
        ((await rows(page).textContent()) ?? '').includes('for me:') ||
        ((await status(page).textContent()) ?? '').startsWith('Not sent'),
    )
    .toBe(true);
  await page.waitForTimeout(1000);
  expect(existsSync(pwned)).toBe(false);
  await typeInTerminal(page, '\u0003');
});

test('hovering a highlight shows its comment, to edit or delete', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const card = shown(page).locator('.comment-hover');

  await hover(page, 'First paragraph.');
  await expect(card).toBeVisible();
  await expect(card.locator('.comment-note')).toHaveText('Make it shorter.');
  await expect(card.locator('.comment-lines')).toHaveText('L3');
  await page.mouse.move(5, 300); // over the terminal
  await expect(card).toBeHidden();

  await hover(page, 'First paragraph.');
  await card.getByRole('button', { name: 'Edit comment' }).click();
  const box = shown(page).locator('.comment-box');
  await expect(box.locator('textarea')).toHaveValue('Make it shorter.');
  await box.locator('textarea').fill('Cut it to one line.');
  await box.getByRole('button', { name: 'Save' }).click();
  await hover(page, 'First paragraph.');
  await expect(card.locator('.comment-note')).toHaveText('Cut it to one line.');

  await card.getByRole('button', { name: 'Delete comment' }).click();
  await expect(card).toBeHidden();
  await expect(shown(page).locator('.pane-send')).toBeHidden();
  expect(await highlights(page)).toBe(0);
});

test('Esc closes the comment box without leaving the pane', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await select(page, 'First paragraph.');
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  await shown(page).locator('.comment-box textarea').fill('never mind');
  await page.keyboard.press('Escape');
  await expect(shown(page).locator('.comment-box')).toBeHidden();
  await expect(page.locator('.term.active .xterm-helper-textarea')).not.toBeFocused();
  await expect(shown(page).locator('.pane-send')).toBeHidden();
});

test('the Comment button sits above a selection, below it under the header, inside the pane', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  const menu = shown(page).locator('.comment-menu');
  const pane = (await page.locator('#pane').boundingBox())!;
  const inside = async () => {
    const m = (await menu.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(pane.x);
    expect(m.x + m.width).toBeLessThanOrEqual(pane.x + pane.width);
  };

  await select(page, 'Second paragraph');
  const para = (await preview(page).getByText('Second paragraph').boundingBox())!;
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(para.y);
  await inside();

  await select(page, 'Plan');
  const title = (await preview(page).getByRole('heading', { name: 'Plan' }).boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height);
  await inside();
});

test('a whole-document selection pastes a cut quote', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'long.md'), `# Long\n\n${'word '.repeat(2000)}\n`);
  await openApp(page, daemon);
  await openFile(page, project, 'long.md');
  await preview(page)
    .locator('body')
    .evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  await shown(page).locator('.comment-box textarea').fill('Trim.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- lines 1-3, "Long word word');
  await expect(rows(page)).toContainText('…": Trim.');
  await page.keyboard.press('Control+C');
});
```

- [ ] **Step 2: Run them to see them fail**

Run (after the build steps in Global Constraints):
`cd web && npx playwright test e2e/comments.spec.ts`
Expected: the new tests FAIL on `.comment-menu` not being found. The two
Task 3 tests still pass.

- [ ] **Step 3: Add the icons (`ui/icons.ts`)**

Inside the icons object, next to `edit`, add:

```ts
  send: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      }),
      path({ d: 'm21.854 2.147-10.94 10.939' }),
    ),
  ),
  messageSquarePlus: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
      }),
      path({ d: 'M12 8v6' }),
      path({ d: 'M9 11h6' }),
    ),
  ),
```

- [ ] **Step 4: Replace `annotate.ts` whole**

`web/src/app/files/annotate.ts`:

```ts
// Comments on a Markdown preview, the pane's side: the Comment button over a
// selection, the comment box, the card a highlight shows on hover, and Send.
// One `Notes` per pane view; its comments live in the page. The frame script
// (preview-frame.ts) draws the highlights. The comments' text stays here and
// goes into the DOM only as child strings and a textarea's value.
import van, { type State } from 'vanjs-core';
import { isMac } from '../ui/dom.ts';
import { type Icon, icons } from '../ui/icons.ts';
import { type Comment, commentMessage, oneLine, shortLines } from './comments.ts';
import { parseFromFrame, type Rect, type ToFrame } from './frame-protocol.ts';

const { button, code, div, footer, p, span, textarea } = van.tags;

export type PasteResult = 'pasted' | 'closed' | 'unsafe';

export interface NotesHost {
  path(): string; // the file's path as the pane header shows it
  paste(text: string): PasteResult; // into this tab's terminal
  status(text: string): void; // the pane header's status line
}

export interface Notes {
  comments: State<readonly Comment[]>;
  pieces: HTMLElement[]; // the floating parts, for the pane view
  attach(frame: HTMLIFrameElement): void; // a new preview frame
  detach(): void; // the preview is gone (source view, another file)
  theme(css: string): boolean; // re-themes a listening frame; false when none is
  send(): void;
  clear(): void;
  dispose(): void;
}

// The selection the Comment button is for, as the frame reported it.
interface Picked {
  sel: number;
  quote: string;
  from: number;
  to: number;
  nth: number;
  of: number;
  rect: Rect;
}

const GAP = 6; // between a floating piece and the text it's for
const HIDE_MS = 250; // the hover card's grace, to reach it from the highlight

export function createNotes(host: NotesHost): Notes {
  const comments = van.state<readonly Comment[]>([]);
  const hovered = van.state<Comment | null>(null);
  const quote = van.state('');
  const saveLabel = van.state('Comment');
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  let picked: Picked | null = null;
  let editing: Comment | null = null; // the comment the box edits; null for a new one
  let hoverRect: Rect | null = null;
  let nextId = 1;
  let hideTimer = 0;

  const tell = (m: ToFrame) => frame?.contentWindow?.postMessage(m, '*');

  const menu = div(
    { class: 'row-menu comment-menu', role: 'menu', 'aria-label': 'Selection', hidden: true },
    button({ type: 'button', role: 'menuitem', onclick: () => openBox(null) }, icons.messageSquarePlus(), span('Comment')),
  );
  const note = textarea({ class: 'textarea', rows: 3, placeholder: 'What should change?', 'aria-label': 'Comment' });
  const box = div(
    { class: 'row-menu comment-box', role: 'dialog', 'aria-label': 'Comment', hidden: true },
    p({ class: 'comment-quote' }, () => quote.val),
    note,
    footer(
      button({ type: 'button', class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', onclick: () => hideAll() }, 'Cancel'),
      button({ type: 'button', class: 'btn', 'data-size': 'sm', onclick: () => save() }, () => saveLabel.val),
    ),
  );
  const small = (icon: Icon, label: string, onclick: () => void) =>
    button(
      { type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-xs', title: label, 'aria-label': label, onclick },
      icon(),
    );
  const card = div(
    { class: 'row-menu comment-hover', hidden: true },
    p({ class: 'comment-note' }, () => hovered.val?.note ?? ''),
    footer(
      code({ class: 'comment-lines' }, () => (hovered.val ? shortLines(hovered.val) : '')),
      small(icons.edit, 'Edit comment', () => {
        if (hovered.val) openBox(hovered.val);
      }),
      small(icons.close, 'Delete comment', () => {
        if (hovered.val) remove(hovered.val.id);
      }),
    ),
  );

  // Puts a floating piece over the frame at `rect` (in the frame's
  // coordinates): above it when `above` and there's room under the pane
  // header, else below; inside the pane's width. Shown first, so it has a size.
  function place(el: HTMLElement, rect: Rect, above: boolean): void {
    el.hidden = false;
    const view = el.offsetParent;
    if (!frame || !(view instanceof HTMLElement)) return;
    const f = frame.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const head = view.querySelector<HTMLElement>('.pane-head')?.offsetHeight ?? 0;
    let top = f.top - v.top + rect.top - el.offsetHeight - GAP;
    if (!above || top < head + GAP) top = f.top - v.top + rect.bottom + GAP;
    const left = Math.min(f.left - v.left + rect.left, v.width - el.offsetWidth - 8);
    el.style.top = `${top}px`;
    el.style.left = `${Math.max(left, 8)}px`;
  }

  function hideCard(): void {
    clearTimeout(hideTimer);
    card.hidden = true;
    hovered.val = null;
  }
  function hideCardSoon(): void {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideCard, HIDE_MS);
  }
  function hideAll(): void {
    menu.hidden = true;
    box.hidden = true;
    editing = null;
    hideCard();
  }

  // Opens the box for a new comment on the picked selection, or to edit `c`.
  function openBox(c: Comment | null): void {
    const target = c ?? picked;
    const at = c ? hoverRect : picked?.rect;
    if (!target || !at) return;
    editing = c;
    quote.val = `“${oneLine(target.quote, 120)}”`;
    note.value = c?.note ?? '';
    saveLabel.val = c ? 'Save' : 'Comment';
    menu.hidden = true;
    hideCard();
    // After VanJS has applied the quote and label (a microtask queued before this one).
    queueMicrotask(() => {
      place(box, at, false);
      note.focus();
    });
  }

  function save(): void {
    const text = note.value.trim();
    if (!text) return;
    if (editing) {
      const id = editing.id;
      comments.val = comments.val.map((c) => (c.id === id ? { ...c, note: text } : c));
    } else if (picked) {
      const { sel, quote: q, from, to, nth, of } = picked;
      const id = nextId++;
      comments.val = [...comments.val, { id, quote: q, from, to, nth, of, note: text, lost: false }];
      tell({ type: 'keep', id, sel });
      picked = null;
    }
    hideAll();
  }

  function update(id: number, change: Partial<Comment>): void {
    comments.val = comments.val.map((c) => (c.id === id ? { ...c, ...change } : c));
  }

  function reportLost(): void {
    const n = comments.val.filter((c) => c.lost).length;
    host.status(n === 0 ? '' : n === 1 ? '1 comment no longer matches the file' : `${n} comments no longer match the file`);
  }

  function remove(id: number): void {
    comments.val = comments.val.filter((c) => c.id !== id);
    tell({ type: 'drop', id });
    hideCard();
    reportLost();
  }

  box.addEventListener('keydown', (e) => {
    // Handled here: the pane's own Esc (back to the terminal) skips a prevented one.
    if (e.key === 'Escape') {
      e.preventDefault();
      hideAll();
    } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', hideCardSoon);

  // A press anywhere but the floating pieces puts the Comment button away.
  const outside = (e: MouseEvent) => {
    const t = e.target;
    if (t instanceof Node && (menu.contains(t) || box.contains(t) || card.contains(t))) return;
    menu.hidden = true;
  };
  document.addEventListener('mousedown', outside);

  function onMessage(e: MessageEvent): void {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = parseFromFrame(e.data);
    if (!m) return;
    switch (m.type) {
      case 'ready':
        ready = true;
        for (const c of comments.val) {
          tell({ type: 'locate', id: c.id, quote: c.quote, from: c.from, nth: c.nth, of: c.of });
        }
        break;
      case 'select':
        if (!box.hidden) break; // a comment is being written: keep it
        picked = { sel: m.sel, quote: m.quote, from: m.from, to: m.to, nth: m.nth, of: m.of, rect: m.rect };
        hideCard();
        place(menu, m.rect, true);
        break;
      case 'clear':
        menu.hidden = true;
        break;
      case 'hover': {
        const c = comments.val.find((x) => x.id === m.id);
        if (!c || !box.hidden) break;
        clearTimeout(hideTimer);
        hovered.val = c;
        hoverRect = m.rect;
        // After VanJS has applied the card's text, so it's placed at its size.
        queueMicrotask(() => place(card, m.rect, false));
        break;
      }
      case 'unhover':
        hideCardSoon();
        break;
      case 'scroll':
        menu.hidden = true;
        hideCard();
        break;
      case 'located':
        update(m.id, { from: m.from, to: m.to, lost: false });
        reportLost();
        break;
      case 'lost':
        update(m.id, { lost: true });
        reportLost();
        break;
    }
  }
  window.addEventListener('message', onMessage);

  return {
    comments,
    pieces: [menu, box, card],
    attach(f) {
      frame = f;
      ready = false;
    },
    detach() {
      frame = null;
      ready = false;
      hideAll();
    },
    theme(css) {
      if (!frame || !ready) return false;
      tell({ type: 'theme', css });
      return true;
    },
    send() {
      const list = comments.val;
      if (!list.length) return;
      const result = host.paste(commentMessage(host.path(), list));
      if (result === 'pasted') {
        comments.val = [];
        tell({ type: 'dropAll' });
        hideAll();
        host.status('');
      } else {
        host.status(
          result === 'closed'
            ? "Not sent: this tab's terminal is closed"
            : "Not sent: the terminal isn't at a prompt that takes a paste safely",
        );
      }
    },
    clear() {
      comments.val = [];
      tell({ type: 'dropAll' });
      hideAll();
    },
    dispose() {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('mousedown', outside);
      clearTimeout(hideTimer);
    },
  };
}
```

- [ ] **Step 5: Wire Send in the pane (`pane.ts`)**

**(a)** Add `paste` to `Host`, and import the type:

```ts
import { createNotes, type Notes, type PasteResult } from './annotate.ts';
```

```ts
  // Pastes into a tab's terminal (bracketed, never pressing Enter).
  paste(sessionId: string, text: string): PasteResult;
```

**(b)** In `newState`, give the notes the paste:

```ts
  const notes = createNotes({
    path: () => st.path.val.text,
    paste: (text) => host.paste(id, text),
    status: (text) => setStatus(st, text),
  });
```

**(c)** Add the Send button, and put it in `PaneHead` just before `EditToggle(st)`:

```ts
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
```

```ts
    span({ class: 'pane-dot', title: 'Unsaved changes', hidden: () => !st.dirty.val }, '●'),
    SendButton(st),
    EditToggle(st),
```

- [ ] **Step 6: Implement `paste` (`main.ts`)**

In the object passed to `initFilePane`, after `focusTerminal`:

```ts
    paste(sessionId, text) {
      const s = store.sessions.find((x) => x.id === sessionId);
      if (!s || s.closed) return 'closed';
      // Without bracketed paste a shell runs each pasted line as a command,
      // and the text holds lines quoted from a file.
      if (!s.term.modes.bracketedPasteMode) return 'unsafe';
      s.term.paste(text);
      s.term.focus();
      return 'pasted';
    },
```

- [ ] **Step 7: Add the styles (`app.css`, appended)**

Append to the end of `web/src/styles/app.css`:

```css
/* Markdown comments (files/annotate.ts): the Comment button over a selection,
   the comment box and the hover card, on the row menu's surface, and the
   header's Send button. New classes only: nothing above is restyled. */
.pane-send[hidden], .comment-menu[hidden], .comment-box[hidden], .comment-hover[hidden] { display: none; }
.comment-menu, .comment-box, .comment-hover { position: absolute; z-index: 20; }
.comment-menu { min-width: 0; padding: .1875rem; }
.comment-menu [role="menuitem"] { display: flex; align-items: center; gap: .375rem; padding: .25rem .5rem .25rem .375rem; }
.comment-menu svg { flex-shrink: 0; width: 1rem; height: 1rem; color: var(--muted-foreground); }
.comment-menu [role="menuitem"]:hover svg { color: var(--foreground); }
.comment-box { width: 20rem; gap: .375rem; padding: .375rem; }
.comment-quote {
  margin: 0; padding: 0 .125rem; font-size: .75rem; color: var(--muted-foreground);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.comment-box .textarea { min-height: 4rem; font-size: .8125rem; }
.comment-box footer { display: flex; justify-content: flex-end; gap: .25rem; }
.comment-hover { max-width: 20rem; padding: .375rem .5rem .25rem; gap: .25rem; }
.comment-note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-hover footer { display: flex; align-items: center; gap: .125rem; }
.comment-lines { flex: 1; font: .75rem ui-monospace, Menlo, monospace; color: var(--muted-foreground); }
```

- [ ] **Step 8: Run the checks and the e2e tests**

Run:
```bash
cd web && npm run lint && npm run check && npm test && npm run build && cd ..
cargo test --locked && cargo build --locked && cd web && npx playwright test e2e/comments.spec.ts e2e/pane.spec.ts
```
Expected: all pass. `git diff web/src/styles/app.css` shows only added lines
at the end.

- [ ] **Step 9: Look at it in a real page**

Start the built daemon (`../target/debug/tabsh`), open the link it prints,
open a `.md` file, and try the flow from the spec's "What you see" section
in a dark theme and a light theme. Compare it with the mockup the spec
describes. Fix anything that differs from the spec before committing.

- [ ] **Step 10: Commit**

```bash
git add web/src/app/files/annotate.ts web/src/app/files/pane.ts web/src/app/main.ts web/src/app/ui/icons.ts \
  web/src/styles/app.css web/e2e/comments.spec.ts
git commit -m "feat(pane): comment on a Markdown preview and send the comments to Claude

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add src/app.html src/app-assets
git commit -m "chore(app): rebuild the embedded app

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Comments outlive re-renders, and ask before they're lost

**Files:**
- Modify: `web/src/app/files/pane.ts` (`load`, `hasUnsaved`, `isDirty`, `confirmDiscard`)
- Modify: `web/e2e/comments.spec.ts`

**Interfaces:**
- Consumes:
  - Task 4's `Notes`: `comments` and `clear()`. Re-finding comments after a
    frame's `ready` is already in `annotate.ts`.
  - The callers of the dirty checks: `files/open.ts`'s guard (`isDirty`,
    `confirmDiscard`), `sessions/store.ts:191` (`confirmDiscard` on closing
    a tab) and `main.ts`'s `beforeunload` (`hasUnsaved`).

- [ ] **Step 1: Write the failing e2e tests**

Append to `web/e2e/comments.spec.ts` (it also needs `newTab` in the fixture
import):

```ts
test('comments are found again after the file changes on disk', async ({ page, daemon, project }) => {
  const file = path.join(project, 'moving.md');
  writeFileSync(file, '# Moving\n\nKeep me.\n\nChange me.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'moving.md');
  await comment(page, 'Keep me.', 'A');
  await comment(page, 'Change me.', 'B');
  writeFileSync(file, '# Moving\n\nNew intro.\n\nKeep me.\n\nSomething else.\n');
  // The pane checks the disk every 2 s and re-renders the preview in place.
  await expect(preview(page).locator('body')).toContainText('New intro.', { timeout: 10_000 });
  await expect(status(page)).toHaveText('1 comment no longer matches the file');
  expect(await highlights(page)).toBe(1);
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 5, "Keep me.": A');
  await expect(rows(page)).toContainText('- line 5, "Change me.": B');
  await page.keyboard.press('Control+C');
});

test('a repeated passage keeps its comment on the one picked', async ({ page, daemon, project }) => {
  const file = path.join(project, 'twice.md');
  writeFileSync(file, '# Twice\n\nSame line.\n\nSame line.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'twice.md');
  await comment(page, 'Same line.', 'The second one.', 1);
  writeFileSync(file, '# Twice\n\nTop.\n\nSame line.\n\nSame line.\n');
  await expect(preview(page).locator('body')).toContainText('Top.', { timeout: 10_000 });
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 7, "Same line.": The second one.');
  await page.keyboard.press('Control+C');
});

test('comments survive the source view and a theme change', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const toggle = () =>
    shown(page).locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');
  await toggle().click();
  await expect(shown(page).locator('.cm-editor')).toBeVisible();
  await expect(shown(page).locator('.pane-send')).toBeVisible();
  await toggle().click();
  await expect.poll(() => highlights(page)).toBe(1);
  await pickTheme(page, 'GitHub Light');
  expect(await highlights(page)).toBe(1);
  await hover(page, 'First paragraph.');
  await expect(shown(page).locator('.comment-hover .comment-note')).toHaveText('Make it shorter.');
});

test('unsent comments ask before the file goes', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  writeFileSync(path.join(project, 'other.md'), '# Other\n');
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const other = page.locator('#explorer').getByRole('treeitem', { name: 'other.md', exact: true });

  page.once('dialog', (d) => {
    expect(d.message()).toBe('Discard 1 unsent comment?');
    void d.dismiss();
  });
  await other.click();
  await expect(shown(page).locator('.pane-head')).toContainText('plan.md');
  await expect(shown(page).locator('.pane-send')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await other.click();
  await expect(shown(page).locator('.pane-head')).toContainText('other.md');
  await expect(shown(page).locator('.pane-send')).toBeHidden();
});

test("each tab keeps its own comments, and Send pastes into its own terminal", async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  writeFileSync(path.join(project, 'other.md'), '# Other\n\nOther text.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'In tab one.');
  const first = page.locator('#tabs .tab:not(.mirror)').first();

  await newTab(page);
  await openFile(page, project, 'other.md');
  await expect(shown(page).locator('.pane-send')).toBeHidden();
  await catWithPasteMode(page, true);

  await first.click();
  await expect(shown(page).locator('.pane-head')).toContainText('plan.md');
  await expect(shown(page).locator('.pane-send')).toHaveAttribute('title', 'Send 1 comment to Claude');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('In tab one.');
  await page.keyboard.press('Control+C');
  await page.locator('#tabs .tab:not(.mirror)').nth(1).click();
  await expect(rows(page)).not.toContainText('In tab one.');
  await page.keyboard.press('Control+C');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx playwright test e2e/comments.spec.ts -g "outlive|repeated|survive|ask before|own comments"`
Expected:
- "unsent comments ask before the file goes" FAILS, because no dialog
  appears and other.md opens.
- The re-render tests may already pass, because Task 4 re-finds comments on
  `ready`. That's fine: they pin it from here on.

- [ ] **Step 3: Count comments as unsent work (`pane.ts`)**

Replace `hasUnsaved`, `confirmDiscard` and `isDirty`:

```ts
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
```

```ts
// Unsaved edits or unsent comments: the router asks before they go.
export function isDirty(sessionId: string): boolean {
  const st = states.get(sessionId);
  return !!st && (st.dirty.val || unsent(st) > 0);
}
```

- [ ] **Step 4: Keep comments when the same file loads again (`load()`)**

In `load()`, just before `Object.assign(st, {`, add:

```ts
  // Another file drops the comments (the router asked first); the same file
  // loaded again keeps them, to be found in its new preview.
  if (!info || st.info?.path !== info.path) st.notes.clear();
```

- [ ] **Step 5: Run the checks and the e2e tests**

Run:
```bash
cd web && npm run lint && npm run check && npm test && npm run build && cd .. && cargo build --locked
cd web && npx playwright test
```
Expected: the whole e2e suite passes, including `navigation.spec.ts` and
`tabs.spec.ts`, which go through `confirmDiscard`.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/files/pane.ts web/e2e/comments.spec.ts
git commit -m "feat(pane): comments outlive a re-render and ask before they're dropped

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add src/app.html src/app-assets
git commit -m "chore(app): rebuild the embedded app

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Architecture doc, full checks, Safari

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Describe the new modules**

In `docs/architecture.md`'s app table, replace the `files/` row's
"`pane.ts` and `editor.ts` (pane and CodeMirror)" with:

```
`pane.ts` and `editor.ts` (pane and CodeMirror), `comments.ts` (a Markdown
preview's blocks with their source lines (`renderBlocks`, each marked with
the render's random mark), the frame's CSP and the comment highlight, and
the message Send pastes: `Make these changes to <path> for me:`, one line
per comment, with control and invisible characters made spaces),
`frame-protocol.ts` (the checked messages between the pane and the frame),
`preview-frame.ts` (the script inside a Markdown preview's frame, built as
its own asset (`?worker&url`): reports selections and hovers, draws
highlights with the Custom Highlight API, finds comments again after a
re-render), `annotate.ts` (the pane's side: the Comment button over a
selection, the comment box, the hover card with edit and delete, and Send,
which pastes into the tab's terminal through `Host.paste` only when that
terminal is in bracketed-paste mode; unsent comments count as unsaved work)
```

In the "Pure logic stays testable" rule's list, add
`files/comments.ts, files/frame-protocol.ts`.

In "The editor stays lazy", add one sentence:

```
`files/preview-frame.ts` is reached only by its URL from `pane.ts`
(`preview_frame_script_is_its_own_asset`).
```

- [ ] **Step 2: Run every repository check**

From the repo root:
```bash
cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
cd web && npm run check && npm run lint && npm test && npm run build && cd ..
cargo build --locked && cd web && npx playwright test && cd ..
git status --short
```
Expected: everything passes. `git status` shows only `docs/architecture.md`.
The build output is the same as the last rebuild commit; if it isn't, commit
it as a rebuild.

- [ ] **Step 3: Safari, by hand**

Start `target/debug/tabsh` and open its link in Safari, which uses the
daemon's own copy of the page. Then:
1. open a `.md`, select, Comment, ⌘Enter;
2. hover, edit, delete;
3. comment again and Send, in a tab running `claude`;
4. switch to a light theme with a comment open.

Expected: it behaves as in Chromium.
- If Safari lacks the Custom Highlight API (before 17.2), the preview still
  renders, with no Comment button and no Send button.
- Write down what you saw in the PR description.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): Markdown comments in the file pane

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
