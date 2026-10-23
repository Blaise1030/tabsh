import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeToolCall, toolCallId, toolDetail, toolSummary } from './tool.ts';

test('toolCallId reads ACP camelCase', () => {
  assert.equal(toolCallId({ toolCallId: 'tc-1' }), 'tc-1');
  assert.equal(toolCallId({ title: 'shell' }), null);
});

test('mergeToolCall keeps title and appends content', () => {
  const merged = mergeToolCall(
    { toolCallId: 'tc-1', title: 'shell', status: 'pending' },
    {
      toolCallId: 'tc-1',
      title: 'ls -la',
      status: 'completed',
      content: [{ content: { text: 'out' } }],
    },
  ) as Record<string, unknown>;
  assert.equal(merged.title, 'ls -la');
  assert.equal(merged.status, 'completed');
  assert.deepEqual(merged.content, [{ content: { text: 'out' } }]);
});

test('mergeToolCall ignores empty title patches', () => {
  const merged = mergeToolCall({ title: 'shell' }, { title: '' }) as Record<string, unknown>;
  assert.equal(merged.title, 'shell');
});

test('toolSummary stays short; command is for the body', () => {
  assert.equal(toolSummary({ name: 'shell', title: 'ls -la /tmp', rawInput: { command: 'ls -la /tmp' } }), 'shell');
  assert.equal(toolSummary({ title: 'Read', name: 'Read' }), 'Read');
  assert.equal(toolSummary({ title: 'ls -la /tmp', rawInput: { command: 'ls -la /tmp' } }), 'Tool');
});

test('toolDetail shows command, cwd, and output', () => {
  assert.equal(
    toolDetail({
      title: 'shell',
      rawInput: { command: 'ls', cwd: '/tmp' },
      content: [{ content: { text: 'a\nb' } }],
    }),
    'ls\n\ncwd: /tmp\n\na\nb',
  );
});
