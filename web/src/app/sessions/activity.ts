// Agent activity on a tab: {"activity":"…"} frames from a tab's socket
// become the running spinner, the needs-you dot and the done ✓, and feed
// the favicon/title badge. The rules live in activity-view.ts.

import { type ActivityFrame, activityView, onFrame, onVisit } from './activity-view.ts';
import { updateBadge } from './bell.ts';
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
