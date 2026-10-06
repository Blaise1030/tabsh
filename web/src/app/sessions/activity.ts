// Agent activity on a tab: {"activity":"…"} frames from a tab's socket
// become the running spinner, the needs-you dot and the done ✓, and feed
// the favicon/title badge. The rules live in activity-view.ts.

import { type ActivityFrame, activityView, bellRings, onBell, onFrame, onReattach, onVisit } from './activity-view.ts';
import { ring, updateBadge } from './bell.ts';
import { type Session, store } from './store.ts';

// A frame arrived from the daemon. Unknown states are ignored: the page
// never shows more than the daemon it was built for.
export function onActivity(s: Session, frame: string): void {
  if (frame !== 'running' && frame !== 'needs-input' && frame !== 'idle') return;
  s.activity = onFrame(s.activity, frame as ActivityFrame);
  render(s);
  updateBadge();
}

// You looked at the tab: its ✓ done marker is seen away.
export function visitActivity(s: Session): void {
  const next = onVisit(s.activity);
  if (next === s.activity) return;
  s.activity = next;
  render(s);
}

// The socket (re)opened: whatever the page showed is stale — a restarted
// daemon's sessions all start idle — so begin from idle. Real activity is
// re-stated by the attach intro or a live frame, right after the history.
export function resetActivity(s: Session): void {
  s.activity = onReattach(s.activity);
  render(s);
  updateBadge();
}

// A BEL was scanned from this tab's output. Once its agent has spoken in
// this page, the BEL is the agent's, not the shell's: asking for you while
// it runs, noise otherwise — never a bell pulse. A tab that never spoke
// keeps today's bell (bell.ts).
export function bellActivity(s: Session): void {
  if (bellRings(s.activity)) {
    ring(s);
    return;
  }
  const next = onBell(s.activity);
  if (next === s.activity) return;
  s.activity = next;
  render(s);
  updateBadge();
}

// The marker classes on a tab element (app.css); only these three are ours.
function render(s: Session): void {
  const { marker } = activityView(s.activity, s === store.active, document.hasFocus());
  s.tab.classList.toggle('running', marker === 'spinner');
  s.tab.classList.toggle('needs', marker === 'dot');
  s.tab.classList.toggle('done', marker === 'done');
}

export function initActivity(): void {
  // Coming back to the browser tab counts as visiting the active terminal.
  const seen = () => {
    if (document.hidden) return;
    if (store.active) visitActivity(store.active);
    updateBadge();
  };
  document.addEventListener('visibilitychange', seen);
  addEventListener('focus', seen);
}
