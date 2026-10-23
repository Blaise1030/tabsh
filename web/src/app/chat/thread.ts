// Pure transcript shaping: coalesce streamed text, fold tool updates into
// one row per toolCallId, then group into rows so the panel can show one
// agent icon per agent turn.
import type { ChatChunk } from './client.ts';
import { mergeToolCall, toolCallId } from './tool.ts';

export interface ChatLine {
  chunk: ChatChunk;
  text: string;
}

export type ChatRole = 'user' | 'agent' | 'error';

export interface ChatBlock {
  role: ChatRole;
  lines: ChatLine[];
}

export function chatLines(chunks: ChatChunk[]): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const chunk of chunks) {
    if (isTool(chunk.type)) {
      const id = toolCallId(chunk.tool_call);
      if (id) {
        const prior = lines.findLast(
          (line) => isTool(line.chunk.type) && toolCallId(line.chunk.tool_call) === id,
        );
        if (prior) {
          prior.chunk = {
            ...prior.chunk,
            type: 'tool_call',
            tool_call: mergeToolCall(prior.chunk.tool_call, chunk.tool_call),
          };
          continue;
        }
      }
      lines.push({ chunk: { ...chunk, type: 'tool_call' }, text: '' });
      continue;
    }
    const last = lines[lines.length - 1];
    if ((chunk.type === 'text_delta' || chunk.type === 'thought_delta') && last?.chunk.type === chunk.type) {
      last.text += chunk.text ?? '';
      continue;
    }
    lines.push({ chunk, text: chunk.text ?? chunk.message ?? '' });
  }
  return lines;
}

function isTool(type: string): boolean {
  return type === 'tool_call' || type === 'tool_call_update';
}

function roleOf(line: ChatLine): ChatRole {
  const t = line.chunk.type;
  if (t === 'error') return 'error';
  if (t === 'user_text') return 'user';
  return 'agent';
}

export function chatBlocks(lines: ChatLine[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const line of lines) {
    const role = roleOf(line);
    const last = blocks[blocks.length - 1];
    if (last && last.role === role && role !== 'error') {
      last.lines.push(line);
      continue;
    }
    blocks.push({ role, lines: [line] });
  }
  return blocks;
}
