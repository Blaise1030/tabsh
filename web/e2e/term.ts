// A test-only reader for xterm's buffer. The app page is CSP-locked and has no
// debug API, so the reader intercepts the UMD global before it opens a
// terminal: the CDN script assigns window.Terminal, and open() receives the
// `.term` element (whose class says whether that terminal is the one on
// screen). Nothing here is loaded by the app.
import type { Page } from '@playwright/test';

type Captured = {
  term: {
    cols: number;
    rows: number;
    buffer: {
      active: {
        viewportY: number;
        getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
      };
    };
  };
  el: HTMLElement;
};

declare global {
  interface Window {
    __terms?: Captured[];
  }
}

export function installTerminalSpy(): void {
  const terms: Captured[] = [];
  window.__terms = terms;
  let Terminal: unknown;
  Object.defineProperty(window, 'Terminal', {
    configurable: true,
    get: () => Terminal,
    set: (value) => {
      Terminal = value;
      const proto = (value as { prototype: { open(el: HTMLElement): void } }).prototype;
      const open = proto.open;
      proto.open = function (this: Captured['term'], el: HTMLElement) {
        terms.push({ term: this, el });
        return open.call(this, el);
      };
    },
  });
}

export function termText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = window.__terms?.find((t) => t.el.classList.contains('active'));
    if (!state) return '';
    const buf = state.term.buffer.active;
    const lines: string[] = [];
    for (let y = buf.viewportY; y < buf.viewportY + state.term.rows; y++) {
      lines.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  });
}

export async function termLines(page: Page): Promise<string[]> {
  return (await termText(page)).split('\n');
}

export function termCols(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__terms?.find((t) => t.el.classList.contains('active'))?.term.cols ?? 0,
  );
}

// The center of the cell where `needle` starts, on the last visible line that
// contains it. Link clicks need a point inside the linkified cell; a buffer
// line and column is the only stable way to find it under either renderer.
export async function termCellPoint(page: Page, needle: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((text) => {
    const state = window.__terms?.find((t) => t.el.classList.contains('active'));
    const screen = state?.el.querySelector<HTMLElement>('.xterm-screen');
    if (!state || !screen) return null;
    const box = screen.getBoundingClientRect();
    const buf = state.term.buffer.active;
    for (let y = buf.viewportY + state.term.rows - 1; y >= buf.viewportY; y--) {
      const line = buf.getLine(y)?.translateToString(true) ?? '';
      const column = line.lastIndexOf(text);
      if (column < 0) continue;
      return {
        x: box.x + ((column + 0.5) * box.width) / state.term.cols,
        y: box.y + ((y - buf.viewportY + 0.5) * box.height) / state.term.rows,
      };
    }
    return null;
  }, needle);
  if (!point) throw new Error(`termCellPoint: ${JSON.stringify(needle)} is not on screen`);
  return point;
}
