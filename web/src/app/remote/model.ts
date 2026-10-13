// What the palette's Open on another device page shows, from the daemon's answer.
// Pure: no DOM, so `node --test` loads it.

export interface RemoteDevice {
  id: string;
  name: string;
  // Unix seconds.
  created: number;
  last_seen: number | null;
}

export interface RemoteInfo {
  enabled: boolean;
  address: string | null;
  port: number;
  host: string | null;
  error: string | null;
  devices: RemoteDevice[];
}

export type RemoteScreen = 'forbidden' | 'host' | 'no-tailscale' | 'off' | 'on';

// 'forbidden' is a device token's answer: only the Mac's own page manages sharing.
export function remoteScreen(info: RemoteInfo | 'forbidden'): RemoteScreen {
  if (info === 'forbidden') return 'forbidden';
  if (info.host !== null) return 'host';
  if (info.address === null) return 'no-tailscale';
  return info.enabled ? 'on' : 'off';
}

// What a screen with no controls says instead.
export function remoteMessage(info: RemoteInfo | 'forbidden'): string | null {
  switch (remoteScreen(info)) {
    case 'forbidden':
      return 'Open this on the Mac running tabsh.';
    case 'host':
      return `tabsh already listens on ${(info as RemoteInfo).host}. Sharing is set by HOST.`;
    case 'no-tailscale':
      return 'Install Tailscale on this Mac and the other device, sign both in to the same account, then reopen this.';
    default:
      return null;
  }
}

// How long ago a device last used its link; `now` is unix seconds.
export function lastSeen(device: RemoteDevice, now: number): string {
  if (device.last_seen === null) return 'Not used yet';
  const seconds = Math.max(0, now - device.last_seen);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}
