// A UI card's agent surface: the stream's replay, then whatever the agent
// says next, with the composer along the bottom. A dropped stream connects
// again; the first chunk of that connection replaces the transcript, because
// the daemon replays finished turns before the new ones. A send paints the
// user line at once; while a turn is open, further sends join a queue that
// drains after turn_end (Steer stops first, then sends that text next).
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { type ChatChunk, postMessage, postStop, readChatStream } from './client.ts';
import { Composer } from './composer.tsx';
import { takePending, withOptimisticUser } from './optimistic.ts';
import { Block, chatBlocks, chatLines, ThinkingRow } from './parts.tsx';
import { turnOpen } from './turn.ts';

export function ChatPanel(props: { sessionId: string; agentCommand?: string | null }): JSX.Element {
  const [chunks, setChunks] = createSignal<ChatChunk[]>([]);
  // POSTed, waiting for the matching SSE user_text.
  const [pendingUser, setPendingUser] = createSignal<string[]>([]);
  // Not POSTed yet; shown like user lines, drained when the turn is idle.
  const [queue, setQueue] = createSignal<string[]>([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  let transcript: HTMLDivElement | undefined;
  let posting = false;
  // Server turn only — queued optimistic lines must not keep busy latched.
  const busy = createMemo(() => turnOpen(chunks()));
  const viewChunks = createMemo(() => withOptimisticUser(chunks(), pendingUser(), queue()));
  const blocks = createMemo(() => chatBlocks(chatLines(viewChunks())));
  const lastIsAgent = createMemo(() => {
    const list = blocks();
    const last = list.at(-1);
    return last?.role === 'agent' && !last.queued;
  });

  createEffect(() => {
    const id = props.sessionId;
    setPendingUser([]);
    setQueue([]);
    posting = false;
    const ac = new AbortController();
    let gone = false;
    onCleanup(() => {
      gone = true;
      ac.abort();
    });
    void (async () => {
      // A stream error clears once the next connection delivers a chunk.
      // A send error stays until the composer clears it.
      let streamError = false;
      while (!gone) {
        let replaced = false;
        let pending: ChatChunk[] | null = null;
        let scheduled = false;
        const flush = () => {
          scheduled = false;
          if (gone || !pending) return;
          const next = pending;
          pending = null;
          setChunks(next);
        };
        try {
          await readChatStream(id, ac.signal, (chunk) => {
            if (gone) return;
            if (chunk.type === 'user_text' && typeof chunk.text === 'string') {
              setPendingUser((list) => takePending(list, chunk.text ?? ''));
            }
            if (!replaced) {
              replaced = true;
              pending = [chunk];
              if (streamError) {
                streamError = false;
                setNotice(null);
              }
            } else {
              pending = [...(pending ?? chunks()), chunk];
            }
            if (!scheduled) {
              scheduled = true;
              queueMicrotask(flush);
            }
          });
        } catch (e) {
          if (gone || ac.signal.aborted) return;
          streamError = true;
          setNotice(e instanceof ApiError ? e.message : 'The chat stream stopped.');
        }
        if (gone || ac.signal.aborted) return;
        await wait(1000, ac.signal);
      }
    })();
  });

  const scrollToBottom = () => {
    const el = transcript;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  };

  const postOne = async (text: string) => {
    setPendingUser((list) => [...list, text]);
    scrollToBottom();
    posting = true;
    try {
      await postMessage(props.sessionId, text);
      setNotice(null);
    } catch (e) {
      setPendingUser((list) => takePending(list, text));
      setQueue((list) => [text, ...list]);
      setNotice(e instanceof ApiError ? e.message : 'Could not send that message.');
    } finally {
      posting = false;
    }
  };

  // When the agent is idle and something is queued, send the next line.
  createEffect(() => {
    if (busy() || posting) return;
    const next = queue()[0];
    if (!next) return;
    setQueue((list) => list.slice(1));
    void postOne(next);
  });

  createEffect(() => {
    viewChunks();
    notice();
    scrollToBottom();
  });

  return (
    <section class="chat" aria-label="Chat">
      <div class="chat-transcript" ref={transcript}>
        <div class="chat-scroll">
          <div class="chat-list">
            <For each={blocks()}>
              {(block, i) => {
                const prev = () => blocks()[i() - 1];
                const showQueueMark = () => block.queued && !prev()?.queued;
                // Shimmer only on the last non-queued agent block while busy.
                const thinking = () => {
                  if (!busy() || block.role !== 'agent' || block.queued) return false;
                  const list = blocks();
                  for (let j = list.length - 1; j >= 0; j--) {
                    if (list[j]?.role === 'agent' && !list[j]?.queued) return j === i();
                  }
                  return false;
                };
                return (
                  <>
                    <Show when={showQueueMark()}>
                      <QueueMark />
                    </Show>
                    <Block
                      block={block}
                      sessionId={props.sessionId}
                      agentCommand={props.agentCommand}
                      thinking={thinking()}
                      onError={setNotice}
                    />
                  </>
                );
              }}
            </For>
            <Show when={notice()}>
              {(message) => (
                <Block
                  block={{
                    role: 'error',
                    lines: [{ chunk: { type: 'error', message: message() }, text: message() }],
                  }}
                  sessionId={props.sessionId}
                  onError={setNotice}
                />
              )}
            </Show>
            <Show when={busy() && !lastIsAgent()}>
              <ThinkingRow agentCommand={props.agentCommand} />
            </Show>
          </div>
          <div class="chat-composer-dock">
            <Composer
              sessionId={props.sessionId}
              busy={busy()}
              onError={setNotice}
              onSend={(text) => {
                if (busy()) {
                  setQueue((list) => [...list, text]);
                  scrollToBottom();
                  return;
                }
                void postOne(text);
              }}
              onSteer={(text) => {
                // This text goes next; anything already queued stays after it.
                setQueue((list) => [text, ...list]);
                scrollToBottom();
                void postStop(props.sessionId).then(
                  () => setNotice(null),
                  (e) =>
                    setNotice(e instanceof ApiError ? e.message : 'Could not stop the agent.'),
                );
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function QueueMark(): JSX.Element {
  return (
    <div class="chat-queue-mark" role="separator" aria-label="Queued messages">
      <span class="chat-queue-wave" aria-hidden="true">
        <svg viewBox="0 0 80 8" preserveAspectRatio="none">
          <path
            d="M0 4 Q 5 0.5 10 4 T 20 4 T 30 4 T 40 4 T 50 4 T 60 4 T 70 4 T 80 4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="chat-queue-label">Queued</span>
      <span class="chat-queue-wave" aria-hidden="true">
        <svg viewBox="0 0 80 8" preserveAspectRatio="none">
          <path
            d="M0 4 Q 5 0.5 10 4 T 20 4 T 30 4 T 40 4 T 50 4 T 60 4 T 70 4 T 80 4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            stroke-linecap="round"
          />
        </svg>
      </span>
    </div>
  );
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
