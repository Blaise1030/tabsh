// Where typed-in agent text goes. A UI card's xterm is not on screen, so
// paste, dropped paths and focus land in the composer instead. Dropped
// images attach as composer badges (uploaded on send), not as pasted paths.

type TermSink = { paste: (text: string) => void; focus: () => void };
type ComposerSink = {
  insert: (text: string) => void;
  focus: () => void;
  attachImages?: (files: File[]) => void;
};

const composers = new Map<string, ComposerSink>();
const pending = new Map<string, string>();
const pendingImages = new Map<string, File[]>();
const wantFocus = new Set<string>();

export function insertIntoComposer(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (/\s$/.test(current) || /^\s/.test(incoming)) return current + incoming;
  return `${current} ${incoming}`;
}

// The mounted composer. Queued text/images (a paste or drop before it was on
// screen) are applied now. Returns the unbind.
export function registerComposer(id: string, sink: ComposerSink): () => void {
  composers.set(id, sink);
  const queued = pending.get(id);
  if (queued) {
    pending.delete(id);
    sink.insert(queued);
  }
  const queuedImages = pendingImages.get(id);
  const tookImages = !!(queuedImages?.length && sink.attachImages);
  if (tookImages) {
    pendingImages.delete(id);
    sink.attachImages!(queuedImages!);
  }
  if (queued || tookImages || wantFocus.has(id)) {
    wantFocus.delete(id);
    sink.focus();
  }
  return () => {
    if (composers.get(id) === sink) composers.delete(id);
  };
}

export function deliverAgentText(isChat: boolean, id: string, text: string, term: TermSink): void {
  if (!text) return;
  if (!isChat) {
    term.paste(text);
    term.focus();
    return;
  }
  const sink = composers.get(id);
  if (sink) {
    sink.insert(text);
    sink.focus();
    return;
  }
  pending.set(id, insertIntoComposer(pending.get(id) ?? '', text));
  wantFocus.add(id);
}

/** Attach image files on a chat card's composer (badges). No-op without a sink. */
export function deliverAgentImages(id: string, files: File[]): void {
  if (!files.length) return;
  const sink = composers.get(id);
  if (sink?.attachImages) {
    sink.attachImages(files);
    sink.focus();
    return;
  }
  pendingImages.set(id, [...(pendingImages.get(id) ?? []), ...files]);
  wantFocus.add(id);
}

export function focusAgentSurface(isChat: boolean, id: string, term: { focus: () => void }): void {
  if (!isChat) {
    term.focus();
    return;
  }
  const sink = composers.get(id);
  if (sink) sink.focus();
  else wantFocus.add(id);
}
