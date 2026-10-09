// What the daemon's activity signal (board events: a session printed, or rang
// its bell) does to a tab. Only a parked tab needs it: one with a socket
// hears its output and bells itself (terminal.ts), so it would ring twice;
// the active tab is being looked at. Pure: no DOM.

export interface ActivityTarget {
  closed: boolean;
  /** No socket: off screen, so its output reaches the page only as activity. */
  parked: boolean;
  active: boolean;
}

export interface ActivityEffect {
  unread: boolean;
  ring: boolean;
}

export function activityEffect(target: ActivityTarget | undefined, kind: string): ActivityEffect {
  if (!target || target.closed || !target.parked || target.active) return { unread: false, ring: false };
  if (kind === 'bell') return { unread: true, ring: true };
  if (kind === 'output') return { unread: true, ring: false };
  return { unread: false, ring: false };
}
