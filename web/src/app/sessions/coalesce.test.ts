import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coalescer } from './coalesce.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

// A writer whose frames run when the test says so.
function rig() {
  const written: string[] = [];
  let frames: (() => void)[] = [];
  let cancelled = 0;
  const c = coalescer(
    (bytes) => written.push(dec.decode(bytes)),
    (fn) => {
      frames.push(fn);
      return frames.length;
    },
    () => {
      cancelled++;
      frames = [];
    },
  );
  const frame = () => {
    const run = frames;
    frames = [];
    for (const fn of run) fn();
  };
  return { c, written, frame, pendingFrames: () => frames.length, cancelled: () => cancelled };
}

test('chunks within a frame become one write, in order', () => {
  const { c, written, frame, pendingFrames } = rig();
  c.push(enc.encode('a'));
  c.push(enc.encode('bc'));
  c.push(enc.encode('d'));
  assert.deepEqual(written, []);
  assert.equal(pendingFrames(), 1); // one frame asked for, not one per chunk
  frame();
  assert.deepEqual(written, ['abcd']);
});

test('each frame writes what arrived since the last one', () => {
  const { c, written, frame } = rig();
  c.push(enc.encode('1'));
  frame();
  c.push(enc.encode('2'));
  c.push(enc.encode('3'));
  frame();
  frame(); // nothing pending: no empty write
  assert.deepEqual(written, ['1', '23']);
});

test('drop discards pending (a park or close: the next attach replays it)', () => {
  const { c, written, frame, cancelled } = rig();
  c.push(enc.encode('stale'));
  c.drop();
  assert.equal(cancelled(), 1);
  frame();
  assert.deepEqual(written, []);
  c.push(enc.encode('fresh'));
  frame();
  assert.deepEqual(written, ['fresh']);
});

test('a single chunk is written as it came (no copy needed)', () => {
  const written: Uint8Array[] = [];
  let run: () => void = () => {};
  const c = coalescer(
    (b) => written.push(b),
    (fn) => {
      run = fn;
      return 1;
    },
    () => {},
  );
  const chunk = enc.encode('solo');
  c.push(chunk);
  run();
  assert.equal(written[0], chunk);
});

test('a replay is written at once with its parsed callback, after dropping stale output', () => {
  const written: string[] = [];
  const callbacks: (() => void)[] = [];
  let frames: (() => void)[] = [];
  const c = coalescer(
    (b, parsed) => {
      written.push(dec.decode(b));
      if (parsed) callbacks.push(parsed);
    },
    (fn) => frames.push(fn),
    () => {
      frames = [];
    },
  );
  c.push(enc.encode('old socket'));
  let parsed = false;
  c.replay(enc.encode('history'), () => {
    parsed = true;
  });
  assert.deepEqual(written, ['history']); // not coalesced, not behind a frame
  assert.equal(callbacks.length, 1); // parsingReplay ends when xterm says so
  callbacks[0]();
  assert.equal(parsed, true);
  c.push(enc.encode('live'));
  for (const fn of frames) fn();
  assert.deepEqual(written, ['history', 'live']); // live output follows the replay
});

test('a push after drop schedules a frame again', () => {
  const { c, written, frame, pendingFrames } = rig();
  c.push(enc.encode('stale'));
  c.drop();
  assert.equal(pendingFrames(), 0);
  c.push(enc.encode('next'));
  assert.equal(pendingFrames(), 1);
  frame();
  assert.deepEqual(written, ['next']);
});

test('a replay cancels a scheduled frame: it never fires later', () => {
  const written: string[] = [];
  const scheduled = new Map<number, () => void>();
  let id = 0;
  const c = coalescer(
    (b) => written.push(dec.decode(b)),
    (fn) => {
      scheduled.set(++id, fn);
      return id;
    },
    (h) => scheduled.delete(h),
  );
  c.push(enc.encode('old socket'));
  assert.equal(scheduled.size, 1);
  c.replay(enc.encode('history'), () => {});
  assert.equal(scheduled.size, 0); // the frame was cancelled, not left to run
  assert.deepEqual(written, ['history']);
});
