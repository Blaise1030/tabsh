// The one place the app moves: every switch of tab, view, file, explorer or
// palette is a same-document navigation whose query string is the place, so
// Back, Forward and reload walk through the app. Features register a step
// for their part of the place; everything else calls `go()`.
import { changed, fromQuery, HOME, merge, type Place, STEPS, type Step, toQuery } from './place.ts';

// A step applies its part of `to`. `initial` is true only for the place
// applied at startup. A returned patch is a correction: the place couldn't
// be applied as asked (say, the tab is gone), and the URL is fixed with a
// replace once every step has run.
export type Apply = (to: Place, from: Place, signal: AbortSignal, initial: boolean) => Fix | Promise<Fix>;
type Fix = Partial<Place> | undefined;
type How = 'push' | 'replace';
type Info = { to: Place; initial?: boolean };

// `current` is where the app is going (what go() builds on); `applied` is
// what the steps have actually done. They differ while a navigation runs, and
// after one is overtaken mid-way: the next one then still runs the steps it
// never finished.
let current: Place = HOME;
let applied: Place = HOME;
// The tab step ran but the file step didn't finish: `applied`'s file is the
// previous tab's, so the next navigation works the file out again.
let fileStale = false;
const steps = new Map<Step, Apply>();
const guards: ((to: Place, from: Place) => boolean)[] = [];
// go() calls made before startRouter(); folded under its fallback and URL.
const queue: Partial<Place>[] = [];
let started = false;
// The entry a push opened the palette on: leaving the palette from it
// replaces that entry, so Back doesn't land on a closed palette.
let paletteEntryKey: string | null = null;
let leaving = false;
// Sent once the navigation that asked for them has finished.
let fixes: { patch: Partial<Place>; signal: AbortSignal } | null = null;
let refusedKey: string | null = null;

export function onPlace(step: Step, apply: Apply): void {
  steps.set(step, apply);
}

// A guard returning false refuses the move (an unsaved file, say).
export function onLeave(guard: (to: Place, from: Place) => boolean): void {
  guards.push(guard);
}

export function here(): Place {
  return current;
}

// Whether the current entry is the one a push opened the palette on.
export function isPaletteEntry(): boolean {
  return paletteEntryKey !== null && navigation.currentEntry?.key === paletteEntryKey;
}

// A navigation's promises reject when it is refused or overtaken; that is
// not an error here.
function quiet(r: NavigationResult): Promise<unknown> {
  r.committed.catch(() => {});
  return r.finished.catch(() => {});
}

const urlFor = (p: Place) => location.pathname + toQuery(p, new URLSearchParams(location.search));

export function go(patch: Partial<Place>, how: How = 'push'): void {
  if (!started) {
    queue.push(patch);
    return;
  }
  // A push still closes the palette; from the palette's own entry it
  // replaces that entry, so Back goes to before the palette.
  const to = merge(current, patch, how);
  const history = how === 'push' && current.palette && isPaletteEntry() ? 'replace' : how;
  const url = urlFor(to);
  if (url === location.pathname + location.search) return;
  quiet(navigation.navigate(url, { history, info: { to } satisfies Info }));
}

export function back(): void {
  if (navigation.canGoBack) quiet(navigation.back());
}

// The palette's "Go back" item: a traversal started as the
// palette closes. The close must not start a navigation over it (`leaving`).
// If the traversal is refused or fails, the palette is already shut, so the
// place drops it too.
function leavePalette(r: NavigationResult): void {
  leaving = true;
  r.committed.catch(() => {});
  r.finished.catch(() => {
    leaving = false;
    if (current.palette) go({ palette: null }, 'replace');
  });
}

// Back from the palette's own entry: past the entry the palette opened on,
// to the place before it (plain Back would only close the palette).
export function backPastPalette(): void {
  const at = navigation.currentEntry?.index ?? -1;
  const before = at >= 2 && current.palette && isPaletteEntry() ? navigation.entries()[at - 2] : undefined;
  if (before) leavePalette(navigation.traverseTo(before.key));
  else if (navigation.canGoBack) leavePalette(navigation.back());
}

// A traversal off the palette's entry is on its way: the palette's close
// must not start another navigation over it.
export function isLeavingPalette(): boolean {
  return leaving;
}

export function forward(): void {
  if (navigation.canGoForward) quiet(navigation.forward());
}

// A URL typed, reloaded or walked to: its query over the empty place, keeping
// the current tab when it names none.
function placeOf(q: URLSearchParams): Place {
  return merge({ ...HOME, tab: current.tab }, fromQuery(q), 'replace');
}

// `applied` with `step`'s part taken from `to`.
function withStep(p: Place, to: Place, step: Step): Place {
  if (step === 'file') return { ...p, file: to.file, line: to.line };
  return { ...p, [step]: to[step] };
}

// What a navigation moves from. With a stale file, no tab and no file: the
// file step then adopts or opens, never closes the wrong tab's file, and the
// guard doesn't ask about it.
function appliedFrom(): Place {
  return fileStale ? { ...applied, tab: null, file: null, line: null } : applied;
}

function onNavigate(e: NavigateEvent): void {
  leaving = false;
  if (!e.canIntercept || e.hashChange || e.downloadRequest !== null || e.navigationType === 'reload') return;
  const dest = new URL(e.destination.url);
  if (dest.origin !== location.origin || dest.pathname !== location.pathname) return;
  const info = e.info as Info | undefined;
  const to = info?.to ?? placeOf(dest.searchParams);
  const initial = !!info?.initial;
  if (!initial && guards.some((guard) => !guard(to, appliedFrom()))) {
    if (e.cancelable) {
      e.preventDefault();
      return;
    }
    // Back or Forward that can't be cancelled: let it land, then walk back.
    const key = navigation.currentEntry?.key ?? null;
    e.intercept({
      focusReset: 'manual',
      handler: async () => {
        refusedKey = key;
      },
    });
    return;
  }
  // Focus is the steps' to move (a tab's terminal, a file's editor): left
  // to the browser, every move that focuses nothing (the explorer, the
  // palette closing, a file's line) would drop the keyboard on the page.
  e.intercept({
    focusReset: 'manual',
    handler: async () => {
      const before = current;
      const from = appliedFrom();
      current = to;
      if (e.navigationType === 'push' && !before.palette && to.palette) {
        paletteEntryKey = navigation.currentEntry?.key ?? null;
      }
      // The tab step always runs at startup; after it, the file step always
      // does (the file is the tab's), as it does after one left unfinished.
      const due = changed(applied, to);
      const run = STEPS.filter(
        (s) =>
          due.includes(s) ||
          (s === 'tab' && initial) ||
          (s === 'file' && (fileStale || initial || due.includes('tab'))),
      );
      const patch: Partial<Place> = {};
      for (const step of run) {
        if (e.signal.aborted) break;
        const apply = steps.get(step);
        try {
          if (apply) Object.assign(patch, (await apply(to, from, e.signal, initial)) ?? {});
        } catch (err) {
          console.error(err);
        }
        // A step overtaken while it ran (a file still loading) dropped its result.
        if (!e.signal.aborted) {
          applied = withStep(applied, to, step);
          if (step === 'tab') fileStale = run.includes('file');
          if (step === 'file') fileStale = false;
        }
      }
      if (!e.signal.aborted && Object.keys(patch).length) fixes = { patch, signal: e.signal };
    },
  });
}

function onSuccess(): void {
  if (refusedKey) {
    const key = refusedKey;
    refusedKey = null;
    quiet(navigation.traverseTo(key));
    return;
  }
  const f = fixes;
  fixes = null;
  if (f && !f.signal.aborted) go(f.patch, 'replace');
}

// Applies the URL over `fallback`, over any go() made before now (startup's
// own defaults, such as sync() picking a first tab), and writes the result
// back with a replace. With HOME as `from`, every step whose part differs
// runs, and the tab step always does.
export async function startRouter(fallback: Partial<Place>): Promise<void> {
  let to = HOME;
  for (const patch of queue.splice(0)) to = merge(to, patch, 'replace');
  to = merge(to, fallback, 'replace');
  to = merge(to, fromQuery(new URLSearchParams(location.search)), 'replace');
  started = true;
  navigation.addEventListener('navigate', onNavigate);
  navigation.addEventListener('navigatesuccess', onSuccess);
  await quiet(navigation.navigate(urlFor(to), { history: 'replace', info: { to, initial: true } satisfies Info }));
}
