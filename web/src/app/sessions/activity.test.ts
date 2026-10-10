import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityEffect } from './activity.ts';

// Parked a while ago, not the active tab.
const parked = { closed: false, parkedMs: 10_000, active: false };
const none = { unread: false, ring: false };

test('output from a parked, inactive tab marks it unread', () => {
  assert.deepEqual(activityEffect(parked, 'output', 0), { unread: true, ring: false });
});

test('a bell from a parked, inactive tab marks it unread and rings it', () => {
  assert.deepEqual(activityEffect(parked, 'bell', 0), { unread: true, ring: true });
});

test('a tab that never connected counts as parked', () => {
  assert.deepEqual(activityEffect({ ...parked, parkedMs: Number.POSITIVE_INFINITY }, 'output', 0), {
    unread: true,
    ring: false,
  });
});

test('output from the active tab, parked or not, is not unread: it is the one you came back to', () => {
  assert.deepEqual(activityEffect({ ...parked, active: true }, 'output', 0), none);
});

test('a bell from the active tab while parked rings it: ring() decides whether you are looking', () => {
  assert.deepEqual(activityEffect({ ...parked, active: true }, 'bell', 0), { unread: false, ring: true });
});

test('a connected tab is left to its socket, so it never rings twice', () => {
  assert.deepEqual(activityEffect({ ...parked, parkedMs: null }, 'bell', 0), none);
  assert.deepEqual(activityEffect({ ...parked, parkedMs: null }, 'output', 0), none);
});

test('trailing output printed before the tab parked was already on screen', () => {
  assert.deepEqual(activityEffect({ ...parked, parkedMs: 300 }, 'output', 900), none);
});

test('trailing output printed after the tab parked marks it unread', () => {
  assert.deepEqual(activityEffect({ ...parked, parkedMs: 900 }, 'output', 300), { unread: true, ring: false });
});

test('a closed or unknown tab is left alone', () => {
  assert.deepEqual(activityEffect({ ...parked, closed: true }, 'bell', 0), none);
  assert.deepEqual(activityEffect(undefined, 'bell', 0), none);
});

test('an unknown kind of activity does nothing', () => {
  assert.deepEqual(activityEffect(parked, 'shout', 0), none);
});
