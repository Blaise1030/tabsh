// A terminal's touch gestures, in place of xterm's own pixel-by-pixel touch
// scrolling: one finger scrolls the scrollback by whole lines, a long press
// selects a word (dragging on extends it; lifting copies it), and two fingers
// pinch this device's font size. Full-screen programs (vim, tmux) keep
// xterm's handling, which hands them the scroll.
import type { Terminal } from '@xterm/xterm';
import { setDeviceFontSize } from '../settings/settings.ts';
import { type Cell, linesFor, pinchFont, spanBetween, wordAt } from './gestures.ts';

const LONG_PRESS_MS = 450;
const SLOP_PX = 8;

const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export function watchTouch(term: Terminal, el: HTMLElement): void {
  let mode: 'idle' | 'scroll' | 'select' | 'pinch' = 'idle';
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let carry = 0;
  let pressTimer = 0;
  let anchor: Cell | null = null;
  let startGap = 0;
  let startFont = 0;

  const cellAt = (x: number, y: number): Cell | null => {
    const screen = el.querySelector('.xterm-screen');
    if (!screen) return null;
    const r = screen.getBoundingClientRect();
    const col = Math.floor(((x - r.left) / r.width) * term.cols);
    const row = Math.floor(((y - r.top) / r.height) * term.rows);
    return {
      col: Math.min(term.cols - 1, Math.max(0, col)),
      row: Math.min(term.rows - 1, Math.max(0, row)) + term.buffer.active.viewportY,
    };
  };
  const lineHeight = () => (el.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? 0) / term.rows;
  const ownsScroll = () => term.buffer.active.type === 'normal';

  el.addEventListener(
    'touchstart',
    (e) => {
      window.clearTimeout(pressTimer);
      if (e.touches.length === 2) {
        mode = 'pinch';
        startGap = gap(e.touches);
        startFont = term.options.fontSize ?? 14;
        return;
      }
      if (e.touches.length !== 1) return;
      mode = 'idle';
      ({ clientX: startX, clientY: startY } = e.touches[0]);
      lastY = startY;
      carry = 0;
      pressTimer = window.setTimeout(() => {
        const cell = cellAt(startX, startY);
        const text = cell && term.buffer.active.getLine(cell.row)?.translateToString();
        const word = cell && text ? wordAt(text, cell.col) : null;
        if (!cell || !word) return;
        mode = 'select';
        anchor = { col: word[0], row: cell.row };
        term.select(word[0], cell.row, word[1]);
      }, LONG_PRESS_MS);
    },
    { capture: true, passive: true },
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (mode === 'pinch') {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        const size = pinchFont(startFont, startGap, gap(e.touches));
        if (size !== term.options.fontSize) term.options.fontSize = size;
        return;
      }
      const t = e.touches[0];
      if (mode === 'select') {
        e.preventDefault();
        e.stopPropagation();
        const cell = cellAt(t.clientX, t.clientY);
        if (anchor && cell) term.select(...spanBetween(anchor, cell, term.cols));
        return;
      }
      if (mode === 'idle') {
        if (Math.hypot(t.clientX - startX, t.clientY - startY) < SLOP_PX) return;
        window.clearTimeout(pressTimer);
        if (!ownsScroll()) return;
        mode = 'scroll';
      }
      if (mode !== 'scroll') return;
      e.preventDefault();
      e.stopPropagation();
      const [lines, rest] = linesFor(lastY - t.clientY + carry, lineHeight() || 16);
      carry = rest;
      lastY = t.clientY;
      if (lines) term.scrollLines(lines);
    },
    { capture: true, passive: false },
  );

  const end = (e: TouchEvent) => {
    window.clearTimeout(pressTimer);
    if (mode === 'pinch' && e.touches.length < 2) {
      if (term.options.fontSize !== startFont) setDeviceFontSize(term.options.fontSize ?? startFont);
      mode = 'idle';
    } else if (mode === 'select' && e.touches.length === 0) {
      if (term.hasSelection()) navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      mode = 'idle';
    } else if (e.touches.length === 0) {
      mode = 'idle';
    }
  };
  el.addEventListener('touchend', end, { capture: true, passive: true });
  el.addEventListener('touchcancel', end, { capture: true, passive: true });
}
