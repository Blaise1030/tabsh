// The messages between the pane (annotate.ts) and a Markdown preview's frame
// script (preview-frame.ts). Each side parses what it receives with these,
// rebuilding it from the fields it expects, and drops anything else. A field
// is read once, and only as an own data property: an inherited property or a
// getter counts as absent. No DOM: node --test loads this.

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
// nth is -1 for "no index"; otherwise it names one of the `of` matches.
const nthOk = (nth: number, of: number): boolean => nth === -1 || nth < of;

// A message's own data field, read once: never an inherited property, never a getter.
function field(d: Obj, key: string): unknown {
  const desc = Object.getOwnPropertyDescriptor(d, key);
  return desc && 'value' in desc ? desc.value : undefined;
}

function rect(v: unknown): Rect | null {
  if (!isObj(v)) return null;
  const top = field(v, 'top');
  const bottom = field(v, 'bottom');
  const left = field(v, 'left');
  const right = field(v, 'right');
  if (!isNum(top) || !isNum(bottom) || !isNum(left) || !isNum(right)) return null;
  return { top, bottom, left, right };
}

export function parseFromFrame(d: unknown): FromFrame | null {
  if (!isObj(d)) return null;
  switch (field(d, 'type')) {
    case 'ready':
      return { type: 'ready' };
    case 'clear':
      return { type: 'clear' };
    case 'unhover':
      return { type: 'unhover' };
    case 'scroll':
      return { type: 'scroll' };
    case 'select': {
      const sel = field(d, 'sel');
      const quote = field(d, 'quote');
      const from = field(d, 'from');
      const to = field(d, 'to');
      const nth = field(d, 'nth');
      const of = field(d, 'of');
      const r = rect(field(d, 'rect'));
      if (!r || !isInt(sel, 1) || !isQuote(quote) || !isInt(from, 1) || !isInt(to, from)) return null;
      if (!isInt(nth, -1) || !isInt(of, 0) || !nthOk(nth, of)) return null;
      return { type: 'select', sel, quote, from, to, nth, of, rect: r };
    }
    case 'hover': {
      const id = field(d, 'id');
      const r = rect(field(d, 'rect'));
      return r && isInt(id, 1) ? { type: 'hover', id, rect: r } : null;
    }
    case 'located': {
      const id = field(d, 'id');
      const from = field(d, 'from');
      const to = field(d, 'to');
      return isInt(id, 1) && isInt(from, 1) && isInt(to, from) ? { type: 'located', id, from, to } : null;
    }
    case 'lost': {
      const id = field(d, 'id');
      return isInt(id, 1) ? { type: 'lost', id } : null;
    }
    default:
      return null;
  }
}

export function parseToFrame(d: unknown): ToFrame | null {
  if (!isObj(d)) return null;
  switch (field(d, 'type')) {
    case 'keep': {
      const id = field(d, 'id');
      const sel = field(d, 'sel');
      return isInt(id, 1) && isInt(sel, 1) ? { type: 'keep', id, sel } : null;
    }
    case 'drop': {
      const id = field(d, 'id');
      return isInt(id, 1) ? { type: 'drop', id } : null;
    }
    case 'dropAll':
      return { type: 'dropAll' };
    case 'locate': {
      const id = field(d, 'id');
      const quote = field(d, 'quote');
      const from = field(d, 'from');
      const nth = field(d, 'nth');
      const of = field(d, 'of');
      if (!isInt(id, 1) || !isQuote(quote) || !isInt(from, 1) || !isInt(nth, -1) || !isInt(of, 0)) return null;
      return nthOk(nth, of) ? { type: 'locate', id, quote, from, nth, of } : null;
    }
    case 'theme': {
      const css = field(d, 'css');
      return typeof css === 'string' && css.length <= MAX_CSS ? { type: 'theme', css } : null;
    }
    default:
      return null;
  }
}
