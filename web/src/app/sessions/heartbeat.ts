// Tells a live terminal socket from one a phone's sleep left for dead (iOS
// drops it without a close the page sees): a ping every `every` ms, or at once
// on `probe` (the page waking), and no pong within `wait` ms means dead. Pure:
// timers come in, so `node --test` drives it.

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface Heartbeat {
  probe(): void;
  pong(n: number): void;
  stop(): void;
}

export function heartbeat(
  send: (n: number) => void,
  dead: () => void,
  t: Timers,
  every = 15_000,
  wait = 4_000,
): Heartbeat {
  let n = 0;
  let waiting: number | null = null;
  let tick = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    t.clear(tick);
    if (waiting !== null) t.clear(waiting);
    waiting = null;
  };
  const probe = () => {
    if (stopped || waiting !== null) return;
    n += 1;
    send(n);
    waiting = t.set(() => {
      stop();
      dead();
    }, wait);
  };
  const schedule = () => {
    tick = t.set(() => {
      probe();
      if (!stopped) schedule();
    }, every);
  };
  schedule();
  return {
    probe,
    pong(m) {
      if (m !== n || waiting === null) return;
      t.clear(waiting);
      waiting = null;
    },
    stop,
  };
}
