export type Kind = 'dir' | 'text' | 'html' | 'markdown' | 'svg' | 'image' | 'pdf' | 'binary';
export interface FileInfo { path: string; kind: Kind; size: number; version: string; content?: string; eol?: 'crlf' | 'lf' }
// The page's daemonFetch: it adds the daemon origin and auth header.
export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export class FileError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(res: Response): FileError {
  const msg = res.status === 404 ? 'Not found'
    : res.status === 403 ? 'Permission denied'
    : res.status === 413 ? 'Too large to open here'
    : `Request failed (${res.status})`;
  return new FileError(res.status, msg);
}

export function filesUrl(session: string, path: string): string {
  return `/api/files?session=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}`;
}

export async function exists(f: Fetcher, session: string, path: string): Promise<boolean> {
  const res = await f(filesUrl(session, path), { method: 'HEAD' });
  return res.status === 200;
}

export async function readFile(f: Fetcher, session: string, path: string): Promise<FileInfo> {
  const res = await f(filesUrl(session, path));
  if (!res.ok) throw fail(res);
  return res.json();
}

export async function rawBlobUrl(f: Fetcher, absPath: string): Promise<string> {
  const res = await f(`/api/files/raw?path=${encodeURIComponent(absPath)}`);
  if (!res.ok) throw fail(res);
  return URL.createObjectURL(await res.blob());
}

export async function saveFile(f: Fetcher, path: string, content: string, version: string): Promise<{ version: string } | { conflict: string }> {
  const res = await f('/api/files', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, version }),
  });
  if (res.status === 409) return { conflict: (await res.json()).version };
  if (!res.ok) throw fail(res);
  return { version: res.headers.get('x-tabsh-version') ?? '' };
}

// The editor works in \n; the file's own line endings are restored on save.
export function fromDisk(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
export function toDisk(text: string, eol: 'crlf' | 'lf'): string {
  return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
}

export function displayPath(absPath: string, base: string | undefined): string {
  if (!base) return absPath;
  const b = base.endsWith('/') ? base : base + '/';
  return absPath.startsWith(b) ? absPath.slice(b.length) : absPath;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let v = bytes / 1024;
  for (const u of ['KB', 'MB', 'GB']) {
    if (v < 1024 || u === 'GB') return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u}`;
    v /= 1024;
  }
  return '';
}
