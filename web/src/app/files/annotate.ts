// Comments on a Markdown preview, the pane's side. This first version is only
// the link to the frame: it knows when the frame script is listening, so a
// theme change can re-theme the preview in place.
import van, { type State } from 'vanjs-core';
import type { Comment } from './comments.ts';
import { parseFromFrame, type ToFrame } from './frame-protocol.ts';

export interface NotesHost {
  path(): string; // the file's path as the pane header shows it
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

export function createNotes(_host: NotesHost): Notes {
  const comments = van.state<readonly Comment[]>([]);
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  const tell = (m: ToFrame) => frame?.contentWindow?.postMessage(m, '*');

  function onMessage(e: MessageEvent): void {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = parseFromFrame(e.data);
    if (m?.type === 'ready') ready = true;
  }
  window.addEventListener('message', onMessage);

  return {
    comments,
    pieces: [],
    attach(f) {
      frame = f;
      ready = false;
    },
    detach() {
      frame = null;
      ready = false;
    },
    theme(css) {
      if (!frame || !ready) return false;
      tell({ type: 'theme', css });
      return true;
    },
    send() {},
    clear() {
      comments.val = [];
      tell({ type: 'dropAll' });
    },
    dispose() {
      window.removeEventListener('message', onMessage);
    },
  };
}
