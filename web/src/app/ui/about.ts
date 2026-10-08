// The About dialog: version, shell, state path, uptime and session counts.
import van, { type State } from 'vanjs-core';
import { daemonFetch } from '../daemon/client.ts';
import { store } from '../sessions/store.ts';
import { keyLabel } from '../settings/keys.ts';
import { current } from '../settings/settings.ts';
import { isMac } from './dom.ts';
import { keyed } from './keyed.ts';

interface About {
  version: string;
  shell: string;
  state_path: string;
  uptime_secs: number;
  sessions_running: number;
  sessions_total: number;
}

const { button, dialog, div, footer, h2, header, p, section, table, tbody, td, th, tr } = van.tags;

type Row = [string, string];

// The rows shown: filled by openAbout, before it shows the dialog.
const rows: State<Row[]> = van.state([]);
let about: HTMLDialogElement;

// The About dialog lives as long as the page.
export function About(): HTMLDialogElement {
  const list = tbody({ id: 'about-list' });
  about = dialog(
    { id: 'about', class: 'dialog', 'aria-labelledby': 'about-title', 'aria-describedby': 'about-desc' },
    div(
      header(
        h2({ id: 'about-title' }, 'tabsh'),
        p({ id: 'about-desc' }, 'Terminals in your browser, served by a small Rust daemon.'),
      ),
      section(table({ class: 'table about-table' }, list)),
      footer(button({ type: 'button', class: 'btn', onclick: () => about.close() }, 'Close')),
    ),
  );
  // A row is its label and value: a changed value is a new row.
  keyed(
    list,
    () => rows.val,
    ([k, v]) => `${k}\0${v}`,
    ([k, v]) => tr(th({ scope: 'row' }, k), td(v)),
  );
  about.addEventListener('close', () => store.active?.term.focus());
  // Clicking the backdrop closes it, and so does the Close button.
  about.addEventListener('click', (e) => {
    if (e.target === about) about.close();
  });
  return about;
}

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
  rows.val = info
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
  about.showModal();
}
