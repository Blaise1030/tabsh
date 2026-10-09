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
    [9, 9],
    [11, 11],
    [13, 13],
  ]);
});

test('every block carries the mark; blank lines and link definitions render nothing', () => {
  const html = renderBlocks(marked, 'see [it]\n\n[it]: https://example.com\n', MARK);
  assert.equal(html.match(/data-tabsh-block="/g)?.length, 1);
  assert.ok(html.includes(`data-tabsh-block="${MARK}"`));
  assert.ok(html.includes('href="https://example.com"'), 'a reference link still resolves');
});

// The output with its markers taken out.
const unmarked = (html: string) =>
  html.replace(/<template data-tabsh-block="[0-9a-f]{32}" data-from="\d+" data-to="\d+"><\/template>/g, '');

test('blocks are marked, not wrapped: raw HTML spanning blocks renders as it does without comments', () => {
  const docs = [
    '# T\n\n<details>\n<summary>More</summary>\n\nHidden **body**.\n\n</details>\n\nAfter.\n',
    '<div align="center">\n\n# Title\n\n</div>\n\npara\n',
    '<table>\n<tr>\n<td>\n\n**bold** cell\n\n</td>\n</tr>\n</table>\n',
  ];
  for (const src of docs) {
    const html = renderBlocks(marked, src, MARK);
    assert.equal(unmarked(html), marked.parse(src), src);
    // Every marker is empty: nothing of a block is inside one.
    assert.equal(html.match(/<template /g)?.length, html.match(/><\/template>/g)?.length);
    assert.ok(!html.includes('<div data-tabsh-block'));
  }
});

test('the body of a <details> is marked inside it, and nothing closes it early', () => {
  const src = '<details>\n<summary>More</summary>\n\nHidden body.\n\n</details>\n\nAfter.\n';
  const html = renderBlocks(marked, src, MARK);
  const open = html.indexOf('<details>');
  const body = html.indexOf('data-from="4"');
  const close = html.indexOf('</details>');
  assert.ok(open !== -1 && open < body && body < close, html);
  assert.equal(html.match(/<\/details>/g)?.length, 1);
  assert.ok(html.slice(open, close).includes('<p>Hidden body.</p>'));
  assert.deepEqual(ranges(html), [
    [1, 2],
    [4, 4],
    [6, 6],
    [8, 8],
  ]);
});

test('a mark that is not long hex is refused', () => {
  assert.throws(() => renderBlocks(marked, 'x', 'abc'));
  assert.throws(() => renderBlocks(marked, 'x', `${MARK}" onclick="x`));
});

test('oneLine makes control, zero-width and bidi characters spaces, and collapses whitespace', () => {
  assert.equal(oneLine('a\u001b[201~b', 100), 'a [201~b');
  assert.equal(oneLine('a\u0000b\u007fc\u0085d', 100), 'a b c d');
  assert.equal(oneLine('x\u200by\u202ez\u2066w\ufeffv', 100), 'x y z w v');
  assert.equal(oneLine('  one\n\n two\tthree  ', 100), 'one two three');
  assert.equal(oneLine('a\u2060b\u061cc\u180ed\u00ade', 100), 'a b c d e');
});

test('oneLine makes tag characters spaces, so no hidden ASCII reaches Claude', () => {
  // "hi" spelled in tag characters, invisible in the file.
  assert.equal(oneLine('a\u{E0068}\u{E0069}b', 100), 'a b');
  assert.equal(oneLine('x\u{E0000}y\u{E0001}z\u{E007F}w', 100), 'x y z w');
});

test('oneLine makes every other invisible character a space', () => {
  const invisible = [
    '\u{FE00}', // variation selectors
    '\u{FE0F}',
    '\u{E0100}',
    '\u{E01EF}',
    '\u{115F}', // Hangul fillers
    '\u{1160}',
    '\u{3164}',
    '\u{FFA0}',
    '\u{034F}', // combining grapheme joiner
    '\u{FFF9}', // interlinear annotation
    '\u{FFFA}',
    '\u{FFFB}',
    '\u{06DD}', // Arabic end of ayah
    '\u{2028}', // line and paragraph separators
    '\u{2029}',
  ];
  for (const c of invisible) {
    assert.equal(oneLine(`a${c}b`, 50), 'a b', `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`);
  }
  // Visible text, accents and emoji are kept.
  assert.equal(oneLine('café ñ 😀 日本', 50), 'café ñ 😀 日本');
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
