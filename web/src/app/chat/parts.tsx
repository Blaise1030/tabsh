// One transcript row. Consecutive text (or thought) deltas are one line,
// so a stream of tokens reads as a sentence. Agent lines share one icon
// on the left; the body is full width. A permission row answers the
// agent: Allow or Deny posts to the daemon, and a 204 for an id the agent
// already left is not an error. Consecutive tool calls fold into one
// "N operations" collapsible.
import { createEffect, createSignal, For, type JSX, Match, onCleanup, Show, Switch } from 'solid-js';
import { daemonFetch } from '../daemon/client.ts';
import { rawBlobUrl } from '../files/api.ts';
import { type Icon, icons, providerIcon } from '../ui/icons.tsx';
import { errorNotice, postApprove } from './client.ts';
import { ZoomableImage } from './image-lightbox.tsx';
import { Markdown } from './markdown.tsx';
import {
  applyChunk,
  applyChunks,
  type ChatBlock,
  type ChatLine,
  chatBlocks,
  chatLines,
  emptyTranscript,
  lineSegments,
  replaceTranscript,
  stabilizeBlocks,
  stabilizeSessionBlocks,
} from './thread.ts';
import { toolDetail, toolSummary } from './tool.ts';
import { permissionLabel } from './turn.ts';
import { splitAttachedImages } from './user-images.ts';

export type { ChatBlock, ChatLine };
export {
  applyChunk,
  applyChunks,
  chatBlocks,
  chatLines,
  emptyTranscript,
  replaceTranscript,
  stabilizeBlocks,
  stabilizeSessionBlocks,
};

/** Shared across remounts so streaming list churn does not flash screenshots. */
const imageUrlCache = new Map<string, Promise<string>>();
const imageUrlReady = new Map<string, string>();

function cachedImageUrl(path: string): Promise<string> {
  const ready = imageUrlReady.get(path);
  if (ready) return Promise.resolve(ready);
  let pending = imageUrlCache.get(path);
  if (!pending) {
    pending = rawBlobUrl(daemonFetch, path).then(
      (url) => {
        imageUrlReady.set(path, url);
        return url;
      },
      (err) => {
        imageUrlCache.delete(path);
        throw err;
      },
    );
    imageUrlCache.set(path, pending);
  }
  return pending;
}

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
        <UserMessage text={text()} sessionId={props.sessionId} />
      </Match>
      <Match when={chunk().type === 'text_delta'}>
        <Markdown class="chat-md chat-text" text={text()} sessionId={props.sessionId} />
      </Match>
      <Match when={chunk().type === 'thought_delta'}>{null}</Match>
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
  /** "Loading…" under this agent block while waiting for the first reply. */
  thinking?: boolean;
  onError?: (message: string | null) => void;
}): JSX.Element {
  const role = () => props.block.role;
  const queued = () => !!props.block.queued;
  const segments = () => lineSegments(props.block.lines);
  return (
    <div class={`chat-row chat-row-${role()}${queued() ? ' chat-row-queued' : ''}`}>
      <Show when={role() === 'agent' || role() === 'error'}>
        <span class="chat-avatar" aria-hidden="true">
          {agentMark(props.agentCommand)()}
        </span>
      </Show>
      <Show when={role() === 'user'}>
        <span class="chat-avatar chat-avatar-user" aria-hidden="true">
          {icons.messageSquarePlus()}
        </span>
      </Show>
      <div class="chat-body">
        <For each={segments()}>
          {(seg) =>
            seg.kind === 'tools' ? (
              <ToolGroup lines={seg.lines} />
            ) : (
              <For each={seg.lines}>
                {(line) => <Part line={line} sessionId={props.sessionId} onError={props.onError} />}
              </For>
            )
          }
        </For>
        <Show when={props.thinking}>
          <LoadingLabel />
        </Show>
      </div>
    </div>
  );
}

/** Agent avatar + Loading when the turn is waiting and no agent block yet. */
export function ThinkingRow(props: { agentCommand?: string | null }): JSX.Element {
  return (
    <div class="chat-row chat-row-agent" role="status" aria-busy="true" aria-label="Loading">
      <span class="chat-avatar" aria-hidden="true">
        {agentMark(props.agentCommand)()}
      </span>
      <div class="chat-body">
        <LoadingLabel />
      </div>
    </div>
  );
}

function LoadingLabel(): JSX.Element {
  return (
    <p class="chat-loading">
      <span class="chat-loading-text">Loading…</span>
    </p>
  );
}

function agentMark(command: string | null | undefined): Icon {
  return providerIcon(command?.trim() || 'agent');
}

function UserMessage(props: { text: string; sessionId?: string }): JSX.Element {
  const split = () => splitAttachedImages(props.text);
  return (
    <div class="chat-user-msg">
      <Show when={split().body}>
        {(body) => <Markdown class="chat-md chat-user" text={body()} sessionId={props.sessionId} />}
      </Show>
      <Show when={split().images.length}>
        <div class="chat-user-images">
          <For each={split().images}>{(path) => <ChatImage path={path} />}</For>
        </div>
      </Show>
    </div>
  );
}

function ChatImage(props: { path: string }): JSX.Element {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const path = props.path;
    const hit = imageUrlReady.get(path);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancelled = false;
    setUrl(null);
    void cachedImageUrl(path).then(
      (u) => {
        if (!cancelled) setUrl(u);
      },
      () => {
        if (!cancelled) setUrl(null);
      },
    );
    onCleanup(() => {
      cancelled = true;
    });
  });
  return (
    <Show
      when={url()}
      fallback={
        <code class="chat-md-codespan" title={props.path}>
          {props.path}
        </code>
      }
    >
      {(src) => <ZoomableImage class="chat-user-image" src={src()} alt="" title={props.path} />}
    </Show>
  );
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
    <Show when={!done()}>
      <div class="chat-permission">
        <span class="chat-permission-label">{permissionLabel(props.tool)}</span>
        <Show when={props.requestId}>
          <span class="chat-permission-actions">
            <button
              type="button"
              class="btn"
              data-size="icon-sm"
              aria-label="Allow"
              title="Allow"
              onClick={() => void answer(true)}
            >
              {icons.circleCheck()}
            </button>
            <button
              type="button"
              class="btn"
              data-variant="outline"
              data-size="icon-sm"
              aria-label="Deny"
              title="Deny"
              onClick={() => void answer(false)}
            >
              {icons.circleX()}
            </button>
          </span>
        </Show>
      </div>
    </Show>
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

function ToolGroup(props: { lines: ChatLine[] }): JSX.Element {
  const count = () => props.lines.length;
  const label = () => (count() === 1 ? '1 operation' : `${count()} operations`);
  return (
    <details class="chat-ops">
      <summary class="chat-ops-summary">
        <span class="chat-tool-chevron" aria-hidden="true">
          {icons.chevronRight()}
        </span>
        <span class="chat-ops-label">{label()}</span>
      </summary>
      <div class="chat-ops-list">
        <For each={props.lines}>{(line) => <ToolRow tool={line.chunk.tool_call} />}</For>
      </div>
    </details>
  );
}

function ToolRow(props: { tool: unknown }): JSX.Element {
  const summary = () => toolSummary(props.tool);
  const detail = () => toolDetail(props.tool);
  const hasBody = () => !!detail();
  return (
    <Show when={hasBody()} fallback={<p class="chat-tool chat-tool-plain">{summary()}</p>}>
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
