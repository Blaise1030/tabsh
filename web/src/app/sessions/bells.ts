// Whether a bell should mark a terminal. Skipped only when that terminal is
// the one on screen in a focused window. Pure.

export function bellsWhen(opts: { onScreen: boolean; windowFocused: boolean; documentHidden: boolean }): boolean {
  return !(opts.onScreen && opts.windowFocused && !opts.documentHidden);
}
