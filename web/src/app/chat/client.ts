// The browser's side of a UI card's chat. The daemon sends one flat
// `UiChunk` (snake_case, `type`-tagged) as each SSE `data:` line, replays
// the transcript at the start of every connection, and keeps the stream
// alive with `: keep-alive` comments. Spawn and auth failures arrive as an
// `event: error` or a `{type:"error"}` chunk; a failed POST is the same
// idea when the daemon answers with a status and no chunk.

export interface ChatChunk {
  type: string;
  session_id?: string;
  text?: string;
  tool_call?: unknown;
  entries?: unknown;
  request_id?: string;
  options?: unknown;
  stop_reason?: string;
  update?: unknown;
  message?: string;
}

const CHUNK_TYPES = new Set([
  'text_delta',
  'thought_delta',
  'user_text',
  'tool_call',
  'tool_call_update',
  'plan',
  'permission',
  'turn_end',
  'unknown',
  'error',
]);

// Complete frames become chunks. A frame that has not ended in a blank line
// stays in `rest` for the next read.
export function feedSse(buffer: string, incoming: string): { chunks: ChatChunk[]; rest: string } {
  const text = buffer + incoming;
  const parts = text.split('\n\n');
  const rest = parts.pop() ?? '';
  const chunks: ChatChunk[] = [];
  for (const frame of parts) {
    const chunk = chunkFromFrame(frame);
    if (chunk) chunks.push(chunk);
  }
  return { chunks, rest };
}

// One connection's body is the transcript. The daemon replays finished
// turns before anything new, so appending that replay would show them twice.
export function applyStream(previous: ChatChunk[], connectionBody: string): ChatChunk[] {
  void previous;
  return feedSse('', connectionBody).chunks;
}

// What to show under a spawn or auth failure. `hint` is the recovery; null
// when the message is enough on its own.
export function errorNotice(message: string): { text: string; hint: string | null } {
  const lower = message.toLowerCase();
  if (/auth|not logged|login|unauthor/.test(lower)) {
    return { text: message, hint: "Log in with that agent's own CLI, then try again." };
  }
  if (/spawn|not found|no such file|enoent/.test(lower)) {
    return { text: message, hint: 'Install the agent, or switch this card to TUI.' };
  }
  return { text: message, hint: null };
}

// A status with no body. 409 always uses this copy. 502 is the fallback
// when the daemon sent no failure string.
export function postFailure(status: number): string {
  if (status === 502) return 'The agent failed to start. Install it, or switch this card to TUI.';
  if (status === 409) return 'This card already has a terminal running.';
  if (status === 400) return 'That message could not be sent.';
  return `The chat request failed (${status}).`;
}

// The string the panel should show. A 502 body is the daemon's spawn or
// auth error (`{"message":...}`), passed on for `errorNotice`. 409 keeps
// its own copy no matter what the body says.
export function failureText(status: number, body: string): string {
  if (status === 409) return postFailure(409);
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    } catch {
      // A non-JSON body is the message itself.
    }
  }
  if (trimmed) return trimmed;
  return postFailure(status);
}

export async function postMessage(sessionId: string, text: string): Promise<void> {
  const { ApiError, daemonFetch } = await import('../daemon/client.ts');
  const res = await daemonFetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new ApiError(failureText(res.status, await res.text()), res.status);
}

// Reads the stream until it ends or `signal` aborts. Each connection
// starts with the replay; the caller replaces its transcript from these
// chunks rather than appending them to the last connection.
export async function readChatStream(
  sessionId: string,
  signal: AbortSignal,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  const { ApiError, daemonFetch } = await import('../daemon/client.ts');
  const res = await daemonFetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) throw new ApiError(postFailure(res.status), res.status);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const fed = feedSse(rest, decoder.decode(value, { stream: true }));
      rest = fed.rest;
      for (const chunk of fed.chunks) onChunk(chunk);
    }
  } finally {
    reader.releaseLock();
  }
}

function chunkFromFrame(frame: string): ChatChunk | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const raw = data.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (event === 'error') {
    const message = messageOf(parsed);
    return message ? { type: 'error', message } : null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const chunk = parsed as ChatChunk;
  if (typeof chunk.type !== 'string' || !CHUNK_TYPES.has(chunk.type)) return null;
  if (chunk.type === 'error') {
    const message = messageOf(parsed);
    return message ? { type: 'error', message } : null;
  }
  return chunk;
}

function messageOf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object' || !('message' in value)) return null;
  const message = (value as { message: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}
