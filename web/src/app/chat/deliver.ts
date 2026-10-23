// Where typed-in agent text goes. A UI card's xterm is not on screen, so
// paste, dropped paths and focus land in the composer instead.

type TermSink = { paste: (text: string) => void; focus: () => void };
type ComposerSink = { insert: (text: string) => void; focus: () => void };

const composers = new Map<string, ComposerSink>();
const pending = new Map<string, string>();
const wantFocus = new Set<string>();

export function insertIntoComposer(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (/\s$/.test(current) || /^\s/.test(incoming)) return current + incoming;
  return `${current} ${incoming}`;
}

// The mounted composer. Queued text (a paste before it was on screen) is
// applied now. Returns the unbind.
export function registerComposer(id: string, sink: ComposerSink): () => void {
  composers.set(id, sink);
  const queued = pending.get(id);
  if (queued) {
    pending.delete(id);
    sink.insert(queued);
  }
  if (queued || wantFocus.has(id)) {
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

export function focusAgentSurface(isChat: boolean, id: string, term: { focus: () => void }): void {
  if (!isChat) {
    term.focus();
    return;
  }
  const sink = composers.get(id);
  if (sink) sink.focus();
  else wantFocus.add(id);
}
