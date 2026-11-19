// The board's filter queries, with no DOM: `tag:ide (tag:bug or tag:urgent)
// -tag:wip folder:~/app status:"needs input"`. A space or `and` means both,
// `or` either, `-` or `not` excludes, brackets group; `not` binds tightest,
// then `and`, then `or`.

import { STATUS_NAMES } from './glyph.ts';
import { STATUSES, type Status, shortPath } from './model.ts';

export type Field = 'tag' | 'folder' | 'status';
const FIELDS: Field[] = ['tag', 'folder', 'status'];

export type QueryNode =
  | { kind: 'term'; field: Field; value: string; start: number; end: number }
  | { kind: 'not'; child: QueryNode }
  | { kind: 'and'; children: QueryNode[] }
  | { kind: 'or'; children: QueryNode[] };

export interface QueryError {
  message: string;
  start: number;
  end: number;
}

export type Parsed = { ok: true; node: QueryNode | null } | { ok: false; error: QueryError };

// What a query is matched against: one card.
export interface Subject {
  status: Status;
  cwd: string | null;
  tags: string[];
}

type Token =
  | { type: '(' | ')' | 'not' | 'and' | 'or'; start: number; end: number }
  | { type: 'term'; field: Field; value: string; start: number; end: number }
  | { type: 'bare'; word: string; start: number; end: number };

class Fail extends Error {
  error: QueryError;
  constructor(error: QueryError) {
    super(error.message);
    this.error = error;
  }
}
const fail = (message: string, start: number, end: number): never => {
  throw new Fail({ message, start, end });
};

const isSpace = (c: string): boolean => /\s/.test(c);
const stops = (c: string): boolean => isSpace(c) || c === '(' || c === ')';

// A status named by its id (`needs_input`) or its name (`needs input`).
export function statusOf(value: string): Status | null {
  const v = value.trim().toLowerCase();
  const id = v.replace(/\s+/g, '_');
  if (STATUSES.includes(id as Status)) return id as Status;
  return STATUSES.find((s) => STATUS_NAMES[s].toLowerCase() === v) ?? null;
}

// A quoted value from `"` at `i`: its text and the index past its closing quote.
function readQuoted(text: string, i: number): { value: string; end: number } {
  let value = '';
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) {
      value += text[j + 1];
      j += 2;
    } else if (c === '"') {
      return { value, end: j + 1 };
    } else {
      value += c;
      j++;
    }
  }
  return fail('Unclosed quote', i, text.length);
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (isSpace(c)) {
      i++;
    } else if (c === '(' || c === ')') {
      out.push({ type: c, start: i, end: i + 1 });
      i++;
    } else if (c === '-' && i + 1 < text.length && !isSpace(text[i + 1]) && !')-'.includes(text[i + 1])) {
      out.push({ type: 'not', start: i, end: i + 1 });
      i++;
    } else {
      const start = i;
      while (i < text.length && !stops(text[i]) && text[i] !== ':') i++;
      const word = text.slice(start, i);
      if (text[i] !== ':') {
        const kw = word.toLowerCase();
        if (kw === 'and' || kw === 'or' || kw === 'not') out.push({ type: kw, start, end: i });
        else out.push({ type: 'bare', word, start, end: i });
        continue;
      }
      const name = word.toLowerCase();
      const field = FIELDS.find((f) => f === name);
      i++; // the colon
      let value: string;
      if (text[i] === '"') {
        const q = readQuoted(text, i);
        value = q.value;
        i = q.end;
      } else {
        const from = i;
        while (i < text.length && !stops(text[i])) i++;
        value = text.slice(from, i);
      }
      if (!field) fail(`Unknown field "${word}". Use tag:, folder: or status:`, start, i);
      if (!value) fail(`Missing a value after "${word}:"`, start, i);
      if (field === 'status' && !statusOf(value)) fail(`Unknown status "${value}"`, start, i);
      out.push({ type: 'term', field: field as Field, value, start, end: i });
    }
  }
  return out;
}

class Parser {
  i = 0;
  tokens: Token[];
  length: number;
  constructor(tokens: Token[], length: number) {
    this.tokens = tokens;
    this.length = length;
  }
  peek(): Token | undefined {
    return this.tokens[this.i];
  }
  or(): QueryNode {
    const children = [this.and()];
    while (this.peek()?.type === 'or') {
      const op = this.tokens[this.i++];
      const next = this.peek();
      if (!next || next.type === ')' || next.type === 'or') fail('Nothing after "or"', op.start, op.end);
      children.push(this.and());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  }
  and(): QueryNode {
    const children = [this.unary()];
    for (;;) {
      const t = this.peek();
      if (!t || t.type === ')' || t.type === 'or') break;
      if (t.type === 'and') {
        this.i++;
        const next = this.peek();
        if (!next || next.type === ')' || next.type === 'or' || next.type === 'and')
          fail('Nothing after "and"', t.start, t.end);
      }
      children.push(this.unary());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  }
  unary(): QueryNode {
    const t = this.peek();
    if (t?.type === 'not') {
      this.i++;
      if (!this.peek() || ['or', 'and', ')'].includes(this.peek()?.type ?? ''))
        fail('Nothing after "not"', t.start, t.end);
      return { kind: 'not', child: this.unary() };
    }
    return this.atom();
  }
  atom(): QueryNode {
    const t = this.peek();
    if (!t) return fail('Unexpected end of query', this.length, this.length);
    this.i++;
    switch (t.type) {
      case 'term':
        return { kind: 'term', field: t.field, value: t.value, start: t.start, end: t.end };
      case 'bare':
        return fail(`Unknown term "${t.word}". Did you mean ${formatTerm('tag', t.word)}?`, t.start, t.end);
      case '(': {
        if (this.peek()?.type === ')') fail('Empty brackets', t.start, (this.peek() as Token).end);
        const inner = this.or();
        if (this.peek()?.type !== ')') fail('Missing ")"', t.start, t.end);
        this.i++;
        return inner;
      }
      case ')':
        return fail('Unmatched ")"', t.start, t.end);
      default:
        return fail(`Nothing before "${t.type}"`, t.start, t.end);
    }
  }
}

export function parseQuery(text: string): Parsed {
  try {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { ok: true, node: null };
    const p = new Parser(tokens, text.length);
    const node = p.or();
    const rest = p.peek();
    if (rest) fail(rest.type === ')' ? 'Unmatched ")"' : 'Unexpected text', rest.start, rest.end);
    return { ok: true, node };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.error };
    throw e;
  }
}

function folderMatches(value: string, cwd: string | null): boolean {
  if (!cwd) return false;
  const v = value.length > 1 ? value.replace(/\/+$/, '') : value;
  return [cwd, shortPath(cwd)].some((c) => c === v || c.startsWith(v.endsWith('/') ? v : `${v}/`));
}

export function matches(node: QueryNode | null, s: Subject): boolean {
  if (!node) return true;
  switch (node.kind) {
    case 'term': {
      if (node.field === 'tag') {
        const v = node.value.toLowerCase();
        return s.tags.some((t) => t.toLowerCase() === v);
      }
      if (node.field === 'folder') return folderMatches(node.value, s.cwd);
      return statusOf(node.value) === s.status;
    }
    case 'not':
      return !matches(node.child, s);
    case 'and':
      return node.children.every((c) => matches(c, s));
    case 'or':
      return node.children.some((c) => matches(c, s));
  }
}

// A term as it's written in a query, quoted when its value needs it.
export function formatTerm(field: Field, value: string): string {
  if (value && !/[\s()"\\]/.test(value)) return `${field}:${value}`;
  return `${field}:"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

type Term = Extract<QueryNode, { kind: 'term' }>;

const sameValue = (field: Field, a: string, b: string): boolean =>
  field === 'folder' ? a.replace(/(.)\/+$/, '$1') === b.replace(/(.)\/+$/, '$1') : a.toLowerCase() === b.toLowerCase();

// The terms a checkbox owns: plain positive terms the whole query must have.
function topTerms(node: QueryNode | null): Term[] {
  if (node?.kind === 'term') return [node];
  if (node?.kind === 'and') return node.children.filter((c): c is Term => c.kind === 'term');
  return [];
}

function findTop(text: string, field: 'tag' | 'folder', value: string): Term[] | null {
  const p = parseQuery(text);
  if (!p.ok) return null;
  return topTerms(p.node).filter((t) => t.field === field && sameValue(field, t.value, value));
}

// Whether a checkbox for `value` shows ticked.
export function hasTerm(text: string, field: 'tag' | 'folder', value: string): boolean {
  return (findTop(text, field, value) ?? []).length > 0;
}

// The query with `field:value` required too. Under a top-level `or` the query
// is bracketed first, so it keeps its meaning.
export function withTerm(text: string, field: 'tag' | 'folder', value: string): string {
  if (hasTerm(text, field, value)) return text;
  const term = formatTerm(field, value);
  const rest = text.trim();
  if (!rest) return term;
  const p = parseQuery(rest);
  return p.ok && p.node?.kind === 'or' ? `(${rest}) ${term}` : `${rest} ${term}`;
}

// `text` without the spans given, each taking the space after it (or before
// it, at the end), and without an `and`, `or` or `not` left dangling.
function cut(text: string, spans: { start: number; end: number }[]): string {
  let out = text;
  for (const { start, end } of [...spans].sort((a, b) => b.start - a.start)) {
    let a = start;
    let b = end;
    while (b < out.length && isSpace(out[b])) b++;
    if (b === out.length) while (a > 0 && isSpace(out[a - 1])) a--;
    out = out.slice(0, a) + out.slice(b);
  }
  return out
    .replace(/(^|\s)and\s+(?=and\b)/gi, '$1')
    .replace(/^\s*and\s+/i, '')
    .replace(/(\s+(and|or|not)|\s*-|\s*\()+\s*$/i, '')
    .trim();
}

export function withoutTerm(text: string, field: 'tag' | 'folder', value: string): string {
  const found = findTop(text, field, value);
  if (!found?.length) return text;
  return cut(text, found);
}

// What autocomplete offers at the caret: a field name while a bare word is
// typed (`field: null`), else the value after `field:`. `start`..`end` is
// the span a pick replaces (a quoted value's span takes in its quote).
export interface Completion {
  field: Field | null;
  partial: string;
  start: number;
  end: number;
}

export function completionAt(text: string, caret: number): Completion | null {
  const before = text.slice(0, caret);
  // Inside an open quote: the value since it.
  const quotes = before.replace(/\\./g, '').split('"').length - 1;
  if (quotes % 2 === 1) {
    const q = before.lastIndexOf('"');
    const m = /([A-Za-z]+):$/.exec(before.slice(0, q));
    const field = FIELDS.find((f) => f === m?.[1].toLowerCase());
    return field ? { field, partial: before.slice(q + 1).replace(/\\(.)/g, '$1'), start: q, end: caret } : null;
  }
  let start = caret;
  while (start > 0 && !stops(text[start - 1]) && text[start - 1] !== '"') start--;
  if (text[start] === '-') start++;
  let end = caret;
  while (end < text.length && !stops(text[end])) end++;
  const word = text.slice(start, caret);
  if (!word) return null;
  const colon = word.indexOf(':');
  if (colon < 0) {
    if (['and', 'or', 'not'].includes(word.toLowerCase())) return null;
    return { field: null, partial: word, start, end };
  }
  const field = FIELDS.find((f) => f === word.slice(0, colon).toLowerCase());
  if (!field || word[colon + 1] === '"') return null; // a closed quote is a finished value
  return { field, partial: word.slice(colon + 1), start: start + colon + 1, end };
}

// The tags and folders (as `shortPath` shows them) in use.
export interface Known {
  tags: string[];
  folders: string[];
}

function candidates(field: Field, known: Known): string[] {
  if (field === 'tag') return known.tags;
  if (field === 'folder') return known.folders;
  return STATUSES.flatMap((s) => [s, STATUS_NAMES[s]]);
}

// The text to apply while a query is being typed: a last value the caret is
// still at the end of, naming nothing in use but the start of something, is
// left out until it's finished, so `tag:b` on its way to `tag:bug` doesn't
// empty the board (and `status:need` isn't an error yet).
export function liveText(text: string, caret: number, known: Known): string {
  const c = completionAt(text, caret);
  if (!c?.field || c.end !== caret || text.slice(caret).trim()) return text;
  const v = c.partial.toLowerCase();
  const names = candidates(c.field, known).map((x) => x.toLowerCase());
  if (names.includes(v) || !names.some((x) => x.startsWith(v))) return text;
  const rest = cut(text, [{ start: c.start - c.field.length - 1, end: caret }]);
  return parseQuery(rest).ok ? rest : text;
}

export function liveQuery(text: string, caret: number, known: Known): Parsed {
  return parseQuery(liveText(text, caret, known));
}

// What autocomplete lists for a completion, at most 8: field names for a bare
// word, else the values in use containing what's typed (ignoring case). Each
// `insert` replaces the completion's span.
export function suggestionsFor(c: Completion, known: Known): { label: string; insert: string }[] {
  const typed = c.partial.toLowerCase();
  if (!c.field) {
    return FIELDS.map((f) => `${f}:`)
      .filter((f) => f.startsWith(typed))
      .map((f) => ({ label: f, insert: f }));
  }
  const field = c.field;
  const values = field === 'status' ? STATUSES.map((s) => STATUS_NAMES[s]) : candidates(field, known);
  return values
    .filter((v) => v.toLowerCase().includes(typed) && v.toLowerCase() !== typed)
    .slice(0, 8)
    .map((v) => ({ label: v, insert: formatTerm(field, v).slice(field.length + 1) }));
}

// The old filter, `{ tags, folders }` (a card needed any checked tag and any
// checked folder), as the query that means the same.
export function migrateFilter(raw: unknown): string {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  const group = (terms: string[]): string => (terms.length > 1 ? `(${terms.join(' or ')})` : (terms[0] ?? ''));
  return [
    group(strings(o.tags).map((t) => formatTerm('tag', t))),
    group(strings(o.folders).map((f) => formatTerm('folder', shortPath(f)))),
  ]
    .filter(Boolean)
    .join(' ');
}
