import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Activity, type ActivityFrame, activityView, IDLE, onFrame, onVisit } from './activity-view.ts';

const a = (state: ActivityFrame, doneUnseen = false): Activity => ({ state, doneUnseen });

// The marker for a state is the same whichever tab you're looking at.
test('running shows the spinner, and never badges the favicon or title', () => {
  for (const active of [false, true])
    for (const focused of [false, true])
      assert.deepEqual(activityView(a('running'), active, focused), { marker: 'spinner', badge: false });
});

test('needs-input shows the dot; the badge lights unless you are watching that tab', () => {
  assert.deepEqual(activityView(a('needs-input'), false, true), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(a('needs-input'), true, false), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(a('needs-input'), true, true), { marker: 'dot', badge: false });
  assert.deepEqual(activityView(a('needs-input'), false, false), { marker: 'dot', badge: true });
});

test('idle shows ✓ done only when it ran before and you have not visited since', () => {
  for (const active of [false, true])
    for (const focused of [false, true])
      assert.deepEqual(activityView(a('idle', true), active, focused), { marker: 'done', badge: false });
  assert.deepEqual(activityView(a('idle', false), true, true), { marker: null, badge: false });
});

// What clears what: any new state ends the last one's marker, and only
// running → idle counts as "done".
test('frames: any new state ends the last marker; only running → idle is done', () => {
  assert.deepEqual(onFrame(a('running'), 'idle'), { state: 'idle', doneUnseen: true });
  assert.deepEqual(onFrame(a('needs-input'), 'idle'), { state: 'idle', doneUnseen: false });
  assert.deepEqual(onFrame(a('idle', true), 'running'), { state: 'running', doneUnseen: false });
  assert.deepEqual(onFrame(a('idle'), 'idle'), { state: 'idle', doneUnseen: false });
});

test('a repeated frame changes nothing (attaches can replay it)', () => {
  assert.deepEqual(onFrame(a('running'), 'running'), a('running'));
  assert.deepEqual(onFrame(a('idle', true), 'idle'), a('idle', true));
});

test('visiting clears the done marker; the dot is the agent state, not unread output', () => {
  assert.deepEqual(onVisit(a('idle', true)), a('idle'));
  assert.deepEqual(onVisit(a('needs-input')), a('needs-input'));
  assert.deepEqual(onVisit(a('running')), a('running'));
});

test('every session starts idle with nothing to show', () => {
  assert.deepEqual(IDLE, { state: 'idle', doneUnseen: false });
  assert.deepEqual(activityView(IDLE, false, false), { marker: null, badge: false });
});
