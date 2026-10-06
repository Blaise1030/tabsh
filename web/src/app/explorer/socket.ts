// The explorer's live socket: while the sidebar is open, one connection per
// active tab tells the page what changed on disk. It reconnects with a
// growing delay, like the terminal socket does.
import { watchUrl } from '../daemon/client.ts';
import { type Change, parseChange } from './changes.ts';

const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 15_000;

// Opens the socket for `session`. `onOpen` runs on every (re)connection:
// changes made while it was down are lost, so the page re-fetches then.
// Returns a function that closes it for good.
export function watchFiles(session: string, onOpen: () => void, onChange: (change: Change) => void): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = FIRST_RETRY_MS;
  let stopped = false;

  const connect = () => {
    const socket = new WebSocket(watchUrl(session));
    ws = socket;
    socket.onopen = () => {
      delay = FIRST_RETRY_MS;
      onOpen();
    };
    socket.onmessage = (e) => {
      const change = typeof e.data === 'string' ? parseChange(e.data) : null;
      if (change) onChange(change);
    };
    socket.onclose = () => {
      if (stopped || ws !== socket) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, LAST_RETRY_MS);
    };
  };
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
