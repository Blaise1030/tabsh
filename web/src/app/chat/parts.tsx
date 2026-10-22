// One transcript row. Consecutive text (or thought) deltas are one line,
// so a stream of tokens reads as a sentence.
import { type JSX, Match, Show, Switch } from 'solid-js';
import { type ChatChunk, errorNotice } from './client.ts';

export interface ChatLine {
  chunk: ChatChunk;
  text: string;
}

export function chatLines(chunks: ChatChunk[]): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const chunk of chunks) {
    const last = lines[lines.length - 1];
    if ((chunk.type === 'text_delta' || chunk.type === 'thought_delta') && last?.chunk.type === chunk.type) {
      last.text += chunk.text ?? '';
      continue;
    }
    lines.push({ chunk, text: chunk.text ?? chunk.message ?? '' });
  }
  return lines;
}

export function Part(props: { line: ChatLine }): JSX.Element {
  const chunk = () => props.line.chunk;
  const text = () => props.line.text;
  return (
    <Switch>
      <Match when={chunk().type === 'error'}>
        <ErrorLine message={text()} />
      </Match>
      <Match when={chunk().type === 'user_text'}>
        <p class="chat-user">{text()}</p>
      </Match>
      <Match when={chunk().type === 'text_delta'}>
        <p class="chat-text">{text()}</p>
      </Match>
      <Match when={chunk().type === 'thought_delta'}>
        <p class="chat-thought">{text()}</p>
      </Match>
      <Match when={chunk().type === 'tool_call' || chunk().type === 'tool_call_update'}>
        <p class="chat-tool">{toolLabel(chunk().tool_call, chunk().type === 'tool_call_update')}</p>
      </Match>
      <Match when={chunk().type === 'plan'}>
        <p class="chat-plan">Plan updated</p>
      </Match>
      <Match when={chunk().type === 'permission'}>
        <p class="chat-permission">Permission requested</p>
      </Match>
    </Switch>
  );
}

function ErrorLine(props: { message: string }): JSX.Element {
  const note = () => errorNotice(props.message);
  return (
    <p class="chat-error" role="alert">
      <span>{note().text}</span>
      <Show when={note().hint}>{(hint) => <span class="chat-hint">{hint()}</span>}</Show>
    </p>
  );
}

function toolLabel(tool: unknown, update: boolean): string {
  if (tool && typeof tool === 'object') {
    const record = tool as { title?: unknown; name?: unknown };
    const title = record.title ?? record.name;
    if (typeof title === 'string' && title.trim()) return title;
  }
  return update ? 'Tool update' : 'Tool';
}
