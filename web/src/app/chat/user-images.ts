// User messages append uploaded image paths after a blank line (withImages).
// Split those off for inline previews while the agent still sees the full text.

const IMAGE_PATH = /^(?:~|\/|\.\/|\.\.\/).+\.(?:png|jpe?g|gif|webp|svg|bmp|heic)$/i;

export function splitAttachedImages(text: string): { body: string; images: string[] } {
  const lines = text.split('\n');
  const images: string[] = [];
  while (lines.length) {
    const last = lines[lines.length - 1]!.trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (IMAGE_PATH.test(last)) {
      images.unshift(last);
      lines.pop();
      continue;
    }
    break;
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return { body: lines.join('\n'), images };
}
