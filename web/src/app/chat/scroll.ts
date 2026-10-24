/** True when the scrollport is within `threshold` px of its bottom (or content fits). */
export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 80,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}
