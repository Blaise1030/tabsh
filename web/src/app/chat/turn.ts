// Whether the latest turn is still running, and the label on a permission row.
// A turn opens on the user's message and closes on `turn_end` or `error`,
// which is when Stop leaves and the composer accepts another message.

export function turnOpen(chunks: { type: string }[]): boolean {
  let open = false;
  for (const chunk of chunks) {
    if (chunk.type === 'user_text') open = true;
    else if (chunk.type === 'turn_end' || chunk.type === 'error') open = false;
  }
  return open;
}

// True only until the agent has produced something visible in this turn
// (text, tool, plan, or permission) — so Loading does not sit under a reply.
// Client-only queued lines are ignored; they are not a new turn.
export function turnWaiting(chunks: { type: string; queued?: boolean }[]): boolean {
  let open = false;
  let sawAgent = false;
  for (const chunk of chunks) {
    if (chunk.queued) continue;
    if (chunk.type === 'user_text') {
      open = true;
      sawAgent = false;
    } else if (chunk.type === 'turn_end' || chunk.type === 'error') {
      open = false;
      sawAgent = false;
    } else if (
      open &&
      (chunk.type === 'text_delta' ||
        chunk.type === 'tool_call' ||
        chunk.type === 'tool_call_update' ||
        chunk.type === 'plan' ||
        chunk.type === 'permission')
    ) {
      sawAgent = true;
    }
  }
  return open && !sawAgent;
}

export function permissionLabel(tool: unknown): string {
  if (tool && typeof tool === 'object') {
    const record = tool as { title?: unknown; name?: unknown };
    const title = record.title ?? record.name;
    if (typeof title === 'string' && title.trim()) return title;
  }
  return 'Permission requested';
}
