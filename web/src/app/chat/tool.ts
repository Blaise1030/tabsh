// Pure helpers for a tool call row: merge streamed updates, and pick a
// short summary plus the expandable body (command and output).

export function toolCallId(tool: unknown): string | null {
  const id = field(tool, 'toolCallId') ?? field(tool, 'tool_call_id');
  return id?.trim() ? id : null;
}

export function mergeToolCall(base: unknown, patch: unknown): unknown {
  if (!isRecord(base)) return patch ?? base;
  if (!isRecord(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (key === 'title' && typeof value === 'string' && !value.trim()) continue;
    if (key === 'content' && Array.isArray(value) && Array.isArray(out.content)) {
      out.content = [...out.content, ...value];
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Collapsed label only: keep the long command/path out of the row; that
// belongs in the expanded body.
export function toolSummary(tool: unknown): string {
  const name = field(tool, 'name')?.trim();
  if (name) return name;
  const title = field(tool, 'title')?.trim();
  const command = toolCommand(tool);
  if (title && title !== command && !title.includes(' ')) return title;
  if (title && !command) return title;
  const kind = field(tool, 'kind')?.trim();
  if (kind) return kind;
  return 'Tool';
}

export function toolDetail(tool: unknown): string {
  const parts: string[] = [];
  const command = toolCommand(tool);
  if (command) parts.push(command);
  const cwd = toolCwd(tool);
  if (cwd) parts.push(`cwd: ${cwd}`);
  const output = toolOutput(tool);
  if (output) parts.push(output);
  return parts.join('\n\n');
}

export function toolCommand(tool: unknown): string | null {
  const raw = fieldObj(tool, 'rawInput') ?? fieldObj(tool, 'input');
  const command = field(raw, 'command') ?? field(raw, 'cmd');
  return command?.trim() || null;
}

function toolCwd(tool: unknown): string | null {
  const raw = fieldObj(tool, 'rawInput') ?? fieldObj(tool, 'input');
  return field(raw, 'cwd')?.trim() || null;
}

function toolOutput(tool: unknown): string | null {
  const rawOut = field(tool, 'rawOutput');
  if (rawOut) return rawOut;
  const content = isRecord(tool) ? tool.content : null;
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    const inner = isRecord(item.content) ? item.content : item;
    const text = field(inner, 'text');
    if (text) texts.push(text);
  }
  return texts.length ? texts.join('\n') : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function field(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const v = value[key];
  return typeof v === 'string' ? v : null;
}

function fieldObj(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const v = value[key];
  return isRecord(v) ? v : null;
}
