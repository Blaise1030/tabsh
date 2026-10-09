// Runs inside a Markdown preview's frame and nowhere else: an opaque origin
// under its own CSP (pane.ts's markdownDoc). It reports selections and hovers
// to the pane and draws the comments' highlights; the comments' text stays
// with the pane. Built as its own classic script: pane.ts imports its URL
// (`?worker&url`), so nothing else in the app bundles it.
import { type FromFrame, MAX_QUOTE, parseToFrame, type Rect } from './frame-protocol.ts';

// The Markdown can name this script again (the frame's CSP allows it): only
// the first copy runs. A symbol, so no element's id can stand in for it.
const RAN = Symbol.for('tabsh.preview-frame');

interface Spot {
  node: Text;
  offset: number;
  line: number; // the source line its block starts on
}

function start(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[RAN]) return;
  g[RAN] = true;
  // Taken now, before the Markdown is parsed: a named element in it (a form
  // control called parentElement, an <img name="querySelectorAll">) can shadow
  // these on an element or the document later, and must not steer this script.
  const parentOf = Object.getOwnPropertyDescriptor(Node.prototype, 'parentElement')?.get as (
    this: Node,
  ) => Element | null;
  const attr = Element.prototype.getAttribute;
  const closest = Element.prototype.closest;
  const query = Document.prototype.querySelectorAll;
  const walker = Document.prototype.createTreeWalker;
  const newRange = Document.prototype.createRange;
  // Without the Custom Highlight API there are no comments; the preview still shows.
  if (typeof Highlight === 'undefined' || !('highlights' in CSS)) return;
  // Taken now, while this script is the last thing parsed: nothing in the
  // Markdown below it can stand in for either.
  const self = document.currentScript;
  const theme = document.getElementById('tabsh-theme');
  const mark = self instanceof HTMLScriptElement ? new URL(self.src).searchParams.get('m') : null;
  if (!mark || !/^[0-9a-f]{32}$/.test(mark) || !(theme instanceof HTMLStyleElement)) return;

  const post = (m: FromFrame) => parent.postMessage(m, '*');
  const highlight = new Highlight();
  CSS.highlights.set('tabsh-comment', highlight);
  const kept = new Map<number, Range>(); // comment id → its passage
  const picks = new Map<number, Range>(); // selections reported, by number, until kept
  let picked = 0;
  let over: number | null = null;
  let frame = 0;

  // The nearest enclosing block of this render, by its mark.
  const blockOf = (node: Node | null): Element | null => {
    let el = node instanceof Element ? node : node ? parentOf.call(node) : null;
    // Bounded, as a belt and braces against any loop.
    for (let steps = 0; el && steps < 10000; steps++, el = parentOf.call(el)) {
      if (attr.call(el, 'data-tabsh-block') === mark) return el;
    }
    return null;
  };
  const lineOf = (el: Element, which: 'from' | 'to') => Number(attr.call(el, `data-${which}`));
  const box = (r: DOMRect): Rect => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  // The text of this render's blocks with whitespace runs as one space (blocks
  // apart by one), and where each of its characters came from.
  function index(): { flat: string; at: Spot[] } {
    let flat = '';
    const at: Spot[] = [];
    for (const block of query.call(document, `[data-tabsh-block="${mark}"]`)) {
      const line = lineOf(block, 'from');
      if (flat && !flat.endsWith(' ')) {
        flat += ' ';
        at.push(at[at.length - 1]);
      }
      const walk = walker.call(document, block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const p = parentOf.call(n);
          return p && closest.call(p, 'script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = (n as Text).data;
        for (let i = 0; i < text.length; i++) {
          const space = /\s/.test(text[i]);
          if (space && (flat === '' || flat.endsWith(' '))) continue;
          flat += space ? ' ' : text[i];
          at.push({ node: n as Text, offset: i, line });
        }
      }
    }
    return { flat, at };
  }

  function matches(flat: string, want: string): number[] {
    const found: number[] = [];
    if (want) for (let i = flat.indexOf(want); i !== -1; i = flat.indexOf(want, i + 1)) found.push(i);
    return found;
  }

  function report(): void {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const quote = sel.toString().slice(0, MAX_QUOTE);
    if (!quote.trim()) return;
    const range = sel.getRangeAt(0);
    const a = blockOf(range.startContainer);
    const b = blockOf(range.endContainer);
    if (!a || !b) return;
    // Which of the quote's matches this is, so it can be found again after
    // lines are added above it.
    const { flat, at } = index();
    const found = matches(flat, squash(quote));
    const nth = found.findIndex((i) => range.isPointInRange(at[i].node, at[i].offset));
    picked++;
    picks.set(picked, range.cloneRange());
    if (picks.size > 20) picks.delete(picks.keys().next().value as number);
    post({
      type: 'select',
      sel: picked,
      quote,
      from: lineOf(a, 'from'),
      to: lineOf(b, 'to'),
      nth,
      of: found.length,
      rect: box(range.getBoundingClientRect()),
    });
  }

  // A comment's passage found again after a re-render: the same match while
  // the quote has as many matches as when it was made, else the match whose
  // block starts nearest `from`.
  function locate(quote: string, from: number, nth: number, of: number): Range | null {
    const { flat, at } = index();
    const want = squash(quote);
    const found = matches(flat, want);
    if (!found.length) return null;
    const near = found.reduce((a, b) => (Math.abs(at[b].line - from) < Math.abs(at[a].line - from) ? b : a));
    const first = nth >= 0 && found.length === of ? found[nth] : near;
    const last = at[first + want.length - 1];
    const range = newRange.call(document);
    range.setStart(at[first].node, at[first].offset);
    range.setEnd(last.node, last.offset + 1);
    return range;
  }

  // The comment under the pointer, if any.
  function hit(x: number, y: number): [number, DOMRect] | null {
    for (const [id, range] of kept) {
      for (const r of range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return [id, r];
      }
    }
    return null;
  }
  const leave = () => {
    if (over === null) return;
    over = null;
    post({ type: 'unhover' });
  };

  document.addEventListener('mousedown', () => post({ type: 'clear' }));
  // After the browser has settled the selection.
  document.addEventListener('mouseup', () => setTimeout(report));
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey) report();
  });
  document.addEventListener('mousemove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const sel = getSelection();
      const h = sel && !sel.isCollapsed ? null : hit(e.clientX, e.clientY);
      if ((h ? h[0] : null) === over) return;
      over = h ? h[0] : null;
      post(h ? { type: 'hover', id: h[0], rect: box(h[1]) } : { type: 'unhover' });
    });
  });
  document.documentElement.addEventListener('mouseleave', leave);
  addEventListener(
    'scroll',
    () => {
      leave();
      post({ type: 'scroll' });
    },
    { passive: true },
  );

  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = parseToFrame(e.data);
    if (!m) return;
    switch (m.type) {
      case 'keep': {
        const range = picks.get(m.sel);
        picks.delete(m.sel);
        if (!range) post({ type: 'lost', id: m.id });
        else if (!kept.has(m.id)) {
          kept.set(m.id, range);
          highlight.add(range);
        }
        getSelection()?.removeAllRanges();
        break;
      }
      case 'drop': {
        const range = kept.get(m.id);
        if (range) highlight.delete(range);
        kept.delete(m.id);
        leave();
        break;
      }
      case 'dropAll':
        highlight.clear();
        kept.clear();
        leave();
        break;
      case 'locate': {
        if (kept.has(m.id)) break;
        const range = locate(m.quote, m.from, m.nth, m.of);
        const a = range && blockOf(range.startContainer);
        const b = range && blockOf(range.endContainer);
        if (!range || !a || !b) {
          post({ type: 'lost', id: m.id });
          break;
        }
        kept.set(m.id, range);
        highlight.add(range);
        post({ type: 'located', id: m.id, from: lineOf(a, 'from'), to: lineOf(b, 'to') });
        break;
      }
      case 'theme':
        theme.textContent = m.css;
        break;
    }
  });
  // Once the Markdown below has been parsed, the pane may send comments to find.
  document.addEventListener('DOMContentLoaded', () => post({ type: 'ready' }));
}

start();
