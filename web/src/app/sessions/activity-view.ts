// What a tab's agent activity looks like: the rules that turn the state a
// hook reported (plus whether you have seen the tab) into the marker on the
// tab and the favicon/title badge. Pure — the DOM wiring is in activity.ts.

export type ActivityFrame = 'running' | 'needs-input' | 'idle';
export type ActivityMarker = 'spinner' | 'dot' | 'done' | null;

export interface Activity {
  // The latest state the daemon reported; 'idle' until it says otherwise.
  state: ActivityFrame;
  // A running agent went idle before you visited the tab: show ✓ until then.
  doneUnseen: boolean;
}

export const IDLE: Activity = { state: 'idle', doneUnseen: false };

// A frame from the daemon. Any new state ends the last one's marker; only
// running → idle is "done", because needs-input → idle means you just
// interacted with the agent, not that it finished while you were away.
export function onFrame(a: Activity, frame: ActivityFrame): Activity {
  if (frame === a.state) return a;
  return { state: frame, doneUnseen: frame === 'idle' && a.state === 'running' };
}

// Visiting the tab: the ✓ done marker has been seen. The dot and spinner
// are the agent's state, not unread output, so they stay.
export function onVisit(a: Activity): Activity {
  return a.doneUnseen ? { ...a, doneUnseen: false } : a;
}

// The socket reattached: the page's copy is stale (a restarted daemon's
// sessions all start idle, and idle is unspoken), so start over from idle.
// The attach intro or a live frame re-states real activity right after the
// replayed history.
export function onReattach(): Activity {
  return IDLE;
}

export function activityView(
  a: Activity,
  active: boolean,
  focused: boolean,
): { marker: ActivityMarker; badge: boolean } {
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
