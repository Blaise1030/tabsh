// What a drop types at the prompt: shell-quoted paths.
export const shellQuote = (p: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;

// file:// URLs some apps put on the drag (no upload needed), as paths.
export function localPaths(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .filter((l) => l.startsWith('file://'))
    .map((l) => {
      try {
        return decodeURIComponent(new URL(l).pathname);
      } catch {
        return null;
      }
    })
    .filter((p): p is string => !!p);
}
