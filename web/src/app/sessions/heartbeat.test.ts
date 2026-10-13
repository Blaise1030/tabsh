import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heartbeat, type Timers } from './heartbeat.ts';

// Timers run by hand: `advance(ms)` fires whatever falls due.
function clock(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) {
      due.set(next, { at: now + ms, fn });
      return next++;
    },
    clear(id) {
      due.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const [id, t] = [...due].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        if (id === undefined || !t) break;
        due.delete(id);
        now = t.at;
        t.fn();
      }
      now = end;
    },
  };
}

test('a ping answered in time keeps the socket', () => {
  const t = clock();
  const sent: number[] = [];
  let dead = 0;
  const hb = heartbeat(
    (n) => sent.push(n),
    () => dead++,
    t,
    1000,
    300,
  );
  t.advance(1000);
  assert.deepEqual(sent, [1]);
  hb.pong(1);
  t.advance(1000);
  hb.pong(2);
  t.advance(1000);
  hb.pong(3);
  t.advance(200);
  assert.deepEqual(sent, [1, 2, 3]);
  assert.equal(dead, 0);
});

test('a ping left unanswered declares the socket dead, once, and stops', () => {
  const t = clock();
  const sent: number[] = [];
  let dead = 0;
  heartbeat(
    (n) => sent.push(n),
    () => dead++,
    t,
    1000,
    300,
  );
  t.advance(1300);
  assert.equal(dead, 1);
  t.advance(5000);
  assert.equal(dead, 1);
  assert.deepEqual(sent, [1]);
});

test('probe pings at once, and only one ping is awaited at a time', () => {
  const t = clock();
  const sent: number[] = [];
  const hb = heartbeat(
    (n) => sent.push(n),
    () => {},
    t,
    1000,
    300,
  );
  hb.probe();
  hb.probe();
  assert.deepEqual(sent, [1]);
  hb.pong(1);
  hb.probe();
  assert.deepEqual(sent, [1, 2]);
});

test('an old pong does not answer the newer ping', () => {
  const t = clock();
  let dead = 0;
  const hb = heartbeat(
    () => {},
    () => dead++,
    t,
    1000,
    300,
  );
  hb.probe();
  hb.pong(0);
  t.advance(300);
  assert.equal(dead, 1);
});

test('stop ends the pings and the wait', () => {
  const t = clock();
  const sent: number[] = [];
  let dead = 0;
  const hb = heartbeat(
    (n) => sent.push(n),
    () => dead++,
    t,
    1000,
    300,
  );
  hb.probe();
  hb.stop();
  t.advance(5000);
  hb.probe();
  assert.deepEqual(sent, [1]);
  assert.equal(dead, 0);
});
