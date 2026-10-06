import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Activity,
  type ActivityFrame,
  activityView,
  bellRings,
  IDLE,
  onBell,
  onFrame,
  onReattach,
  onVisit,
} from './activity-view.ts';

const a = (state: ActivityFrame, doneUnseen = false, hooked = false, asking = false): Activity => ({
  state,
  doneUnseen,
  hooked,
  asking,
});
// A tab whose agent has spoken in this page: any frame hooks it.
const spoken = (state: ActivityFrame, doneUnseen = false): Activity => a(state, doneUnseen, true);

// The marker for a state is the same whichever tab you're looking at.
test('running shows the spinner, and never badges the favicon or title', () => {
  for (const active of [false, true])
    for (const focused of [false, true])
      assert.deepEqual(activityView(spoken('running'), active, focused), { marker: 'spinner', badge: false });
});

test('needs-input shows the dot; the badge lights unless you are watching that tab', () => {
  assert.deepEqual(activityView(spoken('needs-input'), false, true), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(spoken('needs-input'), true, false), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(spoken('needs-input'), true, true), { marker: 'dot', badge: false });
  assert.deepEqual(activityView(spoken('needs-input'), false, false), { marker: 'dot', badge: true });
});

test('idle shows ✓ done only when it ran before and you have not visited since', () => {
  for (const active of [false, true])
    for (const focused of [false, true])
      assert.deepEqual(activityView(spoken('idle', true), active, focused), { marker: 'done', badge: false });
  assert.deepEqual(activityView(spoken('idle'), true, true), { marker: null, badge: false });
});

// What clears what: any new state ends the last one's marker, and only
// running → idle counts as "done".
test('frames: any new state ends the last marker; only running → idle is done', () => {
  assert.deepEqual(onFrame(spoken('running'), 'idle'), a('idle', true, true));
  assert.deepEqual(onFrame(spoken('needs-input'), 'idle'), a('idle', false, true));
  assert.deepEqual(onFrame(spoken('idle', true), 'running'), a('running', false, true));
  assert.deepEqual(onFrame(spoken('idle'), 'idle'), a('idle', false, true));
});

test('a repeated frame changes nothing but the hook mark (attaches can replay it)', () => {
  // Already spoken: nothing moves, not even a BEL-derived ask.
  const asking = a('running', false, true, true);
  assert.deepEqual(onFrame(asking, 'running'), asking);
  assert.deepEqual(onFrame(spoken('idle', true), 'idle'), spoken('idle', true));
  // First time heard: the replayed frame still proves the agent speaks.
  assert.deepEqual(onFrame(a('running'), 'running'), spoken('running'));
});

test('visiting clears the done marker; the dot is the agent state, not unread output', () => {
  assert.deepEqual(onVisit(spoken('idle', true)), spoken('idle'));
  assert.deepEqual(onVisit(spoken('needs-input')), spoken('needs-input'));
  assert.deepEqual(onVisit(spoken('running')), spoken('running'));
});

test('every session starts idle, unspoken, with nothing to show', () => {
  assert.deepEqual(IDLE, { state: 'idle', doneUnseen: false, hooked: false, asking: false });
  assert.deepEqual(activityView(IDLE, false, false), { marker: null, badge: false });
});

// The badge follows watching, not the frame's arrival: the same state that
// showed nothing while you watched lights the badge the moment you look
// away (bell.ts recomputes it on blur and on going hidden).
test('a needs-input tab you were watching badges when you look away', () => {
  const needing = spoken('needs-input');
  assert.equal(activityView(needing, true, true).badge, false); // watched
  assert.equal(activityView(needing, true, false).badge, true); // same state, looked away
  assert.equal(activityView(needing, false, false).badge, true); // another tab, page hidden
});

// A socket that reattached starts over: a restarted daemon's sessions are
// all idle (idle is unspoken), so whatever the page showed is stale. The
// hook mark is the page's, not the socket's, so it survives. Real activity
// is re-stated by the attach intro or a live frame right after.
test('a reconnect resets to idle, keeps the hook mark, and the intro restores what is still true', () => {
  assert.deepEqual(onReattach(IDLE), IDLE);
  assert.deepEqual(onReattach(a('running', false, true, true)), spoken('idle'));
  // A live daemon that still needs you re-states it after the history.
  assert.deepEqual(onFrame(onReattach(spoken('needs-input')), 'needs-input'), spoken('needs-input'));
  // A restarted one says nothing (idle) and the tab stays clear.
  assert.deepEqual(activityView(onReattach(spoken('running')), false, false).marker, null);
});

// The BEL rule: once a tab has had hook activity in this page, its BELs
// are the agent's, not the shell's — a working agent that rings is asking
// for you; an idle one's beeps (zsh's focus codes) mark nothing. A tab
// that never spoke keeps today's bell.
test('a BEL while running asks for you: the dot replaces the spinner, with the badge rules', () => {
  const asking = onBell(spoken('running'));
  assert.deepEqual(asking, { state: 'running', doneUnseen: false, hooked: true, asking: true });
  assert.deepEqual(activityView(asking, false, false), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(asking, true, false), { marker: 'dot', badge: true });
  assert.deepEqual(activityView(asking, true, true), { marker: 'dot', badge: false });
  // Repeated BELs while it still runs change nothing further.
  assert.deepEqual(onBell(asking), asking);
});

test('a BEL while needs-input or idle changes nothing at all', () => {
  // Already asking: the dot is the agent's state, not unread output.
  assert.deepEqual(onBell(spoken('needs-input')), spoken('needs-input'));
  // Idle: a stray BEL cannot mark the tab.
  assert.deepEqual(onBell(spoken('idle')), spoken('idle'));
  assert.deepEqual(onBell(spoken('idle', true)), spoken('idle', true));
});

test('only a tab that never spoke keeps the bell', () => {
  assert.equal(bellRings(IDLE), true);
  assert.equal(bellRings(a('running')), true);
  assert.equal(bellRings(spoken('running')), false);
  assert.equal(bellRings(spoken('idle')), false);
  assert.equal(bellRings(spoken('needs-input')), false);
  // Its BELs are not ours to interpret: the activity is untouched.
  assert.deepEqual(onBell(a('running')), a('running'));
});

test('the next daemon state replaces a BEL-derived ask', () => {
  const asking = onBell(spoken('running'));
  // The agent kept running: back to the spinner it reported.
  assert.deepEqual(onFrame(asking, 'running'), asking);
  // It finished: ✓ done — the ask is gone, running → idle is still done.
  assert.deepEqual(onFrame(asking, 'idle'), a('idle', true, true));
  // It asked properly: the real state, not the BEL's guess.
  assert.deepEqual(onFrame(asking, 'needs-input'), spoken('needs-input'));
});

// The ask is display-only, and the proof is the type: onBell returns just
// the Activity to show (deep equality leaves no room for a "send" field),
// and nothing else in the module reaches the daemon.
test('a BEL-derived ask is display-only: onBell returns nothing to send', () => {
  assert.deepEqual(onBell(spoken('running')), { state: 'running', doneUnseen: false, hooked: true, asking: true });
});
