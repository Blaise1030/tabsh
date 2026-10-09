// Comments on a Markdown preview, the pane's side: the Comment button over a
// selection, the comment box, the card a highlight shows on hover, and Send.
// One `Notes` per pane view; its comments live in the page. The frame script
// (preview-frame.ts) draws the highlights. The comments' text stays here and
// goes into the DOM only as child strings and a textarea's value.
import van, { type State } from 'vanjs-core';
import { isMac } from '../ui/dom.ts';
import { type Icon, icons } from '../ui/icons.ts';
import { type Comment, commentMessage, oneLine, shortLines } from './comments.ts';
import { parseFromFrame, type Rect, type ToFrame } from './frame-protocol.ts';

const { button, code, div, footer, p, span, textarea } = van.tags;

export type PasteResult = 'pasted' | 'closed' | 'unsafe';

export interface NotesHost {
  path(): string; // the file's path as the pane header shows it
  paste(text: string): PasteResult; // into this tab's terminal
  status(text: string): void; // the pane header's status line
  shownStatus(): string; // what the status line shows now
}

export interface Notes {
  comments: State<readonly Comment[]>;
  pieces: HTMLElement[]; // the floating parts, for the pane view
  attach(frame: HTMLIFrameElement): void; // a new preview frame
  detach(): void; // the preview is gone (source view, another file)
  theme(css: string): boolean; // re-themes a listening frame; false when none is
  send(): void;
  clear(): void;
  dispose(): void;
}

// The selection the Comment button is for, as the frame reported it.
interface Picked {
  sel: number;
  quote: string;
  from: number;
  to: number;
  nth: number;
  of: number;
  rect: Rect;
  gen: number; // the frame it was made in (`gen` then)
}

interface Spot {
  top: number;
  left: number;
}

const GAP = 6; // between a floating piece and the text it's for
const HIDE_MS = 250; // the hover card's grace, to reach it from the highlight

export function createNotes(host: NotesHost): Notes {
  const comments = van.state<readonly Comment[]>([]);
  const hovered = van.state<Comment | null>(null);
  const quote = van.state('');
  const saveLabel = van.state('Comment');
  let frame: HTMLIFrameElement | null = null;
  let gen = 0; // counts frames: a selection is kept only by the frame it was made in
  let ready = false;
  let lostText = ''; // the lost-comments message this put in the status line
  let picked: Picked | null = null;
  let editing: Comment | null = null; // the comment the box edits; null for a new one
  let hoverRect: Rect | null = null;
  let menuAt: Spot | null = null; // where the Comment button went, for the box that replaces it
  let nextId = 1;
  let hideTimer = 0;

  const tell = (m: ToFrame) => frame?.contentWindow?.postMessage(m, '*');

  const menu = div(
    { class: 'row-menu comment-menu', role: 'menu', 'aria-label': 'Selection', hidden: true },
    button(
      { type: 'button', role: 'menuitem', onclick: () => openBox(null) },
      icons.messageSquarePlus(),
      span('Comment'),
    ),
  );
  const note = textarea({ class: 'textarea', rows: 3, placeholder: 'What should change?', 'aria-label': 'Comment' });
  const box = div(
    { class: 'row-menu comment-box', role: 'dialog', 'aria-label': 'Comment', hidden: true },
    p({ class: 'comment-quote' }, () => quote.val),
    note,
    footer(
      button(
        { type: 'button', class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', onclick: () => hideAll() },
        'Cancel',
      ),
      button({ type: 'button', class: 'btn', 'data-size': 'sm', onclick: () => save() }, () => saveLabel.val),
    ),
  );
  const small = (icon: Icon, label: string, onclick: () => void) =>
    button(
      {
        type: 'button',
        class: 'btn',
        'data-variant': 'ghost',
        'data-size': 'icon-xs',
        title: label,
        'aria-label': label,
        onclick,
      },
      icon(),
    );
  const card = div(
    { class: 'row-menu comment-hover', hidden: true },
    p({ class: 'comment-note' }, () => hovered.val?.note ?? ''),
    footer(
      code({ class: 'comment-lines' }, () => (hovered.val ? shortLines(hovered.val) : '')),
      small(icons.edit, 'Edit comment', () => {
        if (hovered.val) openBox(hovered.val);
      }),
      small(icons.close, 'Delete comment', () => {
        if (hovered.val) remove(hovered.val.id);
      }),
    ),
  );

  // Puts a floating piece over the frame at `rect` (in the frame's
  // coordinates, cut to the part of the frame in view): above it when `above`
  // and there's room under the pane header, else below; or exactly at `at`
  // (the view's coordinates). Then kept inside the pane's view. Shown first,
  // so it has a size. Returns where it went.
  function place(el: HTMLElement, rect: Rect, above: boolean, at?: Spot): Spot {
    el.hidden = false;
    const view = el.offsetParent;
    if (!frame || !(view instanceof HTMLElement)) return { top: 0, left: 0 };
    const f = frame.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const head = view.querySelector<HTMLElement>('.pane-head')?.offsetHeight ?? 0;
    const seen = frame.clientHeight;
    // The part of the rect in view; a rect wholly out of view counts as its nearer edge.
    const clip = (y: number) => Math.min(Math.max(y, 0), seen);
    const rTop = clip(rect.top);
    const rBottom = clip(rect.bottom);
    let top: number;
    let left: number;
    if (at) {
      ({ top, left } = at);
    } else {
      top = f.top - v.top + rTop - el.offsetHeight - GAP;
      if (!above || top < head + GAP) top = f.top - v.top + rBottom + GAP;
      left = f.left - v.left + rect.left;
    }
    top = Math.max(head + GAP, Math.min(top, v.height - el.offsetHeight - 8));
    left = Math.max(8, Math.min(left, v.width - el.offsetWidth - 8));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    return { top, left };
  }

  function hideCard(): void {
    clearTimeout(hideTimer);
    card.hidden = true;
    hovered.val = null;
  }
  function hideCardSoon(): void {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideCard, HIDE_MS);
  }
  function hideAll(): void {
    menu.hidden = true;
    box.hidden = true;
    editing = null;
    hideCard();
  }

  // Opens the box for a new comment on the picked selection, or to edit `c`.
  function openBox(c: Comment | null): void {
    const target = c ?? picked;
    const at = c ? hoverRect : picked?.rect;
    if (!target || !at) return;
    editing = c;
    quote.val = `“${oneLine(target.quote, 120)}”`;
    note.value = c?.note ?? '';
    saveLabel.val = c ? 'Save' : 'Comment';
    menu.hidden = true;
    hideCard();
    // After VanJS has applied the quote and label (a microtask queued before this one).
    queueMicrotask(() => {
      // A new comment's box opens where the Comment button was.
      if (c || !menuAt) place(box, at, false);
      else place(box, at, false, menuAt);
      note.focus();
    });
  }

  function save(): void {
    const text = note.value.trim();
    if (!text) return;
    if (editing) {
      const id = editing.id;
      comments.val = comments.val.map((c) => (c.id === id ? { ...c, note: text } : c));
    } else if (picked) {
      const { sel, quote: q, from, to, nth, of } = picked;
      const id = nextId++;
      comments.val = [...comments.val, { id, quote: q, from, to, nth, of, note: text, lost: false }];
      // The preview was re-rendered while the box was open: the new frame
      // finds the passage again (once it's listening, else when it says ready).
      if (picked.gen === gen) tell({ type: 'keep', id, sel });
      else if (ready) tell({ type: 'locate', id, quote: q, from, nth, of });
      picked = null;
    }
    hideAll();
  }

  function update(id: number, change: Partial<Comment>): void {
    comments.val = comments.val.map((c) => (c.id === id ? { ...c, ...change } : c));
  }

  // Shows how many comments are lost, or clears that message; never another one.
  function reportLost(): void {
    const n = comments.val.filter((c) => c.lost).length;
    if (n === 0) {
      if (lostText && host.shownStatus() === lostText) host.status('');
      lostText = '';
      return;
    }
    lostText = n === 1 ? '1 comment no longer matches the file' : `${n} comments no longer match the file`;
    host.status(lostText);
  }

  function remove(id: number): void {
    comments.val = comments.val.filter((c) => c.id !== id);
    tell({ type: 'drop', id });
    hideCard();
    reportLost();
  }

  box.addEventListener('keydown', (e) => {
    const mod = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
    const key = e.key.toLowerCase();
    // Not the pane's: Mod-E would leave the preview, Mod-S save the file.
    if (mod && (key === 'e' || key === 's')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Handled here: the pane's own Esc (back to the terminal) skips a prevented one.
    if (e.key === 'Escape') {
      e.preventDefault();
      hideAll();
    } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', hideCardSoon);

  // A press anywhere but the floating pieces puts the Comment button away.
  const outside = (e: MouseEvent) => {
    const t = e.target;
    if (t instanceof Node && (menu.contains(t) || box.contains(t) || card.contains(t))) return;
    menu.hidden = true;
  };
  document.addEventListener('mousedown', outside);

  function onMessage(e: MessageEvent): void {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = parseFromFrame(e.data);
    if (!m) return;
    switch (m.type) {
      case 'ready':
        ready = true;
        for (const c of comments.val) {
          tell({ type: 'locate', id: c.id, quote: c.quote, from: c.from, nth: c.nth, of: c.of });
        }
        break;
      case 'select':
        if (!box.hidden) break; // a comment is being written: keep it
        picked = { sel: m.sel, quote: m.quote, from: m.from, to: m.to, nth: m.nth, of: m.of, rect: m.rect, gen };
        hideCard();
        menuAt = place(menu, m.rect, true);
        break;
      case 'clear':
        menu.hidden = true;
        break;
      case 'hover': {
        const c = comments.val.find((x) => x.id === m.id);
        if (!c || !box.hidden) break;
        clearTimeout(hideTimer);
        hovered.val = c;
        hoverRect = m.rect;
        // After VanJS has applied the card's text, so it's placed at its size.
        queueMicrotask(() => place(card, m.rect, false));
        break;
      }
      case 'unhover':
        hideCardSoon();
        break;
      case 'scroll':
        menu.hidden = true;
        hideCard();
        break;
      case 'located':
        update(m.id, { from: m.from, to: m.to, lost: false });
        reportLost();
        break;
      case 'lost':
        update(m.id, { lost: true });
        reportLost();
        break;
    }
  }
  window.addEventListener('message', onMessage);

  return {
    comments,
    pieces: [menu, box, card],
    attach(f) {
      frame = f;
      gen++;
      ready = false;
    },
    // The box stays open, its text with it: a re-render (the file changed on
    // disk) mustn't lose a comment being written.
    detach() {
      frame = null;
      ready = false;
      menu.hidden = true;
      hideCard();
    },
    theme(css) {
      if (!frame || !ready) return false;
      tell({ type: 'theme', css });
      return true;
    },
    send() {
      const list = comments.val;
      if (!list.length) return;
      const result = host.paste(commentMessage(host.path(), list));
      if (result === 'pasted') {
        comments.val = [];
        tell({ type: 'dropAll' });
        hideAll();
        host.status('');
        lostText = '';
      } else {
        host.status(
          result === 'closed'
            ? "Not sent: this tab's terminal is closed"
            : "Not sent: the terminal isn't at a prompt that takes a paste safely",
        );
      }
    },
    clear() {
      comments.val = [];
      tell({ type: 'dropAll' });
      hideAll();
      reportLost();
    },
    dispose() {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('mousedown', outside);
      clearTimeout(hideTimer);
    },
  };
}
