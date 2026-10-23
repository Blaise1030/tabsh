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

test('toolSummary prefers the shell command', () => {
  assert.equal(
    toolSummary({ title: 'shell', rawInput: { command: 'ls -la /tmp' } }),
    'ls -la /tmp',
  );
  assert.equal(toolSummary({ title: 'Read', name: 'Read' }), 'Read');
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
