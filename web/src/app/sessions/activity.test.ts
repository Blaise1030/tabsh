import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityEffect } from './activity.ts';

const parked = { closed: false, parked: true, active: false };
const none = { unread: false, ring: false };

test('output from a parked, inactive tab marks it unread', () => {
  assert.deepEqual(activityEffect(parked, 'output'), { unread: true, ring: false });
});

test('a bell from a parked, inactive tab marks it unread and rings it', () => {
  assert.deepEqual(activityEffect(parked, 'bell'), { unread: true, ring: true });
});

test('the active tab is left alone', () => {
  assert.deepEqual(activityEffect({ ...parked, active: true }, 'bell'), none);
});

test('a connected tab is left to its socket, so it never rings twice', () => {
  assert.deepEqual(activityEffect({ ...parked, parked: false }, 'bell'), none);
  assert.deepEqual(activityEffect({ ...parked, parked: false }, 'output'), none);
});

test('a closed or unknown tab is left alone', () => {
  assert.deepEqual(activityEffect({ ...parked, closed: true }, 'bell'), none);
  assert.deepEqual(activityEffect(undefined, 'bell'), none);
});

test('an unknown kind of activity does nothing', () => {
  assert.deepEqual(activityEffect(parked, 'shout'), none);
});
