// Talking to the daemon: authenticated requests, the sessions API, and the
// gate shown while the daemon can't be reached.
import van from 'vanjs-core';
import { DAEMON, LOCAL_APP, MIXED_BLOCKED } from './config.ts';
import { adoptToken, getToken } from './token.ts';

export function daemonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = { ...(init.headers as Record<string, string>), ...(token && { Authorization: `Bearer ${token}` }) };
  return fetch(DAEMON + path, { ...init, headers });
}

// A failed request; `status` is the HTTP status.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Saves a file with the daemon (browsers never reveal a dropped file's own
// path) and returns the path of the saved copy.
export async function uploadFile(file: File): Promise<string> {
  const res = await daemonFetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  if (!res.ok) throw new ApiError(`upload ${file.name}: ${res.status}`, res.status);
  return (await res.json()).path;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await daemonFetch(`/api/sessions${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(`${method} ${path}: ${res.status}`, res.status);
  return res.status === 204 ? null : res.json();
}

// The terminal socket for a session.
export function socketUrl(id: string): string {
  const token = getToken();
  const auth = token ? `&token=${token}` : '';
  return `${DAEMON.replace(/^http/, 'ws')}/ws?id=${id}${auth}`;
}

// The socket telling the explorer what changed on disk in a session's project.
export function watchUrl(session: string): string {
  const token = getToken();
  const auth = token ? `&token=${token}` : '';
  return `${DAEMON.replace(/^http/, 'ws')}/api/files/watch?session=${encodeURIComponent(session)}${auth}`;
}

// Why the daemon can't be reached; null once it answers, hiding the gate.
export type GateMode = 'offline' | 'safari' | 'pair';
export const gateMode = van.state<GateMode | null>(null);
let wake = () => {};

// Holds startup until the daemon answers, showing why it can't be reached.
export async function waitForDaemon(): Promise<void> {
  for (;;) {
    let status = 0;
    try {
      status = (await daemonFetch('/api/about')).status;
    } catch {}
    if (status === 200) {
      gateMode.val = null;
      return;
    }
    gateMode.val = status === 401 ? 'pair' : MIXED_BLOCKED ? 'safari' : 'offline';
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, 2000);
    });
  }
}

// The gate's "Open tabsh" link and the pairing form.
export function initGate(): void {
  (document.getElementById('open-local') as HTMLAnchorElement).href = LOCAL_APP;
  document.getElementById('pair-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('pair-input') as HTMLInputElement;
    if (adoptToken(input.value)) {
      input.value = '';
      wake();
    } else input.setAttribute('aria-invalid', 'true');
  });
}

// The socket telling the page when a card's status changes.
export function boardEventsUrl(): string {
  const token = getToken();
  const auth = token ? `?token=${token}` : '';
  return `${DAEMON.replace(/^http/, 'ws')}/api/board/events${auth}`;
}
