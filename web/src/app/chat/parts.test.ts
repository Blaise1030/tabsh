import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatChunk } from './client.ts';
import {
  applyChunk,
  applyChunks,
  chatBlocks,
  chatLines,
  emptyTranscript,
  lineSegments,
  replaceTranscript,
  stabilizeBlocks,
  stabilizeSessionBlocks,
} from './thread.ts';

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
  // thought_delta is dropped from the transcript
  assert.equal(grouped[1]?.lines.length, 2);
  assert.equal(grouped[2]?.role, 'user');
});

test('thought_delta lines are omitted', () => {
  const out = chatLines([
    { type: 'thought_delta', text: 'secret' },
    { type: 'text_delta', text: 'hello' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.chunk.type, 'text_delta');
});

test('answered permissions are omitted across reload', () => {
  const out = chatLines([
    {
      type: 'permission',
      request_id: '1',
      tool_call: { title: 'Delete a' },
    },
    {
      type: 'permission',
      request_id: '2',
      tool_call: { title: 'Delete b' },
    },
    { type: 'permission_answered', request_id: '1', allow: true },
    { type: 'text_delta', text: 'ok' },
  ]);
  assert.deepEqual(
    out.map((l) => [l.chunk.type, l.chunk.request_id ?? l.text]),
    [
      ['permission', '2'],
      ['text_delta', 'ok'],
    ],
  );
});

test('queued user lines stay in their own block', () => {
  const grouped = chatBlocks(
    chatLines([
      { type: 'user_text', text: 'sent' },
      { type: 'user_text', text: 'later', queued: true },
    ]),
  );
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.queued, undefined);
  assert.equal(grouped[1]?.queued, true);
});

test('errors are their own block', () => {
  const grouped = chatBlocks(lines({ type: 'error', message: 'boom' }, { type: 'text_delta', text: 'ok' }));
  assert.equal(grouped[0]?.role, 'error');
  assert.equal(grouped[1]?.role, 'agent');
});

test('tool_call updates with the same id fold into one line', () => {
  const grouped = chatLines([
    { type: 'tool_call', tool_call: { toolCallId: 'tc-1', title: 'shell' } },
    { type: 'tool_call_update', tool_call: { toolCallId: 'tc-1', title: 'ls -la', status: 'completed' } },
    { type: 'tool_call', tool_call: { toolCallId: 'tc-2', title: 'Read' } },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.chunk.type, 'tool_call');
  const first = grouped[0]!.chunk.tool_call as { title?: string };
  const second = grouped[1]!.chunk.tool_call as { title?: string };
  assert.equal(first.title, 'ls -la');
  assert.equal(second.title, 'Read');
});

test('lineSegments folds consecutive tools and splits on text', () => {
  const segs = lineSegments(
    lines(
      { type: 'text_delta', text: 'hi' },
      { type: 'tool_call', tool_call: { title: 'Read' } },
      { type: 'tool_call', tool_call: { title: 'grep' } },
      { type: 'text_delta', text: 'done' },
      { type: 'tool_call', tool_call: { title: 'Write' } },
    ),
  );
  assert.deepEqual(
    segs.map((s) => [s.kind, s.lines.length]),
    [
      ['rest', 1],
      ['tools', 2],
      ['rest', 1],
      ['tools', 1],
    ],
  );
});

test('stabilizeBlocks keeps earlier block identity when the last text grows', () => {
  const first = chatBlocks(
    chatLines([
      { type: 'user_text', text: 'hi /tmp/shot.png' },
      { type: 'text_delta', text: 'Hel' },
    ]),
  );
  const second = chatBlocks(
    chatLines([
      { type: 'user_text', text: 'hi /tmp/shot.png' },
      { type: 'text_delta', text: 'Hello' },
    ]),
  );
  const stable = stabilizeBlocks(first, second);
  assert.equal(stable[0], first[0]);
  assert.notEqual(stable[1], first[1]);
  assert.equal(stable[1]?.lines[0]?.text, 'Hello');
});

test('stabilizeBlocks returns the previous array when nothing changed', () => {
  const blocks = chatBlocks(chatLines([{ type: 'user_text', text: 'hi' }]));
  assert.equal(stabilizeBlocks(blocks, chatBlocks(chatLines([{ type: 'user_text', text: 'hi' }]))), blocks);
});

test('stabilizeSessionBlocks does not reuse blocks from another session', () => {
  const fromA = chatBlocks(chatLines([{ type: 'user_text', text: 'from A' }]));
  const fromB = chatBlocks(chatLines([{ type: 'user_text', text: 'from B' }]));
  const prev = { sessionId: 'a', blocks: fromA };
  const next = stabilizeSessionBlocks('b', prev, fromB);
  assert.equal(next.sessionId, 'b');
  assert.notEqual(next.blocks[0], fromA[0]);
  assert.equal(next.blocks[0]?.lines[0]?.text, 'from B');
});

test('applyChunk matches a full rebuild across a mixed stream', () => {
  const chunks: ChatChunk[] = [
    { type: 'user_text', text: 'hi' },
    { type: 'thought_delta', text: 'secret' },
    { type: 'text_delta', text: 'Hel' },
    { type: 'text_delta', text: 'lo' },
    { type: 'tool_call', tool_call: { toolCallId: 't1', title: 'Read' } },
    { type: 'tool_call_update', tool_call: { toolCallId: 't1', status: 'completed' } },
    { type: 'turn_end' },
  ];
  let state = emptyTranscript();
  for (const chunk of chunks) state = applyChunk(state, chunk);
  const full = replaceTranscript(chunks);
  assert.deepEqual(
    state.blocks.map((b) => [b.role, b.lines.map((l) => [l.chunk.type, l.text])]),
    full.blocks.map((b) => [b.role, b.lines.map((l) => [l.chunk.type, l.text])]),
  );
  assert.equal(state.chunks.length, chunks.length);
});

test('applyChunk keeps earlier block identity while text grows', () => {
  let state = applyChunks(emptyTranscript(), [
    { type: 'user_text', text: 'hi' },
    { type: 'text_delta', text: 'Hel' },
  ]);
  const user = state.blocks[0];
  const agent = state.blocks[1];
  state = applyChunk(state, { type: 'text_delta', text: 'lo' });
  assert.equal(state.blocks[0], user);
  assert.notEqual(state.blocks[1], agent);
  assert.equal(state.blocks[1]?.lines[0]?.text, 'Hello');
});

test('applyChunk removes a permission row once it is answered', () => {
  let state = applyChunks(emptyTranscript(), [
    { type: 'permission', request_id: '1', tool_call: { title: 'Delete' } },
    { type: 'text_delta', text: 'ok' },
  ]);
  assert.equal(
    state.blocks.some((b) => b.lines.some((l) => l.chunk.type === 'permission')),
    true,
  );
  state = applyChunk(state, { type: 'permission_answered', request_id: '1', allow: true });
  assert.equal(
    state.blocks.some((b) => b.lines.some((l) => l.chunk.type === 'permission')),
    false,
  );
  assert.equal(replaceTranscript(state.chunks).blocks.length, state.blocks.length);
});
