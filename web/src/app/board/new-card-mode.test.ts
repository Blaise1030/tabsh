import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Provider } from '../settings/schema.ts';
import { canUseUi, openTabCreateBody } from './new-card-mode.ts';

const provider = (acp?: string): Provider => ({
  name: 'Test',
  command: 'test {prompt}',
  resume: '',
  ...(acp !== undefined ? { acp } : {}),
});

test('canUseUi is true only when the provider has an ACP command', () => {
  assert.equal(canUseUi(provider('npx acp')), true);
  assert.equal(canUseUi(provider('')), false);
  assert.equal(canUseUi(provider()), false);
  assert.equal(canUseUi(undefined), false);
});

test('openTabCreateBody sends acp_command only for UI mode', () => {
  const base = { prompt: 'hi', command: 'claude {prompt}', resume: 'claude --resume {session}' };
  const p = provider('npx acp');
  assert.deepEqual(openTabCreateBody(base, p, 'tui'), { ...base, mode: 'tui' });
  assert.deepEqual(openTabCreateBody(base, p, 'ui'), { ...base, mode: 'ui', acp_command: 'npx acp' });
  assert.deepEqual(openTabCreateBody(base, provider(), 'ui'), { ...base, mode: 'ui' });
});
