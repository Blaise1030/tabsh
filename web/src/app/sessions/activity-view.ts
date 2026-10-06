// What a tab's agent activity looks like: the rules that turn the state a
// hook reported (plus whether you have seen the tab) into the marker on the
// tab and the favicon/title badge — and what a BEL from the tab means once
// its agent has spoken. Pure — the DOM wiring is in activity.ts.

export type ActivityFrame = 'running' | 'needs-input' | 'idle';
export type ActivityMarker = 'spinner' | 'dot' | 'done' | null;

export interface Activity {
  // The latest state the daemon reported; 'idle' until it says otherwise.
  state: ActivityFrame;
  // A running agent went idle before you visited the tab: show ✓ until then.
  doneUnseen: boolean;
  // Hook activity was seen from this tab in this page: its BELs are the
  // agent's, not the shell's. Page-local — never sent anywhere.
  hooked: boolean;
  // A BEL rang while the agent ran: it is asking for you, until the
  // daemon's next state arrives. Display-only — never sent back.
  asking: boolean;
}

export const IDLE: Activity = { state: 'idle', doneUnseen: false, hooked: false, asking: false };

// A frame from the daemon. Any new state ends the last one's marker; only
// running → idle is "done", because needs-input → idle means you just
// interacted with the agent, not that it finished while you were away.
// Every frame is hook activity, so it hooks the tab.
export function onFrame(a: Activity, frame: ActivityFrame): Activity {
  if (frame === a.state) return a.hooked ? a : { ...a, hooked: true };
  return { state: frame, doneUnseen: frame === 'idle' && a.state === 'running', hooked: true, asking: false };
}

// A BEL was scanned from the tab's output. From a tab whose agent has
// spoken, the BEL is the agent, not the shell: while it runs, a working
// agent that rings is asking for you — this covers agents whose hooks have
// no "waiting for you" event. Any other state, and a repeated BEL, change
// nothing. A tab that never spoke keeps today's bell (bellRings).
export function onBell(a: Activity): Activity {
  if (!a.hooked || a.state !== 'running' || a.asking) return a;
  return { ...a, asking: true };
}

// Whether a BEL still rings today's bell: only tabs with no hook activity
// in this page. The others' BELs are interpreted by onBell instead.
export function bellRings(a: Activity): boolean {
  return !a.hooked;
}

// Visiting the tab: the ✓ done marker has been seen. The dot and spinner
// are the agent's state, not unread output, so they stay.
export function onVisit(a: Activity): Activity {
  return a.doneUnseen ? { ...a, doneUnseen: false } : a;
}

// The socket reattached: the page's copy is stale (a restarted daemon's
// sessions all start idle, and idle is unspoken), so start over from idle.
// The hook mark is the page's, not the socket's, so it survives; the
// attach intro or a live frame re-states real activity right after the
// replayed history.
export function onReattach(a: Activity): Activity {
  return { ...IDLE, hooked: a.hooked };
}

export function activityView(
  a: Activity,
  active: boolean,
  focused: boolean,
): { marker: ActivityMarker; badge: boolean } {
  // A BEL-derived ask shows exactly like needs-input, and lasts the same:
  // until the daemon's next state, not until you visit.
  if (a.asking) return { marker: 'dot', badge: !(active && focused) };
  switch (a.state) {
    case 'running':
      return { marker: 'spinner', badge: false };
    case 'needs-input':
      // The badge is only for tabs you aren't watching.
      return { marker: 'dot', badge: !(active && focused) };
    default:
      return { marker: a.doneUnseen ? 'done' : null, badge: false };
  }
}
