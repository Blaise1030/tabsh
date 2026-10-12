// The daemon's /api/remote routes. A device token gets 403 on all of them.
import { ApiError, daemonFetch } from '../daemon/client.ts';
import type { RemoteInfo } from './model.ts';

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await daemonFetch(`/api/remote${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`${method} /api/remote${path}: ${res.status}`, res.status);
  return res;
}

// 'forbidden' when this page holds a device token.
export async function getRemote(): Promise<RemoteInfo | 'forbidden'> {
  try {
    return await (await call('GET', '')).json();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return 'forbidden';
    throw e;
  }
}

// On a failed start the daemon answers with `enabled: false` and `error` set.
export async function setSharing(enabled: boolean): Promise<RemoteInfo> {
  return (await call('PUT', '', { enabled })).json();
}

// `url` carries the device's token and comes back only here.
export async function addDevice(name: string): Promise<{ id: string; name: string; url: string }> {
  return (await call('POST', '/devices', { name })).json();
}

export async function revokeDevice(id: string): Promise<void> {
  await call('DELETE', `/devices/${encodeURIComponent(id)}`);
}
