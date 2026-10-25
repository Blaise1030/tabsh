/** True when the scrollport is within `threshold` px of its bottom (or content fits). */
export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 80,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** Which edges of a scrollport hide content beyond them (for its fades). */
export function scrollFades(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  edge = 2,
): { top: boolean; bottom: boolean } {
  const max = el.scrollHeight - el.clientHeight;
  return {
    top: el.scrollTop > edge,
    bottom: max > edge && el.scrollTop < max - edge,
  };
}
