// A UI card's agent surface: the stream's replay, then whatever the agent
// says next, with the composer along the bottom. A dropped stream connects
// again; the first chunk of that connection replaces the transcript, because
// the daemon replays finished turns before the new ones.
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { type ChatChunk, readChatStream } from './client.ts';
import { Composer } from './composer.tsx';
import { Block, chatBlocks, chatLines } from './parts.tsx';
import { turnOpen } from './turn.ts';

export function ChatPanel(props: { sessionId: string; agentCommand?: string | null }): JSX.Element {
  const [chunks, setChunks] = createSignal<ChatChunk[]>([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  let transcript: HTMLDivElement | undefined;

  createEffect(() => {
    const id = props.sessionId;
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

  createEffect(() => {
    chunks();
    notice();
    const el = transcript;
    if (el) el.scrollTop = el.scrollHeight;
  });

  return (
    <section class="chat" aria-label="Chat">
      <div class="chat-transcript" ref={transcript}>
        <div class="chat-list">
          <For each={chatBlocks(chatLines(chunks()))}>
            {(block) => (
              <Block
                block={block}
                sessionId={props.sessionId}
                agentCommand={props.agentCommand}
                onError={setNotice}
              />
            )}
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
          <Composer sessionId={props.sessionId} busy={turnOpen(chunks())} onError={setNotice} />
        </div>
      </div>
    </section>
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
