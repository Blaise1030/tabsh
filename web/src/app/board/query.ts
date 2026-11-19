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
