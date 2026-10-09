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
  const getter = <T>(proto: object, key: string) =>
    Object.getOwnPropertyDescriptor(proto, key)?.get as (this: Node) => T;
  const parentOf = getter<Element | null>(Node.prototype, 'parentElement');
  const kidsOf = getter<NodeListOf<ChildNode>>(Node.prototype, 'childNodes');
  const lastKid = getter<ChildNode | null>(Node.prototype, 'lastChild');
  const attr = Element.prototype.getAttribute;
  const closest = Element.prototype.closest;
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

  // A block marker of this render (comments.ts's renderBlocks): an empty
  // element just before its block's HTML, carrying the mark.
  const isMarker = (n: Node): n is Element => n instanceof Element && attr.call(n, 'data-tabsh-block') === mark;
  const markers = walker.call(document, document, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (isMarker(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  // The marker before `n` in document order (`n` itself when `self` and it is one).
  const markerBefore = (n: Node, self: boolean): Element | null => {
    if (self && isMarker(n)) return n;
    markers.currentNode = n;
    return markers.previousNode() as Element | null;
  };
  // `n`'s last descendant, or `n`. Bounded, as a belt and braces against any loop.
  const lastIn = (n: Node): Node => {
    for (let k = lastKid.call(n), steps = 0; k && steps < 10000; k = lastKid.call(k), steps++) n = k;
    return n;
  };
  // The block a range's boundary is in: the marker before the content just
  // after it (`start`) or just before it. A point before every block counts as the first.
  const blockAt = (node: Node, offset: number, start: boolean): Element | null => {
    let found: Element | null;
    if (node instanceof CharacterData) found = markerBefore(node, false);
    else {
      const next = kidsOf.call(node)[offset];
      found = next ? markerBefore(next, start) : markerBefore(lastIn(node), true);
    }
    if (found) return found;
    markers.currentNode = document;
    return markers.nextNode() as Element | null;
  };
  const lineOf = (el: Element, which: 'from' | 'to') => Number(attr.call(el, `data-${which}`));
  const box = (r: DOMRect): Rect => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  // The rendered text, in document order, with whitespace runs as one space
  // (blocks apart by one), and where each of its characters
  // came from: each text node takes the line of the marker before it.
  function index(): { flat: string; at: Spot[] } {
    let flat = '';
    const at: Spot[] = [];
    let line = 0; // before the first marker: nothing of the Markdown
    const space = () => {
      if (flat && !flat.endsWith(' ')) {
        flat += ' ';
        at.push(at[at.length - 1]);
      }
    };
    const walk = walker.call(document, document, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n instanceof Element) {
          return isMarker(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        const p = parentOf.call(n);
        return p && closest.call(p, 'script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n instanceof Element) {
        if (isMarker(n)) line = lineOf(n, 'from');
        space();
        continue;
      }
      if (!line) continue;
      const text = (n as Text).data;
      for (let i = 0; i < text.length; i++) {
        const white = /\s/.test(text[i]);
        if (white && (flat === '' || flat.endsWith(' '))) continue;
        flat += white ? ' ' : text[i];
        at.push({ node: n as Text, offset: i, line });
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
    const a = blockAt(range.startContainer, range.startOffset, true);
    const b = blockAt(range.endContainer, range.endOffset, false);
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
      to: Math.max(lineOf(a, 'from'), lineOf(b, 'to')),
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
        const a = range && blockAt(range.startContainer, range.startOffset, true);
        const b = range && blockAt(range.endContainer, range.endOffset, false);
        if (!range || !a || !b) {
          post({ type: 'lost', id: m.id });
          break;
        }
        kept.set(m.id, range);
        highlight.add(range);
        const from = lineOf(a, 'from');
        post({ type: 'located', id: m.id, from, to: Math.max(from, lineOf(b, 'to')) });
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
