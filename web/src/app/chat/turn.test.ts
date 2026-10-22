// Stop is shown while a turn has no ending, and a permission row names the tool.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permissionLabel, turnOpen } from './turn.ts';

test('a turn is open from the user message until it ends or fails', () => {
  assert.equal(turnOpen([]), false);
  assert.equal(turnOpen([{ type: 'user_text' }]), true);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'permission' }]), true);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'turn_end' }]), false);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'error' }]), false);
  assert.equal(turnOpen([{ type: 'user_text' }, { type: 'turn_end' }, { type: 'user_text' }]), true);
});

test('a permission row names the tool', () => {
  assert.equal(permissionLabel({ title: 'Fake tool' }), 'Fake tool');
  assert.equal(permissionLabel({ name: 'Bash' }), 'Bash');
  assert.equal(permissionLabel({ title: '  ' }), 'Permission requested');
  assert.equal(permissionLabel(null), 'Permission requested');
});
