// Open on another device, as the palette's pages show it: what the daemon
// holds, the device just added (its link, shown once, and its QR code) and
// the changes. The link carries the device's token: it lives only here while
// those pages are open, never in storage, the address bar or the console.
import { ApiError } from '../daemon/client.ts';
import { addDevice, getRemote, revokeDevice, setSharing } from './api.ts';
import type { RemoteInfo } from './model.ts';
import { qrSvg } from './qr.ts';

export interface RemoteView {
  // null while the first answer is awaited.
  info: RemoteInfo | 'forbidden' | null;
  problem: string | null;
  busy: boolean;
  added: { id: string; url: string; qr: SVGSVGElement | null } | null;
}

const EMPTY: RemoteView = { info: null, problem: null, busy: false, added: null };
let view = EMPTY;
// Bumped by `forgetRemote`, so an answer for pages since left is dropped.
let session = 0;
let changed = () => {};

export const remoteView = (): RemoteView => view;

// The palette redraws its page with this.
export function onRemoteChange(fn: () => void): void {
  changed = fn;
}

function set(next: Partial<RemoteView>): void {
  view = { ...view, ...next };
  changed();
}

function failure(e: unknown): string {
  return e instanceof ApiError ? `That did not work (${e.status}).` : 'Could not reach tabsh.';
}

// Drops everything, the link included: the pages were left.
export function forgetRemote(): void {
  session++;
  view = EMPTY;
}

// Reads what the daemon holds, keeping any message a change set.
export async function loadRemote(): Promise<void> {
  const at = session;
  try {
    const info = await getRemote();
    if (at === session) set({ info });
  } catch (e) {
    if (at === session) set({ problem: failure(e) });
  }
}

// Runs one change at a time; whatever happens, the page then shows what the
// daemon holds.
async function change(work: (at: number) => Promise<void>): Promise<void> {
  if (view.busy) return;
  const at = session;
  set({ busy: true, problem: null });
  let problem: string | null = null;
  try {
    await work(at);
  } catch (e) {
    problem = failure(e);
  }
  if (at !== session) return;
  await loadRemote();
  if (at !== session) return;
  set({ busy: false, problem: problem ?? view.problem });
}

export const toggleSharing = (): Promise<void> =>
  change(async (at) => {
    const on = view.info !== null && view.info !== 'forbidden' && view.info.enabled;
    const info = await setSharing(!on);
    if (at === session) set({ info, added: on ? null : view.added });
  });

export const addRemoteDevice = (name: string): Promise<void> =>
  change(async (at) => {
    set({ added: null });
    const device = await addDevice(name);
    if (at !== session) return;
    // The link is shown once, so it goes up before the QR is drawn: were the
    // encoder's chunk to fail to load, the link would still be there.
    set({ added: { id: device.id, url: device.url, qr: null } });
    try {
      const qr = await qrSvg(device.url);
      if (at === session && view.added?.id === device.id) set({ added: { ...view.added, qr } });
    } catch {
      if (at === session) set({ problem: 'Could not draw the QR code. Use the link instead.' });
    }
  });

export const revokeRemoteDevice = (id: string): Promise<void> =>
  change(async (at) => {
    await revokeDevice(id);
    if (at === session && view.added?.id === id) set({ added: null });
  });
