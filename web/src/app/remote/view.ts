// The Open on another device dialog: turn Tailscale sharing on, add a device
// (a QR code and a link, shown once) and revoke devices. Opened from the
// palette's Help group. The device's link carries its token: it lives only in
// this module's states while the dialog is open, never in storage, the
// address bar or the console.
import van from 'vanjs-core';
import { gateMode } from '../daemon/client.ts';
import { keyed } from '../ui/keyed.ts';
import { addDevice, getRemote, revokeDevice, setSharing } from './api.ts';
import { lastSeen, type RemoteDevice, type RemoteInfo, type RemoteScreen, remoteScreen } from './model.ts';
import { qrSvg } from './qr.ts';

const { button, dialog, div, footer, form, h2, header, input, label, li, p, section, span, ul } = van.tags;

const DEFAULT_NAME = 'iPhone';
const NO_TAILSCALE =
  'Install Tailscale on this Mac and the other device, sign both in to the same account, then reopen this.';

// null while the first answer is awaited.
const info = van.state<RemoteInfo | 'forbidden' | null>(null);
const problem = van.state<string | null>(null);
const busy = van.state(false);
const name = van.state(DEFAULT_NAME);
// The device just added: its link, drawn as `qr`.
const added = van.state<{ id: string; url: string } | null>(null);
const qr = van.state<SVGSVGElement | null>(null);
const copied = van.state(false);
let copiedTimer = 0;
let host: HTMLDialogElement | null = null;

const screen = (): RemoteScreen | null => (info.val === null ? null : remoteScreen(info.val));
const loaded = (): RemoteInfo | null => (info.val === null || info.val === 'forbidden' ? null : info.val);

// The message a screen with no controls shows.
function message(): string | null {
  const s = screen();
  const i = loaded();
  if (s === 'forbidden') return 'Open this on the Mac running tabsh.';
  if (s === 'host') return `tabsh already listens on ${i?.host}. Sharing is set by HOST.`;
  if (s === 'no-tailscale') return NO_TAILSCALE;
  return null;
}

// Reads what the daemon holds. It never clears `problem`, so a message set by
// the change that called it stays; false (with its own message) when it failed.
async function refresh(): Promise<boolean> {
  try {
    info.val = await getRemote();
    return true;
  } catch {
    problem.val = 'Could not reach tabsh.';
    return false;
  }
}

// Runs a change; whatever fails, the dialog shows what the daemon holds.
async function change(work: () => Promise<void>): Promise<void> {
  busy.val = true;
  problem.val = null;
  try {
    await work();
  } catch {
    // The refresh goes first: the message is set after it, so nothing erases it.
    if (await refresh()) problem.val = 'That did not work.';
  } finally {
    busy.val = false;
  }
}

function forget(): void {
  added.val = null;
  qr.val = null;
  copied.val = false;
}

const toggle = (enabled: boolean) =>
  change(async () => {
    info.val = await setSharing(enabled);
    if (!enabled) forget();
  });

const add = () =>
  change(async () => {
    forget();
    const device = await addDevice(name.val);
    // The link is shown once, so it goes up before the QR is drawn: were the
    // encoder's chunk to fail to load, the link would still be there.
    added.val = { id: device.id, url: device.url };
    try {
      qr.val = await qrSvg(device.url);
    } catch {
      problem.val = 'Could not draw the QR code. Use the link instead.';
    }
    await refresh();
  });

const revoke = (id: string) =>
  change(async () => {
    await revokeDevice(id);
    if (added.val?.id === id) forget();
    await refresh();
  });

function Switch(): HTMLElement {
  const box = input({
    type: 'checkbox',
    role: 'switch',
    class: 'input',
    checked: () => loaded()?.enabled ?? false,
    disabled: () => busy.val,
    onchange: () => toggle(box.checked),
  });
  return section(
    { class: 'remote-share', hidden: () => screen() !== 'off' && screen() !== 'on' },
    label({ class: 'remote-switch' }, box, 'Share over Tailscale'),
    p({ class: 'remote-error', role: 'alert', hidden: () => !loaded()?.error }, () => loaded()?.error ?? ''),
  );
}

function AddDevice(): HTMLElement {
  return section(
    { class: 'remote-add', hidden: () => screen() !== 'on' },
    input({
      class: 'input',
      name: 'device',
      maxlength: 60,
      autocomplete: 'off',
      'aria-label': 'Device name',
      value: () => name.val,
      oninput: (e: Event) => {
        name.val = (e.target as HTMLInputElement).value;
      },
    }),
    button({ type: 'submit', class: 'btn', disabled: () => busy.val }, 'Add device'),
  );
}

async function copyLink(link: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.val = true;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied.val = false;
    }, 1500);
  } catch {
    // No clipboard on plain http: select the link for a manual copy.
    link.select();
  }
}

function NewDevice(): HTMLElement {
  const link = input({
    class: 'input remote-link',
    readonly: true,
    'aria-label': 'Device link',
    value: () => added.val?.url ?? '',
    onfocus: () => link.select(),
  });
  return section(
    { class: 'remote-new', hidden: () => added.val === null },
    div({ class: 'remote-qr' }, () => qr.val ?? ''),
    p({ class: 'remote-hint' }, 'Shown once. Scan it, or open the link on the other device.'),
    div(
      { class: 'remote-link-row' },
      link,
      button({ type: 'button', class: 'btn', 'data-variant': 'outline', onclick: () => copyLink(link) }, 'Copy link'),
    ),
    span({ class: 'remote-hint', role: 'status' }, () => (copied.val ? 'Copied' : '')),
  );
}

function deviceRow(d: RemoteDevice): HTMLElement {
  return li(
    { class: 'remote-device' },
    span({ class: 'remote-device-name' }, d.name),
    span({ class: 'remote-device-seen' }, lastSeen(d, Date.now() / 1000)),
    button(
      {
        type: 'button',
        class: 'btn',
        'data-variant': 'outline',
        'data-size': 'sm',
        disabled: () => busy.val,
        onclick: () => revoke(d.id),
      },
      'Revoke',
    ),
  );
}

function Devices(): HTMLElement {
  const list = ul({ class: 'remote-devices' });
  keyed(
    list,
    () => loaded()?.devices ?? [],
    (d) => `${d.id}:${d.last_seen}`,
    deviceRow,
  );
  return section({ class: 'remote-list', hidden: () => screen() !== 'on' || !loaded()?.devices.length }, list);
}

export function Remote(): HTMLDialogElement {
  let pressedBackdrop = false;
  const el = dialog(
    {
      id: 'remote',
      class: 'dialog remote',
      'aria-labelledby': 'remote-title',
      // The dialog is the overlay; a click on it, not on the form, is the backdrop.
      onpointerdown: (e: PointerEvent) => {
        pressedBackdrop = e.target === e.currentTarget;
      },
      onclick: (e: MouseEvent) => {
        if (pressedBackdrop && e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close();
        pressedBackdrop = false;
      },
      // Nothing of the session outlives the dialog, the link included.
      onclose: () => {
        info.val = null;
        problem.val = null;
        name.val = DEFAULT_NAME;
        forget();
      },
    },
    form(
      {
        id: 'remote-form',
        method: 'dialog',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (screen() === 'on' && !busy.val) add();
        },
      },
      header(h2({ id: 'remote-title' }, 'Open on another device')),
      section(
        { class: 'remote-body' },
        p({ class: 'remote-message', hidden: () => message() === null }, () => message() ?? ''),
        p({ class: 'remote-message', hidden: () => info.val !== null || problem.val !== null }, 'Loading…'),
        p({ class: 'remote-error', role: 'alert', hidden: () => problem.val === null }, () => problem.val ?? ''),
        Switch(),
        AddDevice(),
        NewDevice(),
        Devices(),
      ),
      footer(button({ type: 'button', class: 'btn', 'data-variant': 'outline', onclick: () => el.close() }, 'Close')),
    ),
  );
  return el;
}

// Opens the dialog; held off while the gate is up. The dialog is made on first
// use, so the page starts without it.
export function openRemote(): void {
  if (gateMode.val !== null) return;
  // The palette is a modal too: it closes first, as for Show welcome.
  const palette = document.getElementById('palette') as HTMLDialogElement | null;
  if (palette?.open) palette.close();
  if (!host) {
    host = Remote();
    document.body.append(host);
  }
  if (host.open) return;
  info.val = null;
  problem.val = null;
  // An add still in flight when the dialog closed has set its link since.
  forget();
  host.showModal();
  void refresh();
}
