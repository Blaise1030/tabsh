// Pending user lines shown before the SSE transcript catches up.
import type { ChatChunk } from './client.ts';

export function withOptimisticUser(chunks: ChatChunk[], pending: string[]): ChatChunk[] {
  if (!pending.length) return chunks;
  return [...chunks, ...pending.map((text) => ({ type: 'user_text', text }))];
}

// Drop the first pending line that matches the server's user_text (or a
// failed send), so the optimistic row does not double up.
export function takePending(pending: string[], text: string): string[] {
  const i = pending.indexOf(text);
  if (i < 0) return pending;
  return pending.filter((_, j) => j !== i);
}
