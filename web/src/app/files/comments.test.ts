import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeSet, Text } from '@codemirror/state';
import { marked } from 'marked';
import {
  type Comment,
  caretInSpan,
  commentMessage,
  mapComments,
  oneLine,
  previewHtml,
  projectMessage,
  quoteParts,
  type SpanMarked,
  sourceQuote,
  withSourceSpans,
} from './comments.ts';

function comment(over: Partial<Comment> & Pick<Comment, 'from' | 'to' | 'quote'>): Comment {
  return { id: 1, fromLine: 1, toLine: 1, note: 'fix', lost: false, ...over };
}

function apply(src: string, from: number, to: number, insert: string, comments: readonly Comment[]): Comment[] {
  const text = Text.of(src.split('\n'));
  return mapComments(text, ChangeSet.of({ from, to, insert }, text.length), comments);
}

test('commentMessage is one instruction and one line per comment', () => {
  const msg = commentMessage('docs/plan.md', [
    comment({
      from: 0,
      to: 4,
      quote: 'tabsh has two parts:',
      fromLine: 3,
      toLine: 3,
      note: 'Make this a full sentence.',
    }),
    comment({
      id: 2,
      from: 10,
      to: 40,
      quote: 'The daemon also embeds a built copy of',
      fromLine: 7,
      toLine: 8,
      note: 'Say why it embeds\nthe app in one clause.',
    }),
  ]);
  assert.equal(
    msg,
    [
      'Make these changes to docs/plan.md for me:',
      '- line 3, "tabsh has two parts:": Make this a full sentence.',
      '- lines 7-8, "The daemon also embeds a built copy of": Say why it embeds the app in one clause.',
    ].join('\n'),
  );
});

test('oneLine collapses whitespace, cuts a long quote, and drops hidden characters', () => {
  assert.equal(oneLine('  a \n\t b  ', 20), 'a b');
  assert.equal(oneLine('abcdef', 4), 'abc…');
  assert.equal(oneLine('go\u001b[201~now', 20), 'go [201~now');
  assert.equal(oneLine('safe\u200bword', 20), 'safe word');
  assert.equal(oneLine('a\u202eb', 20), 'a b');
});

test('an edit outside a comment shifts it and keeps the quote', () => {
  const next = apply('hello', 0, 0, 'X', [comment({ from: 0, to: 5, quote: 'hello' })]);
  assert.deepEqual(next, [comment({ from: 1, to: 6, quote: 'hello' })]);
});

test('an edit inside a comment marks it lost and keeps its lines', () => {
  const next = apply('hello\nworld', 1, 1, 'X', [
    comment({ from: 0, to: 5, quote: 'hello', fromLine: 1, toLine: 1, note: 'keep' }),
  ]);
  assert.equal(next[0].lost, true);
  assert.equal(next[0].fromLine, 1);
  assert.equal(next[0].quote, 'hello');
});

test('inserting a line before a comment moves its line numbers', () => {
  const next = apply('hello', 0, 0, 'x\n', [comment({ from: 0, to: 5, quote: 'hello', fromLine: 1, toLine: 1 })]);
  assert.equal(next[0].lost, false);
  assert.equal(next[0].quote, 'hello');
  assert.equal(next[0].fromLine, 2);
  assert.equal(next[0].toLine, 2);
});

test('deleting a comment marks it lost', () => {
  const next = apply('hello', 0, 5, '', [comment({ from: 0, to: 5, quote: 'hello' })]);
  assert.equal(next[0].lost, true);
  assert.equal(next[0].fromLine, 1);
});

test('the preview shows a comment on the block it covers, with the quote escaped', () => {
  const src = 'One\n\nTwo\n';
  const html = previewHtml(marked, src, [
    comment({ from: 0, to: 3, quote: '<One>', fromLine: 1, toLine: 1, note: 'first' }),
  ]);
  assert.match(html, /tabsh-comment/);
  assert.match(html, /&lt;One&gt;/);
  assert.match(html, /first/);
  assert.equal(html.includes('<One>'), false);
  const two = html.slice(html.indexOf('Two'));
  assert.equal(two.includes('tabsh-comment'), false);
});

test('a lost comment is not drawn in the preview', () => {
  const html = previewHtml(marked, 'Hello\n', [comment({ from: 0, to: 5, quote: 'Hello', lost: true })]);
  assert.equal(html.includes('tabsh-comment'), false);
});

test('a lost comment stays lost', () => {
  const lost = comment({ from: 0, to: 5, quote: 'hello', lost: true });
  assert.deepEqual(apply('hello', 0, 0, 'X', [lost]), [lost]);
});

test('preview text remembers where it sits in the source, past the markdown marks', () => {
  const src = 'Say **hello** there\n';
  const html = previewHtml(withSourceSpans(marked as unknown as SpanMarked), src, []);
  assert.match(html, /data-from="6" data-to="11"/);
  assert.match(html, />hello</);
  assert.match(html, /data-from="13" data-to="19"/);
});

test('a list item and a table cell remember where they sit in the source', () => {
  const src = '1. **GATHER**: `ctx_batch` runs it.\n\n| Name |\n| --- |\n| GATHER |\n';
  const html = previewHtml(withSourceSpans(marked as unknown as SpanMarked), src, []);
  assert.match(html, /<li>[\s\S]*data-from="5" data-to="11"/);
  assert.match(html, /data-from="15" data-to="26"/);
  assert.match(html, /<td>[\s\S]*data-from="56" data-to="62"/);
});

test('a caret in a span is a source offset', () => {
  assert.equal(caretInSpan(6, 11, 5, 2), 8);
  assert.equal(caretInSpan(4, 13, 5, 0), 4);
  assert.equal(caretInSpan(4, 13, 5, 2), 13);
});

test('projectMessage is one block per file, skipping a file with no comments', () => {
  const msg = projectMessage([
    { path: 'src/main.rs', comments: [comment({ from: 0, to: 2, quote: 'fn', note: 'Say what main does.' })] },
    { path: 'empty.md', comments: [] },
    {
      path: 'README.md',
      comments: [comment({ id: 2, from: 0, to: 1, quote: '#', note: 'Explain the title.' })],
    },
  ]);
  assert.equal(
    msg,
    [
      'Make these changes to src/main.rs for me:',
      '- line 1, "fn": Say what main does.',
      '',
      'Make these changes to README.md for me:',
      '- line 1, "#": Explain the title.',
    ].join('\n'),
  );
});

test('quoteParts keeps the first line and the rest, and drops a heading mark', () => {
  assert.deepEqual(quoteParts('## For Multi-Line Quotes\n\nIf you need a multi-line quotation\n'), {
    lead: 'For Multi-Line Quotes',
    rest: 'If you need a multi-line quotation',
  });
  assert.deepEqual(quoteParts('fn main() {}'), { lead: 'fn main() {}', rest: '' });
});

test('sourceQuote is the exact slice and its lines', () => {
  assert.deepEqual(sourceQuote('one\ntwo\n', 4, 7), {
    quote: 'two',
    from: 4,
    to: 7,
    fromLine: 2,
    toLine: 2,
  });
  assert.equal(sourceQuote('one\ntwo\n', 1, 1), null);
});
