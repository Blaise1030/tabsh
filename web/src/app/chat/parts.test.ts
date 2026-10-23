import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatChunk } from './client.ts';
import { chatBlocks, chatLines } from './thread.ts';

function lines(...chunks: ChatChunk[]) {
  return chatLines(chunks);
}

test('chatBlocks groups agent lines under one block, user alone', () => {
  const grouped = chatBlocks(
    lines(
      { type: 'user_text', text: 'hi' },
      { type: 'thought_delta', text: 'think' },
      { type: 'text_delta', text: 'hello' },
      { type: 'tool_call', tool_call: { title: 'Read' } },
      { type: 'user_text', text: 'more' },
    ),
  );
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0]?.role, 'user');
  assert.equal(grouped[0]?.lines.length, 1);
  assert.equal(grouped[1]?.role, 'agent');
  assert.equal(grouped[1]?.lines.length, 3);
  assert.equal(grouped[2]?.role, 'user');
});

test('errors are their own block', () => {
  const grouped = chatBlocks(lines({ type: 'error', message: 'boom' }, { type: 'text_delta', text: 'ok' }));
  assert.equal(grouped[0]?.role, 'error');
  assert.equal(grouped[1]?.role, 'agent');
});
