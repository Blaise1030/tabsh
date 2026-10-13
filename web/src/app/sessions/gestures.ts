// The arithmetic behind a terminal's touch gestures (sessions/touch.ts):
// pinching the font size, scrolling by whole lines, selecting words. Pure.

export const MIN_FONT = 8;
export const MAX_FONT = 28;

// The font size a pinch reaches: the starting size scaled by how far the
// fingers moved apart, whole pixels, within MIN_FONT..MAX_FONT.
export function pinchFont(start: number, startGap: number, gap: number): number {
  const size = Math.round((start * gap) / Math.max(1, startGap));
  return Math.min(MAX_FONT, Math.max(MIN_FONT, size));
}

// A finger's travel (with what's left over from before) as whole lines to
// scroll, and the pixels left over for next time. Up the screen is positive.
export function linesFor(travel: number, lineHeight: number): [number, number] {
  const n = Math.trunc(travel / lineHeight);
  return [n, travel - n * lineHeight];
}

// The word under a column: the run of non-blank characters around it, as
// [start, length], or null on a blank.
export function wordAt(text: string, col: number): [number, number] | null {
  if (col < 0 || col >= text.length || text[col] === ' ') return null;
  let start = col;
  while (start > 0 && text[start - 1] !== ' ') start -= 1;
  let end = col + 1;
  while (end < text.length && text[end] !== ' ') end += 1;
  return [start, end - start];
}

export interface Cell {
  col: number;
  row: number;
}

// The selection from one cell to another, in either order, inclusive, as
// xterm's select(column, row, length) takes it.
export function spanBetween(a: Cell, b: Cell, cols: number): [number, number, number] {
  const [from, to] = a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a];
  return [from.col, from.row, (to.row - from.row) * cols + to.col - from.col + 1];
}
