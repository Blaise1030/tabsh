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

// Characters that must not reach the terminal: controls (Cc: C0, C1 and DEL;
// an ESC could end a bracketed paste early, ESC [201~, and have the shell run
// the rest), and the invisible characters that make text read differently
// from what it is: every format character (Cf: zero-width, bidi controls,
// soft hyphen…), the tag characters that can spell hidden ASCII (assigned
// or not), variation selectors, Hangul fillers and the combining grapheme
// joiner.
// (Combining marks in alternatives of their own, not in one class.)
const HIDDEN =
  /[\p{Cc}\p{Cf}\u{E0000}-\u{E007F}\u{115F}\u{1160}\u{3164}\u{FFA0}]|[\u{FE00}-\u{FE0F}]|[\u{E0100}-\u{E01EF}]|\u{034F}/gu;

// `s` on one line and safe to paste: hidden characters become spaces,
// whitespace runs one space, and past `max` characters it's cut with "…".
export function oneLine(s: string, max: number): string {
  const text = s.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
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
