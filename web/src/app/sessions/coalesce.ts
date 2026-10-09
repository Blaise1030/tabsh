// Coalesces a terminal's live output: chunks that arrive within a frame are
// joined and handed to xterm as one write when the frame comes, so a burst
// costs one parse per frame instead of one per socket message. No DOM here:
// the caller passes requestAnimationFrame (or a test's frames).
export interface Coalescer {
  // Queue a chunk; the next frame writes it after the ones before it.
  push(bytes: Uint8Array): void;
  // The attach's scrollback replay: written at once, not coalesced, with
  // xterm's parsed callback (which ends parsingReplay). Output pending from
  // an older socket is dropped first: the replay already holds it.
  replay(bytes: Uint8Array, parsed: () => void): void;
  // Forget what is pending: the socket is parked or closed, and the next
  // attach replays the scrollback anyway.
  drop(): void;
}

export function coalescer(
  write: (bytes: Uint8Array, parsed?: () => void) => void,
  schedule: (fn: () => void) => number,
  cancel: (handle: number) => void,
): Coalescer {
  let pending: Uint8Array[] = [];
  let size = 0;
  let handle: number | null = null;

  const take = (): Uint8Array | null => {
    if (!pending.length) return null;
    const chunks = pending;
    const total = size;
    pending = [];
    size = 0;
    if (chunks.length === 1) return chunks[0];
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.length;
    }
    return joined;
  };
  const drop = () => {
    if (handle !== null) cancel(handle);
    handle = null;
    pending = [];
    size = 0;
  };

  return {
    push(bytes) {
      pending.push(bytes);
      size += bytes.length;
      if (handle !== null) return;
      handle = schedule(() => {
        handle = null;
        const bytes = take();
        if (bytes) write(bytes);
      });
    },
    replay(bytes, parsed) {
      drop();
      write(bytes, parsed);
    },
    drop,
  };
}
