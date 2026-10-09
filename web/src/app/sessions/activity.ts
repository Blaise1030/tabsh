// What the daemon's activity signal (board events: a session printed, or rang
// its bell) does to a tab. Only a parked tab needs it: one with a socket
// hears its output and bells itself (terminal.ts), so it would ring twice.
// A parked tab is marked unread unless it's the active one; a bell rings it
// either way (the active tab parks while the page is hidden or the board is
// open alone), and ring() decides whether you're looking. A trailing signal
// reports output from up to a second ago: output from before the tab parked
// was on its screen then, so it isn't unread. Pure: no DOM.

export type ActivityKind = 'output' | 'bell';

/** Socket delivery lag allowed between the daemon's output and a park. */
const SLACK_MS = 100;

export interface ActivityTarget {
  closed: boolean;
  /** How long ago it parked (no socket, so its output reaches the page only
   * as activity); Infinity if it never connected, null while connected. */
  parkedMs: number | null;
  active: boolean;
}

export interface ActivityEffect {
  unread: boolean;
  ring: boolean;
}

export function activityEffect(target: ActivityTarget | undefined, kind: string, ageMs: number): ActivityEffect {
  const none = { unread: false, ring: false };
  if (!target || target.closed || target.parkedMs === null) return none;
  if (kind === 'bell') return { unread: !target.active, ring: true };
  if (kind === 'output' && ageMs <= target.parkedMs + SLACK_MS) return { unread: !target.active, ring: false };
  return none;
}
