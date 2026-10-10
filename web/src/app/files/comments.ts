// Comments on a source selection, without the DOM (node --test loads this):
// where the selection sits, how an edit moves it, and the message Send pastes.
import type { ChangeSet, Text } from '@codemirror/state';

export interface Comment {
  id: number;
  quote: string; // the source text, exactly as selected
  from: number; // inclusive offset
  to: number; // exclusive offset
  fromLine: number;
  toLine: number;
  note: string;
  lost: boolean; // an edit changed the quoted text; still sent, no longer highlighted
}

// Characters that must not reach the terminal. A control (Cc) could be the ESC
// that ends a bracketed paste early (ESC [201~) and have the shell run the rest.
// Format characters (Cf) are the invisible ones: zero-width, bidi, tag characters.
// Variation selectors, Hangul fillers and the combining grapheme joiner too.
const HIDDEN =
  /[\p{Cc}\p{Cf}\u{E0000}-\u{E007F}\u{115F}\u{1160}\u{3164}\u{FFA0}]|[\u{FE00}-\u{FE0F}]|[\u{E0100}-\u{E01EF}]|\u{034F}/gu;

// `s` on one line and safe to paste: hidden characters become spaces,
// whitespace runs one space, and past `max` characters it's cut with "…".
export function oneLine(s: string, max: number): string {
  const text = s.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

const QUOTE_MAX = 200;
const NOTE_MAX = 2000;
const PATH_MAX = 1000;

export const linesLabel = (c: { fromLine: number; toLine: number }): string =>
  c.fromLine === c.toLine ? `line ${c.fromLine}` : `lines ${c.fromLine}-${c.toLine}`;

export const shortLines = (c: { fromLine: number; toLine: number }): string =>
  c.fromLine === c.toLine ? `L${c.fromLine}` : `L${c.fromLine}-${c.toLine}`;

// The selection as the comment box shows it: the first line, then everything
// after it. A leading markdown heading mark is only punctuation, so it is left off.
export function quoteParts(raw: string): { lead: string; rest: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const breakAt = text.indexOf('\n');
  const first = (breakAt < 0 ? text : text.slice(0, breakAt)).replace(/^#{1,6}\s+/, '').trim();
  const rest = breakAt < 0 ? '' : text.slice(breakAt + 1).trim();
  return { lead: first, rest };
}

// A marked token, plus where its `raw` sits in the source. The preview's text
// spans carry `srcFrom`/`srcTo` so a selection in the frame maps back here.
export interface SrcToken {
  type: string;
  raw: string;
  text?: string;
  tokens?: SrcToken[];
  srcFrom?: number;
  srcTo?: number;
}

// Enough of `marked` to render the preview block by block. pane.ts passes the module it imports.
export interface MarkedLike {
  lexer(src: string): Iterable<SrcToken>;
  parser(tokens: SrcToken[]): string;
}

// `marked`, plus a renderer whose text and code spans remember their source offsets.
export interface SpanMarked {
  lexer(src: string): Iterable<SrcToken>;
  parser(tokens: SrcToken[], options: { renderer: object }): string;
  Renderer: new () => {
    text: (token: SrcToken) => string;
    codespan: (token: SrcToken) => string;
  };
}

const newlines = (s: string) => s.split('\n').length - 1;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

// A token marked walks without `tokens`: a list's `items`, a table's `header`
// and `rows`. A table cell has no `raw` of its own; its text does.
interface Walkable {
  raw?: string;
  tokens?: Walkable[];
  items?: Walkable[];
  header?: Walkable[];
  rows?: Walkable[][];
  srcFrom?: number;
  srcTo?: number;
}

// Records where each token sits, walking `raw` from `base`. Children are
// searched inside their parent, so `**hello**` places `hello` after the stars.
// Lists and tables keep their children off `tokens`, and those are walked too,
// or a selection there has nothing to map back to the source.
export function placeTokens(src: string, tokens: readonly SrcToken[], base = 0): void {
  walkTokens(src, tokens, base);
}

function walkTokens(src: string, tokens: readonly Walkable[], base: number): number {
  let cursor = base;
  for (const t of tokens) {
    if (t.raw) {
      const at = src.indexOf(t.raw, cursor);
      const start = at < 0 ? cursor : at;
      t.srcFrom = start;
      t.srcTo = start + t.raw.length;
    }
    const origin = t.srcFrom ?? cursor;
    let child = origin;
    if (t.tokens?.length) child = walkTokens(src, t.tokens, origin);
    if (t.items?.length) child = walkTokens(src, t.items, origin);
    if (t.header?.length) child = walkTokens(src, t.header, origin);
    if (t.rows) for (const row of t.rows) child = walkTokens(src, row, child);
    cursor = t.srcTo ?? child;
  }
  return cursor;
}

const sourceSpan = (token: SrcToken, html: string): string =>
  token.srcFrom == null || token.srcTo == null
    ? html
    : `<span class="src" data-from="${token.srcFrom}" data-to="${token.srcTo}">${html}</span>`;

// The same renderer as `marked`, with a span on each leaf of text and each
// code span. A parent text token (it has children) is left as marked wrote it.
export function withSourceSpans(m: SpanMarked): MarkedLike {
  const renderer = new m.Renderer();
  const renderText = renderer.text.bind(renderer);
  const renderCode = renderer.codespan.bind(renderer);
  renderer.text = (token) => {
    const html = renderText(token);
    return token.tokens?.length ? html : sourceSpan(token, html);
  };
  renderer.codespan = (token) => sourceSpan(token, renderCode(token));
  return {
    lexer: (src) => m.lexer(src),
    parser: (tokens) => m.parser(tokens, { renderer }),
  };
}

// A caret in a preview span, as a source offset. When the rendered text is
// the source slice, the caret is exact. When it isn't (backticks, an entity),
// the start of the span stays put and anywhere else takes the whole token.
export function caretInSpan(spanFrom: number, spanTo: number, renderedLength: number, offset: number): number {
  const at = Math.max(0, Math.min(offset, renderedLength));
  if (renderedLength === spanTo - spanFrom) return spanFrom + at;
  return at === 0 ? spanFrom : spanTo;
}

// The exact source slice a preview selection covers, and the lines it sits on.
export function sourceQuote(
  src: string,
  from: number,
  to: number,
): { quote: string; from: number; to: number; fromLine: number; toLine: number } | null {
  if (from < 0 || to > src.length || from >= to) return null;
  const quote = src.slice(from, to);
  if (!quote.trim()) return null;
  return { quote, from, to, fromLine: lineAt(src, from), toLine: lineAt(src, to - 1) };
}

function lineAt(src: string, index: number): number {
  let line = 1;
  const end = Math.min(Math.max(index, 0), src.length);
  for (let i = 0; i < end; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// The Markdown preview, with each comment shown on the block it covers: the
// quote, the note, and an amber wrap. A lost comment is left out. Raw HTML
// blocks are not wrapped, so a tag that spans blocks still parses. The quote
// and the note are escaped; they are text from the file and from the user.
export function previewHtml(m: MarkedLike, src: string, comments: readonly Comment[]): string {
  const live = comments.filter((c) => !c.lost);
  let line = 1;
  let cursor = 0;
  let out = '';
  for (const t of m.lexer(src)) {
    placeTokens(src, [t], cursor);
    cursor = t.srcTo ?? cursor;
    const to = line + newlines(t.raw.replace(/\n+$/, ''));
    const html = t.type === 'space' || t.type === 'def' ? '' : m.parser([t]);
    const hit = live.filter((c) => c.fromLine <= to && c.toLine >= line);
    if (html && hit.length) {
      const notes = hit
        .map(
          (c) =>
            `<p class="tabsh-comment-note"><span class="tabsh-comment-quote">“${esc(oneLine(c.quote, QUOTE_MAX))}”</span>${esc(oneLine(c.note, NOTE_MAX))}</p>`,
        )
        .join('');
      out += t.type === 'html' ? notes + html : `<div class="tabsh-comment">${notes}${html}</div>`;
    } else out += html;
    line += newlines(t.raw);
  }
  return out;
}

// What Send pastes: one instruction, then one line per comment, in the order they were made.
export function commentMessage(path: string, comments: readonly Comment[]): string {
  return [
    `Make these changes to ${oneLine(path, PATH_MAX)} for me:`,
    ...comments.map((c) => `- ${linesLabel(c)}, "${oneLine(c.quote, QUOTE_MAX)}": ${oneLine(c.note, NOTE_MAX)}`),
  ].join('\n');
}

// One block per file that has comments, in the order the files were first noted.
export function projectMessage(files: readonly { path: string; comments: readonly Comment[] }[]): string {
  return files
    .filter((f) => f.comments.length)
    .map((f) => commentMessage(f.path, f.comments))
    .join('\n\n');
}

// Moves each comment with `changes`. An insertion at either edge stays outside
// the range. The quote is the original selection: once the text there differs,
// or the range collapses, the comment is lost and its lines stay as they were.
export function mapComments(doc: Text, changes: ChangeSet, comments: readonly Comment[]): Comment[] {
  if (changes.empty) return comments.slice();
  const next = changes.apply(doc);
  return comments.map((c) => {
    if (c.lost) return c;
    const from = changes.mapPos(c.from, 1);
    const to = changes.mapPos(c.to, -1);
    if (from >= to || next.sliceString(from, to) !== c.quote) return { ...c, lost: true };
    return { ...c, from, to, fromLine: next.lineAt(from).number, toLine: next.lineAt(to - 1).number };
  });
}
