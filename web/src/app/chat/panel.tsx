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
import { ApprovalsToggle } from './approvals-toggle.tsx';
import { AttachBar, isImageFile, type PendingImage, revokeImages } from './attach.tsx';
import { type ChatChunk, postMessage, postStop, readChatStream } from './client.ts';
import { Composer } from './composer.tsx';
import { takePending, withOptimisticUser } from './optimistic.ts';
import { Block, chatBlocks, chatLines, ThinkingRow } from './parts.tsx';
import { loadQueue, saveQueue } from './queue.ts';
import { isNearBottom } from './scroll.ts';
import { SelectPicker } from './select-picker.tsx';
import { applyChunks, emptyTranscript, replaceTranscript, type Transcript } from './thread.ts';
import { turnOpen, turnWaiting } from './turn.ts';

export function ChatPanel(props: {
  sessionId: string;
  agentCommand?: string | null;
  /** When false, the panel stays mounted but drops its stream (tab not visible). */
  active?: boolean;
}): JSX.Element {
  const [transcript, setTranscript] = createSignal<Transcript>(emptyTranscript());
  // POSTed, waiting for the matching SSE user_text.
  const [pendingUser, setPendingUser] = createSignal<string[]>([]);
  // Not POSTed yet; shown like user lines, drained when the turn is idle.
  // Hydrated from this browser so a refresh keeps the queue.
  const [queue, setQueue] = createSignal<string[]>(loadQueue(props.sessionId));
  const [notice, setNotice] = createSignal<string | null>(null);
  const [images, setImages] = createSignal<PendingImage[]>([]);
  // Follow new output only while the user is near the bottom.
  const [pinned, setPinned] = createSignal(true);
  const [showJump, setShowJump] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let posting = false;
  const isActive = () => props.active !== false;
  const chunks = () => transcript().chunks;
  // Server turn only — queued optimistic lines must not keep busy latched.
  const busy = createMemo(() => turnOpen(chunks()));
  const viewChunks = createMemo(() => withOptimisticUser(chunks(), pendingUser(), queue()));
  // Loading only until the agent has produced a visible chunk this turn.
  const waiting = createMemo(() => turnWaiting(viewChunks()));
  // Server blocks grow via applyChunk; pending/queue rows are a cheap tip overlay.
  const blockList = createMemo(() => {
    const base = transcript().blocks;
    const pending = pendingUser();
    const queued = queue();
    if (!pending.length && !queued.length) return base;
    return base.concat(chatBlocks(chatLines(withOptimisticUser([], pending, queued))));
  });
  const lastIsAgent = createMemo(() => {
    const list = blockList();
    const last = list.at(-1);
    return last?.role === 'agent' && !last.queued;
  });
  const hasQueued = createMemo(() => blockList().some((b) => b.queued));

  const syncScrollState = () => {
    const el = scroller;
    if (!el) return;
    const near = isNearBottom(el);
    setPinned(near);
    setShowJump(!near);
  };

  const scrollToBottom = (force = false) => {
    const el = scroller;
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

  // Persist the not-yet-sent queue across reloads (and keep it while inactive).
  createEffect(() => {
    saveQueue(props.sessionId, queue());
  });

  createEffect(() => {
    const id = props.sessionId;
    // Inactive panels keep transcript + queue; only the visible card streams.
    if (!isActive()) {
      setPendingUser([]);
      posting = false;
      return;
    }
    setPendingUser([]);
    setNotice(null);
    setPinned(true);
    setShowJump(false);
    // setImages updater does not subscribe this effect to `images`.
    clearImages();
    posting = false;
    const ac = new AbortController();
    let gone = false;
    // Trailing timer while coalescing the SSE replay across TCP reads.
    let replayTimer: ReturnType<typeof setTimeout> | null = null;
    onCleanup(() => {
      gone = true;
      ac.abort();
      if (replayTimer) {
        clearTimeout(replayTimer);
        replayTimer = null;
      }
    });
    void (async () => {
      // A stream error clears once the next connection delivers a chunk.
      // A send error stays until the composer clears it.
      let streamError = false;
      while (!gone) {
        // First idle window of each connection replaces; later flushes apply at the tip.
        // A single queueMicrotask flush after the first read painted a partial replay
        // (outdated transcript) before the rest of the history arrived.
        let replacing = true;
        let batch: ChatChunk[] = [];
        let applyScheduled = false;
        const flush = () => {
          applyScheduled = false;
          if (replayTimer) {
            clearTimeout(replayTimer);
            replayTimer = null;
          }
          if (gone || !batch.length) return;
          const next = batch;
          batch = [];
          if (replacing) {
            replacing = false;
            setTranscript(replaceTranscript(next));
            if (streamError) {
              streamError = false;
              setNotice(null);
            }
          } else {
            setTranscript((t) => applyChunks(t, next));
          }
        };
        const scheduleFlush = () => {
          if (replacing) {
            if (replayTimer) clearTimeout(replayTimer);
            replayTimer = setTimeout(() => {
              replayTimer = null;
              flush();
            }, 48);
            return;
          }
          if (!applyScheduled) {
            applyScheduled = true;
            queueMicrotask(flush);
          }
        };
        try {
          await readChatStream(id, ac.signal, (chunk) => {
            if (gone) return;
            if (chunk.type === 'user_text' && typeof chunk.text === 'string') {
              setPendingUser((list) => takePending(list, chunk.text ?? ''));
            }
            batch.push(chunk);
            scheduleFlush();
          });
          // Connection ended mid-replay debounce: commit what we have.
          if (!gone && batch.length) flush();
        } catch (e) {
          if (gone || ac.signal.aborted) return;
          if (batch.length) flush();
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
      <div class="chat-transcript" ref={scroller} onScroll={syncScrollState}>
        <div class="chat-scroll">
          <div class="chat-list">
            <For each={blockList()}>
              {(block, i) => {
                const prev = () => blockList()[i() - 1];
                const showQueueMark = () => block.queued && !prev()?.queued;
                const thinking = () =>
                  waiting() && block.role === 'agent' && !block.queued && i() === blockList().length - 1;
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
              <SelectPicker kind="mode" sessionId={props.sessionId} busy={busy()} onError={setNotice} />
              <SelectPicker
                kind="model"
                sessionId={props.sessionId}
                agentCommand={props.agentCommand}
                busy={busy()}
                onError={setNotice}
              />
              <ApprovalsToggle sessionId={props.sessionId} onError={setNotice} />
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
