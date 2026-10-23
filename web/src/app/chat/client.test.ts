// SSE frames from GET /api/sessions/{id}/chat/stream: one UiChunk per data
// line, comments for keep-alives, and a full replay at the start of each
// connection. These fail if a frame is dropped, an error stays silent, or a
// reconnect appends the replay onto the transcript it already showed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStream, errorNotice, failureText, feedSse, postFailure } from './client.ts';

test('feedSse reads a text_delta, skips a keep-alive, and holds a split frame', () => {
  const head = ': keep-alive\n\ndata: {"type":"text_delta","session_id":"s1","text":"h';
  const first = feedSse('', head);
  assert.deepEqual(first.chunks, []);
  assert.match(first.rest, /text_delta/);

  const second = feedSse(first.rest, 'i"}\n\n');
  assert.deepEqual(second.chunks, [{ type: 'text_delta', session_id: 's1', text: 'hi' }]);
  assert.equal(second.rest, '');
});

test('feedSse skips a data line that is not JSON and keeps the next chunk', () => {
  const fed = feedSse('', 'data: not-json\n\ndata: {"type":"text_delta","session_id":"s","text":"ok"}\n\n');
  assert.deepEqual(fed.chunks, [{ type: 'text_delta', session_id: 's', text: 'ok' }]);
});

test('feedSse turns spawn and auth stream events into inline errors', () => {
  const spawn = feedSse(
    '',
    'event: error\ndata: {"message":"failed to spawn ACP agent `cursor-agent`: No such file or directory"}\n\n',
  );
  assert.equal(spawn.chunks.length, 1);
  assert.equal(spawn.chunks[0]?.type, 'error');
  assert.equal(spawn.chunks[0]?.message, 'failed to spawn ACP agent `cursor-agent`: No such file or directory');
  assert.match(errorNotice(spawn.chunks[0]?.message ?? '').hint ?? '', /TUI/);

  const auth = feedSse('', 'data: {"type":"error","session_id":"s","message":"not logged in"}\n\n');
  assert.equal(auth.chunks[0]?.type, 'error');
  assert.equal(auth.chunks[0]?.message, 'not logged in');
  assert.match(errorNotice(auth.chunks[0]?.message ?? '').hint ?? '', /CLI/);
});

test('applyStream uses one connection replay as the transcript', () => {
  const replay =
    'data: {"type":"user_text","session_id":"s","text":"hi"}\n\n' +
    'data: {"type":"text_delta","session_id":"s","text":"yo"}\n\n' +
    'data: {"type":"turn_end","session_id":"s","stop_reason":"end_turn"}\n\n';
  const first = applyStream([], replay);
  const again = applyStream(first, replay);
  assert.equal(again.filter((c) => c.type === 'user_text').length, 1);
  assert.equal(again.filter((c) => c.type === 'text_delta').length, 1);
  assert.equal(again.length, 3);
});

test('postFailure tells the user when the agent failed to start', () => {
  assert.match(postFailure(502), /TUI/);
  assert.match(postFailure(409), /terminal/i);
});

test('failureText keeps the daemon spawn string and the 409 copy', () => {
  const raw = 'failed to spawn ACP agent `cursor-agent`: No such file or directory';
  assert.equal(failureText(502, JSON.stringify({ message: raw })), raw);
  assert.match(errorNotice(failureText(502, JSON.stringify({ message: raw }))).hint ?? '', /TUI/);
  assert.match(failureText(409, JSON.stringify({ message: 'a PTY is live for session x' })), /terminal/i);
  assert.match(failureText(502, ''), /TUI/);
});
