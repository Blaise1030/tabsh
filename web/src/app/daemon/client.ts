// Talking to the daemon: authenticated requests, the sessions API, and the
// gate shown while the daemon can't be reached.
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

const gate = document.getElementById('gate') as HTMLElement;
let wake = () => {};

// Holds startup until the daemon answers, showing why it can't be reached.
export async function waitForDaemon(): Promise<void> {
  for (;;) {
    let status = 0;
    try {
      status = (await daemonFetch('/api/about')).status;
    } catch {}
    if (status === 200) {
      gate.hidden = true;
      return;
    }
    const mode = status === 401 ? 'pair' : MIXED_BLOCKED ? 'safari' : 'offline';
    for (const el of gate.querySelectorAll<HTMLElement>('[data-gate]')) el.hidden = el.dataset.gate !== mode;
    gate.hidden = false;
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
