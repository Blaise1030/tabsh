// The footer of a UI card: Enter sends (or queues while busy); ⌘Enter steers.
// Stop cancels an open turn so a hung agent does not queue forever.
import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { postStop } from './client.ts';
import { insertIntoComposer, registerComposer } from './deliver.ts';

export function Composer(props: {
  sessionId: string;
  busy: boolean;
  onError: (message: string | null) => void;
  /** Idle send, or queue while a turn is open. */
  onSend: (text: string) => void;
  /** Stop the turn, then send this text next (skip the queue front). */
  onSteer: (text: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal('');
  let field: HTMLTextAreaElement | undefined;
  const fitField = () => {
    const el = field;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  createEffect(() => {
    const id = props.sessionId;
    onCleanup(
      registerComposer(id, {
        insert: (incoming) => setText((cur) => insertIntoComposer(cur, incoming)),
        focus: () => field?.focus(),
      }),
    );
  });
  createEffect(() => {
    text();
    queueMicrotask(fitField);
  });

  const take = (): string | null => {
    const value = text().trim();
    if (!value) return null;
    setText('');
    return value;
  };

  const send = () => {
    const value = take();
    if (!value) return;
    props.onSend(value);
  };

  const steer = () => {
    const value = take();
    if (!value) return;
    props.onSteer(value);
  };

  const stop = async () => {
    try {
      await postStop(props.sessionId);
      props.onError(null);
    } catch (e) {
      props.onError(e instanceof ApiError ? e.message : 'Could not stop the agent.');
    }
  };

  return (
    <div class="chat-composer">
      <span class="chat-avatar chat-avatar-user" aria-hidden="true">
        {icons.messageSquarePlus()}
      </span>
      <textarea
        ref={field}
        rows={1}
        placeholder={props.busy ? 'Queue a follow-up, or ⌘Enter to steer' : 'Message'}
        aria-label="Message"
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          fitField();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          if (props.busy && (e.metaKey || e.ctrlKey)) {
            steer();
            return;
          }
          send();
        }}
      />
      <Show when={props.busy}>
        <span class="chat-composer-actions">
          <button type="button" class="btn" onClick={() => void stop()}>
            Stop
          </button>
        </span>
      </Show>
    </div>
  );
}
