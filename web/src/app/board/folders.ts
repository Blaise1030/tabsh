// The New card dialog's folder search, without the DOM: showing and reading
// `~`, the request, and moving the highlight through the results.

// A folder with the home folder written as ~.
export function tildify(path: string, home: string | null): string {
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// `~` and `~/x` read with the home folder, once it's known: the daemon only
// takes absolute paths. Anything else, `~bob` too, is left as typed.
export function expandHome(input: string, home: string | null): string {
  if (!home || !(input === '~' || input.startsWith('~/'))) return input;
  return home + input.slice(1);
}

// The highlighted result after an arrow key, wrapping around; -1 for none.
export function moveActive(active: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (active < 0) return delta === 1 ? 0 : count - 1;
  return (active + delta + count) % count;
}

export function foldersUrl(input: string): string {
  return `/api/files/folders?path=${encodeURIComponent(input)}`;
}
