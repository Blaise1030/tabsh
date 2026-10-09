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
}

const GAP = 6; // between a floating piece and the text it's for
const HIDE_MS = 250; // the hover card's grace, to reach it from the highlight

export function createNotes(host: NotesHost): Notes {
  const comments = van.state<readonly Comment[]>([]);
  const hovered = van.state<Comment | null>(null);
  const quote = van.state('');
  const saveLabel = van.state('Comment');
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  let picked: Picked | null = null;
  let editing: Comment | null = null; // the comment the box edits; null for a new one
  let hoverRect: Rect | null = null;
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
  // coordinates): above it when `above` and there's room under the pane
  // header, else below; inside the pane's width. Shown first, so it has a size.
  function place(el: HTMLElement, rect: Rect, above: boolean): void {
    el.hidden = false;
    const view = el.offsetParent;
    if (!frame || !(view instanceof HTMLElement)) return;
    const f = frame.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const head = view.querySelector<HTMLElement>('.pane-head')?.offsetHeight ?? 0;
    let top = f.top - v.top + rect.top - el.offsetHeight - GAP;
    if (!above || top < head + GAP) top = f.top - v.top + rect.bottom + GAP;
    const left = Math.min(f.left - v.left + rect.left, v.width - el.offsetWidth - 8);
    el.style.top = `${top}px`;
    el.style.left = `${Math.max(left, 8)}px`;
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
      place(box, at, false);
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
      tell({ type: 'keep', id, sel });
      picked = null;
    }
    hideAll();
  }

  function update(id: number, change: Partial<Comment>): void {
    comments.val = comments.val.map((c) => (c.id === id ? { ...c, ...change } : c));
  }

  function reportLost(): void {
    const n = comments.val.filter((c) => c.lost).length;
    host.status(
      n === 0 ? '' : n === 1 ? '1 comment no longer matches the file' : `${n} comments no longer match the file`,
    );
  }

  function remove(id: number): void {
    comments.val = comments.val.filter((c) => c.id !== id);
    tell({ type: 'drop', id });
    hideCard();
    reportLost();
  }

  box.addEventListener('keydown', (e) => {
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
        picked = { sel: m.sel, quote: m.quote, from: m.from, to: m.to, nth: m.nth, of: m.of, rect: m.rect };
        hideCard();
        place(menu, m.rect, true);
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
      ready = false;
    },
    detach() {
      frame = null;
      ready = false;
      hideAll();
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
    },
    dispose() {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('mousedown', outside);
      clearTimeout(hideTimer);
    },
  };
}
