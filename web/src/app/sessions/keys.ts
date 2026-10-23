// xterm 5 mapped macOS Option+Arrow to Ctrl+Arrow itself; 6.0 removed that
// (#5346). Shells use Ctrl+Arrow for word jumps, so restore the chord here
// rather than depend on the terminal's default key map.
export function wordJumpSequence(
  key: string,
  mods: { altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  isMac: boolean,
): string | null {
  if (!isMac || !mods.altKey || mods.ctrlKey || mods.metaKey) return null;
  if (key === 'ArrowLeft') return '\x1b[1;5D';
  if (key === 'ArrowRight') return '\x1b[1;5C';
  return null;
}
