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
