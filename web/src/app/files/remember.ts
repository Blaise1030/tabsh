// Which file each tab shows, kept in this browser so a reload reopens it.
const FILES_KEY = 'tabsh.files';

export function rememberedFiles(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FILES_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// `path` null forgets the tab's file.
export function rememberFile(sessionId: string, path: string | null): void {
  const files = rememberedFiles();
  if (path === null) delete files[sessionId];
  else files[sessionId] = path;
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {}
}
