// Comments on a CodeMirror selection: the Comment button, the box, the card a
// highlight shows on hover, and Send. One `Notes` per pane view; the comments
// live in the page. The editor draws the highlights. Comment text goes into
// the DOM only as child strings and a textarea's value.
import type { ChangeSet, Text } from '@codemirror/state';
import { type Accessor, createRoot, createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { isMac } from '../ui/dom.ts';
import { type Icon, icons } from '../ui/icons.tsx';
import { type Comment, commentMessage, mapComments, projectMessage, quoteParts, shortLines } from './comments.ts';
import type { CommentHover, Editor, Rect, RestedSelection } from './editor.ts';

export type PasteResult = 'pasted' | 'closed' | 'unsafe';

export interface NotesHost {
  file(): { path: string; label: string }; // the open file: absolute path, and the path as shown
  paste(text: string): PasteResult; // into this tab's terminal
  status(text: string): void; // the pane header's status line
  shownStatus(): string; // what the status line shows now
}

// Comments on one file. The list keeps every file opened in this tab.
export interface FileBucket {
  path: string;
  label: string;
  comments: readonly Comment[];
}

export interface Notes {
  comments: Accessor<readonly Comment[]>; // the open file, what the editor and preview draw
  files: Accessor<readonly FileBucket[]>; // every file in this tab's project
  pieces: HTMLElement[]; // the floating parts, for the pane view
  attach(editor: Editor): void;
  detach(): void; // the editor is gone (preview, another file)
  openedFile(): void; // the pane opened a file; show that file's comments
  armJump(id: number): void; // after the next file opens, select this comment
  willJump(): boolean;
  jumped(): boolean; // the editor just revealed the armed comment
  pick(sel: RestedSelection | null, rect?: Rect | null): void;
  mapped(doc: Text, changes: ChangeSet, comments: readonly Comment[]): void;
  hover(hit: CommentHover | null): void;
  scrolled(): void;
  send(): void;
  clear(): void;
  dispose(): void;
}

interface Spot {
  top: number;
  left: number;
}

const GAP = 6;
const HIDE_MS = 250;

function SmallButton(props: { icon: Icon; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="btn"
      data-variant="ghost"
      data-size="icon-xs"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.icon()}
    </button>
  );
}

export function createNotes(host: NotesHost): Notes {
  const [comments, setComments] = createSignal<readonly Comment[]>([]);
  const [files, setFiles] = createSignal<readonly FileBucket[]>([]);
  const [hovered, setHovered] = createSignal<Comment | null>(null);
  const [quoteLead, setQuoteLead] = createSignal('');
  const [quoteRest, setQuoteRest] = createSignal('');
  let editor: Editor | null = null;
  let lostText = '';
  let picked: RestedSelection | null = null;
  let pickedLost = false;
  let editing: Comment | null = null;
  let hoverRect: Rect | null = null;
  let menuAt: Spot | null = null;
  let anchor: Rect | null = null; // where the preview selection sits; the editor measures its own
  let filePath = '';
  let fileLabel = '';
  let jumpId: number | null = null;
  let didJump = false;
  let nextId = 1;
  let hideTimer = 0;

  // Hosts the Solid roots fill; they are the floating pieces in the pane view.
  const menu = document.createElement('div');
  menu.className = 'row-menu comment-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Selection');
  menu.hidden = true;

  const box = document.createElement('div');
  box.className = 'row-menu comment-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Comment');
  box.hidden = true;

  const card = document.createElement('div');
  card.className = 'row-menu comment-hover';
  card.hidden = true;

  const note = (
    <textarea class="textarea" rows={3} placeholder="What should change?" aria-label="Comment" />
  ) as HTMLTextAreaElement;

  function place(el: HTMLElement, rect: Rect, above: boolean, at?: Spot): Spot {
    el.hidden = false;
    const view = el.offsetParent;
    if (!(view instanceof HTMLElement)) return { top: 0, left: 0 };
    const v = view.getBoundingClientRect();
    const head = view.querySelector<HTMLElement>('.pane-head')?.offsetHeight ?? 0;
    let top: number;
    let left: number;
    if (at) {
      ({ top, left } = at);
    } else {
      top = rect.top - v.top - el.offsetHeight - GAP;
      if (!above || top < head + GAP) top = rect.bottom - v.top + GAP;
      left = rect.left - v.left;
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
    setHovered(null);
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

  function push(): void {
    editor?.setComments(comments());
  }

  // The open file's comments are `comments`; `files` keeps the rest of the project.
  function commit(): void {
    if (!filePath) return;
    const next = comments();
    const i = files().findIndex((f) => f.path === filePath);
    if (!next.length) {
      if (i >= 0) setFiles(files().filter((f) => f.path !== filePath));
      return;
    }
    const bucket = { path: filePath, label: fileLabel, comments: next };
    setFiles(i < 0 ? [...files(), bucket] : files().map((f, n) => (n === i ? bucket : f)));
  }

  function openBox(c: Comment | null): void {
    const target = c ?? picked;
    if (!target) return;
    const at = c ? hoverRect : (editor?.rangeRect(target.from, target.to) ?? anchor);
    if (!at) return;
    editing = c;
    const parts = quoteParts(target.quote);
    setQuoteLead(parts.lead);
    setQuoteRest(parts.rest);
    note.value = c?.note ?? '';
    menu.hidden = true;
    hideCard();
    // After the box is shown and its quote lines lay out, so place() measures them.
    queueMicrotask(() => {
      if (c || !menuAt) place(box, at, false);
      else place(box, at, false, menuAt);
      note.focus({ preventScroll: true });
    });
  }

  function save(): void {
    const text = note.value.trim();
    if (!text) return;
    if (editing) {
      const id = editing.id;
      setComments(comments().map((c) => (c.id === id ? { ...c, note: text } : c)));
    } else if (picked) {
      const id = nextId++;
      setComments([...comments(), { id, ...picked, note: text, lost: pickedLost }]);
      picked = null;
      pickedLost = false;
    } else {
      return;
    }
    commit();
    push();
    hideAll();
    reportLost();
  }

  // This comment goes to the terminal now. A queued one is taken off the list
  // so it is not sent again; a new one is not queued.
  function sendDirect(): void {
    const text = note.value.trim();
    const target = editing ?? picked;
    if (!text || !target) return;
    const result = host.paste(
      commentMessage(fileLabel || host.file().label, [
        {
          id: editing?.id ?? 0,
          from: target.from,
          to: target.to,
          quote: target.quote,
          fromLine: target.fromLine,
          toLine: target.toLine,
          note: text,
          lost: editing ? editing.lost : pickedLost,
        },
      ]),
    );
    if (result !== 'pasted') {
      pasteFailed(result);
      return;
    }
    if (editing) {
      setComments(comments().filter((c) => c.id !== editing?.id));
      commit();
      push();
      reportLost();
    }
    picked = null;
    pickedLost = false;
    hideAll();
  }

  function pasteFailed(result: PasteResult): void {
    host.status(
      result === 'closed'
        ? "Not sent: this tab's terminal is closed"
        : "Not sent: the terminal isn't at a prompt that takes a paste safely",
    );
  }

  function reportLost(): void {
    const n = comments().filter((c) => c.lost).length;
    if (n === 0) {
      if (lostText && host.shownStatus() === lostText) host.status('');
      lostText = '';
      return;
    }
    lostText = n === 1 ? '1 comment no longer matches the file' : `${n} comments no longer match the file`;
    host.status(lostText);
  }

  function remove(id: number): void {
    setComments(comments().filter((c) => c.id !== id));
    commit();
    push();
    hideCard();
    reportLost();
  }

  box.addEventListener('keydown', (e) => {
    const mod = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'e' || key === 's')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideAll();
    } else if (e.key === 'Enter' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) save();
      else sendDirect();
    }
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', hideCardSoon);

  const outside = (e: MouseEvent) => {
    const t = e.target;
    if (t instanceof Node && (menu.contains(t) || box.contains(t) || card.contains(t))) return;
    menu.hidden = true;
  };
  document.addEventListener('mousedown', outside);

  const stop = createRoot((dispose) => {
    render(
      () => (
        <button type="button" role="menuitem" onClick={() => openBox(null)}>
          {icons.messageSquarePlus()}
          <span>Comment</span>
        </button>
      ),
      menu,
    );
    render(
      () => (
        <>
          <div class="comment-quote">
            <p class="comment-quote-lead">{quoteLead()}</p>
            <p class="comment-quote-rest" hidden={quoteRest() === ''}>
              {quoteRest()}
            </p>
          </div>
          {note}
          <footer>
            <button type="button" class="btn" data-variant="secondary" data-size="sm" onClick={() => hideAll()}>
              Cancel
            </button>
            <div class="comment-box-actions">
              <button type="button" class="btn" data-variant="outline" data-size="sm" onClick={() => save()}>
                Queue
                <span class="comment-kbd">{isMac ? '⇧↩' : 'Shift+Enter'}</span>
              </button>
              <button type="button" class="btn" data-size="sm" onClick={() => sendDirect()}>
                Send directly
                <span class="comment-kbd">{isMac ? '↩' : 'Enter'}</span>
              </button>
            </div>
          </footer>
        </>
      ),
      box,
    );
    render(
      () => (
        <>
          <p class="comment-note">{hovered()?.note ?? ''}</p>
          <footer>
            <code class="comment-lines">{hovered() ? shortLines(hovered()!) : ''}</code>
            <SmallButton
              icon={icons.edit}
              label="Edit comment"
              onClick={() => {
                const c = hovered();
                if (c) openBox(c);
              }}
            />
            <SmallButton
              icon={icons.close}
              label="Delete comment"
              onClick={() => {
                const c = hovered();
                if (c) remove(c.id);
              }}
            />
          </footer>
        </>
      ),
      card,
    );
    return dispose;
  });

  return {
    comments,
    files,
    pieces: [menu, box, card],
    attach(ed) {
      editor = ed;
      ed.setComments(comments());
      didJump = false;
      if (jumpId == null) return;
      const c = comments().find((x) => x.id === jumpId);
      jumpId = null;
      if (!c) return;
      if (c.lost) ed.goTo(c.fromLine);
      else ed.reveal(c.from, c.to);
      ed.view.focus();
      didJump = true;
    },
    openedFile() {
      const file = host.file();
      filePath = file.path;
      fileLabel = file.label;
      setComments(files().find((f) => f.path === filePath)?.comments ?? []);
      if (jumpId != null && !comments().some((c) => c.id === jumpId)) jumpId = null;
      const i = files().findIndex((f) => f.path === filePath);
      if (i >= 0 && files()[i].label !== fileLabel) {
        setFiles(files().map((f, n) => (n === i ? { ...f, label: fileLabel } : f)));
      }
      push();
      reportLost();
    },
    armJump(id) {
      jumpId = id;
    },
    willJump: () => jumpId != null,
    jumped: () => didJump,
    detach() {
      editor = null;
      menu.hidden = true;
      hideCard();
    },
    pick(sel, rect) {
      if (!box.hidden) return;
      const at = rect ?? (sel && editor ? editor.rangeRect(sel.from, sel.to) : null);
      if (!sel?.quote.trim() || !at) {
        menu.hidden = true;
        return;
      }
      picked = sel;
      pickedLost = false;
      anchor = rect ?? null;
      hideCard();
      menuAt = place(menu, at, true);
    },
    mapped(doc, changes, list) {
      setComments(list);
      commit();
      menu.hidden = true;
      if (picked && !pickedLost) {
        const [next] = mapComments(doc, changes, [{ id: 0, ...picked, note: '', lost: false }]);
        if (next.lost) pickedLost = true;
        else {
          picked = {
            from: next.from,
            to: next.to,
            quote: next.quote,
            fromLine: next.fromLine,
            toLine: next.toLine,
          };
        }
      }
      reportLost();
    },
    hover(hit) {
      if (!box.hidden) return;
      if (!hit) {
        hideCardSoon();
        return;
      }
      const c = comments().find((x) => x.id === hit.id);
      if (!c) return;
      clearTimeout(hideTimer);
      setHovered(c);
      hoverRect = hit.rect;
      // After the card's note text lays out, so place() measures it.
      queueMicrotask(() => place(card, hit.rect, false));
    },
    scrolled() {
      menu.hidden = true;
      hideCard();
    },
    send() {
      const noted = files().filter((f) => f.comments.length);
      if (!noted.length) return;
      const result = host.paste(projectMessage(noted.map((f) => ({ path: f.label, comments: f.comments }))));
      if (result === 'pasted') {
        setFiles([]);
        setComments([]);
        push();
        hideAll();
        picked = null;
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
      setFiles([]);
      setComments([]);
      jumpId = null;
      picked = null;
      pickedLost = false;
      push();
      hideAll();
      reportLost();
    },
    dispose() {
      stop();
      document.removeEventListener('mousedown', outside);
      clearTimeout(hideTimer);
    },
  };
}
