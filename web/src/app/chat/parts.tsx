// One transcript row. Consecutive text (or thought) deltas are one line,
// so a stream of tokens reads as a sentence. Agent lines share one icon
// on the left; the body is full width. A permission row answers the
// agent: Allow or Deny posts to the daemon, and a 204 for an id the agent
// already left is not an error.
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { type Icon, icons, providerIcon } from '../ui/icons.tsx';
import { errorNotice, postApprove } from './client.ts';
import { Markdown } from './markdown.tsx';
import { type ChatBlock, type ChatLine, chatBlocks, chatLines } from './thread.ts';
import { toolDetail, toolSummary } from './tool.ts';
import { permissionLabel } from './turn.ts';

export type { ChatBlock, ChatLine };
export { chatBlocks, chatLines };

export function Part(props: {
  line: ChatLine;
  sessionId?: string;
  onError?: (message: string | null) => void;
}): JSX.Element {
  const chunk = () => props.line.chunk;
  const text = () => props.line.text;
  return (
    <Switch>
      <Match when={chunk().type === 'error'}>
        <ErrorLine message={text()} />
      </Match>
      <Match when={chunk().type === 'user_text'}>
        <Markdown class="chat-md chat-user" text={text()} />
      </Match>
      <Match when={chunk().type === 'text_delta'}>
        <Markdown class="chat-md chat-text" text={text()} />
      </Match>
      <Match when={chunk().type === 'thought_delta'}>
        <Markdown class="chat-md chat-thought" text={text()} />
      </Match>
      <Match when={chunk().type === 'tool_call' || chunk().type === 'tool_call_update'}>
        <ToolRow tool={chunk().tool_call} />
      </Match>
      <Match when={chunk().type === 'plan'}>
        <p class="chat-plan">Plan updated</p>
      </Match>
      <Match when={chunk().type === 'permission'}>
        <PermissionRow
          sessionId={props.sessionId ?? ''}
          requestId={chunk().request_id ?? ''}
          tool={chunk().tool_call}
          onError={props.onError}
        />
      </Match>
    </Switch>
  );
}

export function Block(props: {
  block: ChatBlock;
  sessionId: string;
  agentCommand?: string | null;
  onError?: (message: string | null) => void;
}): JSX.Element {
  const role = () => props.block.role;
  return (
    <div class={`chat-row chat-row-${role()}`}>
      <Show when={role() === 'agent'}>
        <span class="chat-avatar" aria-hidden="true">
          {agentMark(props.agentCommand)()}
        </span>
      </Show>
      <Show when={role() === 'user'}>
        <span class="chat-avatar chat-avatar-user" aria-hidden="true">
          {icons.messageSquarePlus()}
        </span>
      </Show>
      <Show when={role() === 'error'}>
        <span class="chat-avatar" aria-hidden="true" />
      </Show>
      <div class="chat-body">
        <For each={props.block.lines}>
          {(line) => <Part line={line} sessionId={props.sessionId} onError={props.onError} />}
        </For>
      </div>
    </div>
  );
}

function agentMark(command: string | null | undefined): Icon {
  return providerIcon(command?.trim() || 'agent');
}

function PermissionRow(props: {
  sessionId: string;
  requestId: string;
  tool: unknown;
  onError?: (message: string | null) => void;
}): JSX.Element {
  const [done, setDone] = createSignal(false);
  const answer = async (allow: boolean) => {
    if (done() || !props.sessionId || !props.requestId) return;
    setDone(true);
    try {
      await postApprove(props.sessionId, props.requestId, allow);
      props.onError?.(null);
    } catch (e) {
      setDone(false);
      const { ApiError } = await import('../daemon/client.ts');
      props.onError?.(e instanceof ApiError ? e.message : 'Could not answer that permission.');
    }
  };
  return (
    <div class="chat-permission">
      <span>{permissionLabel(props.tool)}</span>
      <Show when={props.requestId}>
        <span class="chat-permission-actions">
          <button type="button" class="btn" disabled={done()} onClick={() => void answer(true)}>
            Allow
          </button>
          <button type="button" class="btn" disabled={done()} onClick={() => void answer(false)}>
            Deny
          </button>
        </span>
      </Show>
    </div>
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

function ToolRow(props: { tool: unknown }): JSX.Element {
  const summary = () => toolSummary(props.tool);
  const detail = () => toolDetail(props.tool);
  const hasBody = () => !!detail();
  return (
    <Show
      when={hasBody()}
      fallback={<p class="chat-tool chat-tool-plain">{summary()}</p>}
    >
      <details class="chat-tool">
        <summary class="chat-tool-summary">
          <span class="chat-tool-chevron" aria-hidden="true">
            {icons.chevronRight()}
          </span>
          <span class="chat-tool-title">{summary()}</span>
        </summary>
        <pre class="chat-tool-body">{detail()}</pre>
      </details>
    </Show>
  );
}
