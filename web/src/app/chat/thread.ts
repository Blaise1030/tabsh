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
  /** Waiting in the send queue (not on the wire yet). */
  queued?: boolean;
}

export function chatLines(chunks: ChatChunk[]): ChatLine[] {
  // Answered permissions stay in the JSONL as `permission_answered` so a
  // reload can omit the matching request cards.
  const answered = new Set(
    chunks.filter((c) => c.type === 'permission_answered' && c.request_id).map((c) => c.request_id as string),
  );
  const lines: ChatLine[] = [];
  for (const chunk of chunks) {
    if (chunk.type === 'permission_answered') continue;
    if (chunk.type === 'permission' && chunk.request_id && answered.has(chunk.request_id)) continue;
    if (isTool(chunk.type)) {
      const id = toolCallId(chunk.tool_call);
      if (id) {
        const prior = lines.findLast((line) => isTool(line.chunk.type) && toolCallId(line.chunk.tool_call) === id);
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
    // Thinking is kept out of the transcript UI (still on the wire / JSONL).
    if (chunk.type === 'thought_delta') continue;
    const last = lines[lines.length - 1];
    if (chunk.type === 'text_delta' && last?.chunk.type === chunk.type) {
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
    const queued = !!line.chunk.queued;
    const last = blocks[blocks.length - 1];
    if (last && last.role === role && role !== 'error' && !!last.queued === queued) {
      last.lines.push(line);
      continue;
    }
    blocks.push({ role, lines: [line], queued: queued || undefined });
  }
  return blocks;
}

/** Incremental transcript: chunks for turn state, lines/blocks for the list. */
export interface Transcript {
  chunks: ChatChunk[];
  lines: ChatLine[];
  blocks: ChatBlock[];
  answered: ReadonlySet<string>;
}

export function emptyTranscript(): Transcript {
  return { chunks: [], lines: [], blocks: [], answered: new Set() };
}

/** Full rebuild (connection replace / session switch). */
export function replaceTranscript(chunks: ChatChunk[]): Transcript {
  const answered = new Set(
    chunks.filter((c) => c.type === 'permission_answered' && c.request_id).map((c) => c.request_id as string),
  );
  const lines = chatLines(chunks);
  return { chunks: chunks.slice(), lines, blocks: chatBlocks(lines), answered };
}

export function applyChunks(state: Transcript, chunks: ChatChunk[]): Transcript {
  let next = state;
  for (const chunk of chunks) next = applyChunk(next, chunk);
  return next;
}

/**
 * Append one chunk, updating only the tip of lines/blocks when possible so
 * earlier row identities stay stable for Solid `<For>`.
 */
export function applyChunk(state: Transcript, chunk: ChatChunk): Transcript {
  const chunks = state.chunks.concat(chunk);

  if (chunk.type === 'permission_answered') {
    const answered = new Set(state.answered);
    if (chunk.request_id) answered.add(chunk.request_id);
    const lines = state.lines.filter(
      (line) => !(line.chunk.type === 'permission' && line.chunk.request_id === chunk.request_id),
    );
    if (lines.length === state.lines.length) {
      return { chunks, lines: state.lines, blocks: state.blocks, answered };
    }
    return { chunks, lines, blocks: chatBlocks(lines), answered };
  }

  if (chunk.type === 'permission' && chunk.request_id && state.answered.has(chunk.request_id)) {
    return { chunks, lines: state.lines, blocks: state.blocks, answered: state.answered };
  }

  // Thinking stays on the wire / JSONL only (same as chatLines).
  if (chunk.type === 'thought_delta') {
    return { chunks, lines: state.lines, blocks: state.blocks, answered: state.answered };
  }

  if (isTool(chunk.type)) {
    return applyToolChunk(state, chunks, chunk);
  }

  const last = state.lines[state.lines.length - 1];
  if (chunk.type === 'text_delta' && last?.chunk.type === 'text_delta') {
    const line: ChatLine = { chunk: last.chunk, text: last.text + (chunk.text ?? '') };
    return replaceLastLine(state, chunks, line);
  }

  const line: ChatLine = { chunk, text: chunk.text ?? chunk.message ?? '' };
  return appendLine(state, chunks, line);
}

function applyToolChunk(state: Transcript, chunks: ChatChunk[], chunk: ChatChunk): Transcript {
  const id = toolCallId(chunk.tool_call);
  if (id) {
    const idx = state.lines.findLastIndex((line) => isTool(line.chunk.type) && toolCallId(line.chunk.tool_call) === id);
    if (idx >= 0) {
      const prior = state.lines[idx]!;
      const line: ChatLine = {
        chunk: {
          ...prior.chunk,
          type: 'tool_call',
          tool_call: mergeToolCall(prior.chunk.tool_call, chunk.tool_call),
        },
        text: '',
      };
      return replaceLineAt(state, chunks, idx, line);
    }
  }
  return appendLine(state, chunks, { chunk: { ...chunk, type: 'tool_call' }, text: '' });
}

function appendLine(state: Transcript, chunks: ChatChunk[], line: ChatLine): Transcript {
  const lines = state.lines.concat(line);
  const role = roleOf(line);
  const queued = !!line.chunk.queued;
  const last = state.blocks[state.blocks.length - 1];
  if (last && last.role === role && role !== 'error' && !!last.queued === queued) {
    const block: ChatBlock = { role: last.role, lines: last.lines.concat(line), queued: last.queued };
    return {
      chunks,
      lines,
      blocks: state.blocks.slice(0, -1).concat(block),
      answered: state.answered,
    };
  }
  return {
    chunks,
    lines,
    blocks: state.blocks.concat({ role, lines: [line], queued: queued || undefined }),
    answered: state.answered,
  };
}

function replaceLastLine(state: Transcript, chunks: ChatChunk[], line: ChatLine): Transcript {
  return replaceLineAt(state, chunks, state.lines.length - 1, line);
}

function replaceLineAt(state: Transcript, chunks: ChatChunk[], index: number, line: ChatLine): Transcript {
  const lines = state.lines.slice();
  lines[index] = line;
  // Find which block owns this line index.
  let at = 0;
  let blockIndex = -1;
  let lineInBlock = -1;
  for (let b = 0; b < state.blocks.length; b++) {
    const block = state.blocks[b]!;
    if (index < at + block.lines.length) {
      blockIndex = b;
      lineInBlock = index - at;
      break;
    }
    at += block.lines.length;
  }
  if (blockIndex < 0) {
    return { chunks, lines, blocks: chatBlocks(lines), answered: state.answered };
  }
  const prev = state.blocks[blockIndex]!;
  const blockLines = prev.lines.slice();
  blockLines[lineInBlock] = line;
  const block: ChatBlock = { role: prev.role, lines: blockLines, queued: prev.queued };
  const blocks = state.blocks.slice();
  blocks[blockIndex] = block;
  return { chunks, lines, blocks, answered: state.answered };
}

/** Consecutive tool rows vs everything else, so the UI can fold tools into one "N operations" group. */
export type LineSegment = { kind: 'tools' | 'rest'; lines: ChatLine[] };

export function lineSegments(lines: ChatLine[]): LineSegment[] {
  const out: LineSegment[] = [];
  for (const line of lines) {
    const kind = isTool(line.chunk.type) ? 'tools' : 'rest';
    const last = out[out.length - 1];
    if (last?.kind === kind) {
      last.lines.push(line);
      continue;
    }
    out.push({ kind, lines: [line] });
  }
  return out;
}

/** Keep prior block/line object identity when content is unchanged so Solid `<For>` does not remount. */
export function stabilizeBlocks(prev: ChatBlock[] | undefined, next: ChatBlock[]): ChatBlock[] {
  if (!prev) return next;
  let allSame = prev.length === next.length;
  const out = next.map((n, i) => {
    const p = prev[i];
    if (!p || p.role !== n.role || !!p.queued !== !!n.queued) {
      allSame = false;
      return n;
    }
    const lines = stabilizeLines(p.lines, n.lines);
    if (lines === p.lines) return p;
    allSame = false;
    return { role: n.role, lines, queued: n.queued };
  });
  if (allSame && out.every((b, i) => b === prev[i])) return prev;
  return out;
}

/** Like stabilizeBlocks, but never reuse identities across session switches. */
export function stabilizeSessionBlocks(
  sessionId: string,
  prev: { sessionId: string; blocks: ChatBlock[] } | undefined,
  next: ChatBlock[],
): { sessionId: string; blocks: ChatBlock[] } {
  if (!prev || prev.sessionId !== sessionId) return { sessionId, blocks: next };
  return { sessionId, blocks: stabilizeBlocks(prev.blocks, next) };
}

function stabilizeLines(prev: ChatLine[], next: ChatLine[]): ChatLine[] {
  if (prev.length === next.length && prev.every((p, i) => lineSame(p, next[i]!))) return prev;
  return next.map((n, i) => {
    const p = prev[i];
    return p && lineSame(p, n) ? p : n;
  });
}

function lineSame(a: ChatLine, b: ChatLine): boolean {
  const ac = a.chunk;
  const bc = b.chunk;
  return (
    ac.type === bc.type &&
    a.text === b.text &&
    !!ac.queued === !!bc.queued &&
    (ac.message ?? '') === (bc.message ?? '') &&
    (ac.request_id ?? '') === (bc.request_id ?? '') &&
    (ac.allow ?? null) === (bc.allow ?? null) &&
    toolSame(ac.tool_call, bc.tool_call)
  );
}

function toolSame(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
