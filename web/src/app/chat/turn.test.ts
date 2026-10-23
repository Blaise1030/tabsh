// Stop is shown while a turn has no ending, and a permission row names the tool.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permissionLabel, turnOpen, turnWaiting } from './turn.ts';

test('a turn is open from the user message until it ends or fails', () => {
  assert.equal(turnOpen([]), false);
  assert.equal(turnOpen([{ type: 'user_text' }]), true);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'permission' }]), true);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'turn_end' }]), false);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'error' }]), false);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'turn_end' }, { type: 'user_text' }]), true);
});

test('waiting ends once the agent has produced a visible chunk', () => {
  assert.equal(turnWaiting([{ type: 'user_text' }]), true);
  assert.equal(turnWaiting([{ type: 'user_text' }, { type: 'thought_delta' }]), true);
  assert.equal(turnWaiting([{ type: 'user_text' }, { type: 'text_delta' }]), false);
  assert.equal(turnWaiting([{ type: 'user_text' }, { type: 'tool_call' }]), false);
  assert.equal(turnWaiting([{ type: 'user_text' }, { type: 'turn_end' }]), false);
});

test('queued follow-ups do not reopen waiting after the agent has replied', () => {
  assert.equal(
    turnWaiting([
      { type: 'user_text' },
      { type: 'text_delta' },
      { type: 'user_text', queued: true },
    ]),
    false,
  );
});

test('a permission row names the tool', () => {
  assert.equal(permissionLabel({ title: 'Fake tool' }), 'Fake tool');
  assert.equal(permissionLabel({ name: 'Bash' }), 'Bash');
  assert.equal(permissionLabel({ title: '  ' }), 'Permission requested');
  assert.equal(permissionLabel(null), 'Permission requested');
});
