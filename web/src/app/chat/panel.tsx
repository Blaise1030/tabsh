// A UI card's agent surface: the stream's replay, then whatever the agent
// says next, with the composer along the bottom. A dropped stream connects
// again; the first chunk of that connection replaces the transcript, because
// the daemon replays finished turns before the new ones. A send paints the
// user line at once; while a turn is open, further sends join a queue that
// drains after turn_end (Steer stops first, then sends that text next).
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { withImages } from '../board/model.ts';
import { ApiError, uploadFile } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { AttachBar, isImageFile, type PendingImage, revokeImages } from './attach.tsx';
import { type ChatChunk, postMessage, postStop, readChatStream } from './client.ts';
import { Composer } from './composer.tsx';
import { ModelPicker } from './model-picker.tsx';
import { takePending, withOptimisticUser } from './optimistic.ts';
import { Block, chatBlocks, chatLines, stabilizeBlocks, ThinkingRow } from './parts.tsx';
import { isNearBottom } from './scroll.ts';
import { turnOpen, turnWaiting } from './turn.ts';

export function ChatPanel(props: { sessionId: string; agentCommand?: string | null }): JSX.Element {
  const [chunks, setChunks] = createSignal<ChatChunk[]>([]);
  // POSTed, waiting for the matching SSE user_text.
  const [pendingUser, setPendingUser] = createSignal<string[]>([]);
  // Not POSTed yet; shown like user lines, drained when the turn is idle.
  const [queue, setQueue] = createSignal<string[]>([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [images, setImages] = createSignal<PendingImage[]>([]);
  // Follow new output only while the user is near the bottom.
  const [pinned, setPinned] = createSignal(true);
  const [showJump, setShowJump] = createSignal(false);
  let transcript: HTMLDivElement | undefined;
  let posting = false;
  // Server turn only — queued optimistic lines must not keep busy latched.
  const busy = createMemo(() => turnOpen(chunks()));
  const viewChunks = createMemo(() => withOptimisticUser(chunks(), pendingUser(), queue()));
  // Loading only until the agent has produced a visible chunk this turn.
  const waiting = createMemo(() => turnWaiting(viewChunks()));
  const blocks = createMemo((prev?: ReturnType<typeof chatBlocks>) =>
    stabilizeBlocks(prev, chatBlocks(chatLines(viewChunks()))),
  );
  const lastIsAgent = createMemo(() => {
    const list = blocks();
    const last = list.at(-1);
    return last?.role === 'agent' && !last.queued;
  });
  const hasQueued = createMemo(() => blocks().some((b) => b.queued));

  const syncScrollState = () => {
    const el = transcript;
    if (!el) return;
    const near = isNearBottom(el);
    setPinned(near);
    setShowJump(!near);
  };

  const scrollToBottom = (force = false) => {
    const el = transcript;
    if (!el) return;
    if (!force && !pinned()) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      setPinned(true);
      setShowJump(false);
    });
  };

  const clearImages = () => {
    setImages((list) => {
      revokeImages(list);
      return [];
    });
  };

  const addImages = (files: FileList | File[]) => {
    const added = [...files].filter(isImageFile).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    if (added.length) setImages((list) => [...list, ...added]);
  };

  const removeImage = (gone: PendingImage) => {
    URL.revokeObjectURL(gone.url);
    setImages((list) => list.filter((x) => x !== gone));
  };

  /** Upload pending thumbs (if any) and return the text to send, or null on failure. */
  const withUploads = async (text: string): Promise<string | null> => {
    const pending = images();
    if (!pending.length) return text.trim() ? text.trim() : null;
    try {
      const paths = await Promise.all(pending.map((x) => uploadFile(x.file)));
      clearImages();
      setNotice(null);
      return withImages(text.trim(), paths);
    } catch {
      setNotice("Couldn't attach the images");
      return null;
    }
  };

  createEffect(() => {
    const id = props.sessionId;
    setPendingUser([]);
    setQueue([]);
    setPinned(true);
    setShowJump(false);
    // setImages updater does not subscribe this effect to `images`.
    clearImages();
    posting = false;
    const ac = new AbortController();
    let gone = false;
    onCleanup(() => {
      gone = true;
      ac.abort();
      clearImages();
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

  const postOne = async (text: string) => {
    setPendingUser((list) => [...list, text]);
    scrollToBottom(true);
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
      <div class="chat-transcript" ref={transcript} onScroll={syncScrollState}>
        <div class="chat-scroll">
          <div class="chat-list">
            <For each={blocks()}>
              {(block, i) => {
                const prev = () => blocks()[i() - 1];
                const showQueueMark = () => block.queued && !prev()?.queued;
                const thinking = () =>
                  waiting() && block.role === 'agent' && !block.queued && i() === blocks().length - 1;
                return (
                  <>
                    <Show when={showQueueMark()}>
                      <Show when={waiting()}>
                        <ThinkingRow agentCommand={props.agentCommand} />
                      </Show>
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
                  agentCommand={props.agentCommand}
                  onError={setNotice}
                />
              )}
            </Show>
            <Show when={waiting() && !lastIsAgent() && !hasQueued()}>
              <ThinkingRow agentCommand={props.agentCommand} />
            </Show>
          </div>
          <div class="chat-composer-dock">
            <Show when={showJump()}>
              <button
                type="button"
                class="btn chat-jump"
                data-variant="secondary"
                data-size="icon-sm"
                aria-label="Scroll to bottom"
                title="Scroll to bottom"
                onClick={() => scrollToBottom(true)}
              >
                {icons.chevronDown()}
              </button>
            </Show>
            <Composer
              sessionId={props.sessionId}
              busy={busy()}
              hasAttachments={images().length > 0}
              onError={setNotice}
              onPasteImages={addImages}
              onSend={(text) => {
                void withUploads(text).then((body) => {
                  if (body === null) return;
                  if (busy()) {
                    setQueue((list) => [...list, body]);
                    scrollToBottom(true);
                    return;
                  }
                  void postOne(body);
                });
              }}
              onSteer={(text) => {
                void withUploads(text).then((body) => {
                  if (body === null) return;
                  // This text goes next; anything already queued stays after it.
                  setQueue((list) => [body, ...list]);
                  scrollToBottom(true);
                  void postStop(props.sessionId).then(
                    () => setNotice(null),
                    (e) => setNotice(e instanceof ApiError ? e.message : 'Could not stop the agent.'),
                  );
                });
              }}
            />
            <div class="chat-composer-toolbar">
              <AttachBar images={images()} onAdd={addImages} onRemove={removeImage} />
              <ModelPicker sessionId={props.sessionId} busy={busy()} onError={setNotice} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QueueMark(): JSX.Element {
  const wave = () => (
    <span class="chat-queue-wave" aria-hidden="true">
      <svg viewBox="0 0 80 8" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 4 Q 5 0.5 10 4 T 20 4 T 30 4 T 40 4 T 50 4 T 60 4 T 70 4 T 80 4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
        />
      </svg>
    </span>
  );
  return (
    <div class="chat-queue-mark">
      {wave()}
      <span class="chat-queue-label">Queued</span>
      {wave()}
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
