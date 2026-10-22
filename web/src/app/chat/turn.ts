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

export function permissionLabel(tool: unknown): string {
  if (tool && typeof tool === 'object') {
    const record = tool as { title?: unknown; name?: unknown };
    const title = record.title ?? record.name;
    if (typeof title === 'string' && title.trim()) return title;
  }
  return 'Permission requested';
}
