// About tabsh: version, shell, state path, uptime and session counts, shown
// as a page of the palette.
import { daemonFetch } from '../daemon/client.ts';

interface About {
  version: string;
  shell: string;
  state_path: string;
  uptime_secs: number;
  sessions_running: number;
  sessions_total: number;
}

export type AboutRow = [string, string];

// The last rows fetched: null until the first answer, empty when the daemon
// couldn't be reached.
export let aboutRows: AboutRow[] | null = null;

function uptime(up: number): string {
  return up < 60
    ? `${up}s`
    : up < 3600
      ? `${Math.floor(up / 60)}m`
      : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
}

// Fetches the rows afresh; the palette redraws its About page once they land.
export async function loadAbout(): Promise<void> {
  const info: About | null = await daemonFetch('/api/about')
    .then((r) => r.json())
    .catch(() => null);
  aboutRows = info
    ? [
        ['Version', info.version],
        ['Shell', info.shell],
        ['State', info.state_path],
        ['Uptime', uptime(info.uptime_secs)],
        ['Sessions', `${info.sessions_running} running, ${info.sessions_total} total`],
        ['Built with', 'Rust · axum · xterm.js · Basecoat'],
      ]
    : [];
}
