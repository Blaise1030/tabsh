// The About dialog: version, shell, state path, uptime and session counts.
import { daemonFetch } from '../daemon/client.ts';
import { store } from '../sessions/store.ts';
import { keyLabel } from '../settings/keys.ts';
import { current } from '../settings/settings.ts';
import { isMac } from './dom.ts';

interface About {
  version: string;
  shell: string;
  state_path: string;
  uptime_secs: number;
  sessions_running: number;
  sessions_total: number;
}

const about = () => document.getElementById('about') as HTMLDialogElement;

export async function openAbout(): Promise<void> {
  const info: About | null = await daemonFetch('/api/about')
    .then((r) => r.json())
    .catch(() => null);
  const up = info ? info.uptime_secs : 0;
  const uptime =
    up < 60
      ? `${up}s`
      : up < 3600
        ? `${Math.floor(up / 60)}m`
        : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
  const { saved } = current;
  const rows = info
    ? [
        ['Version', info.version],
        ['Shell', info.shell],
        ['State', info.state_path],
        ['Uptime', uptime],
        ['Sessions', `${info.sessions_running} running, ${info.sessions_total} total`],
        ['Settings', keyLabel(saved.keyPalette, isMac)],
        ['Switch tabs', `${keyLabel(saved.keyPrevTab, isMac)} / ${keyLabel(saved.keyNextTab, isMac)}`],
        ['Built with', 'Rust · axum · xterm.js · Basecoat'],
      ]
    : [['Status', 'Could not reach the tabsh daemon.']];
  (document.getElementById('about-list') as HTMLElement).replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const td = document.createElement('td');
      th.scope = 'row';
      th.textContent = k;
      td.textContent = v;
      tr.append(th, td);
      return tr;
    }),
  );
  about().showModal();
}

export function initAbout(): void {
  const dialog = about();
  dialog.addEventListener('close', () => store.active?.term.focus());
  // Clicking the backdrop closes it, and so does the Close button.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelector('footer button')?.addEventListener('click', () => dialog.close());
}
