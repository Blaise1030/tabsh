// The footer of a UI card: posts the text, and puts it back if the daemon
// refuses so a spawn failure does not eat the message.
import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { postMessage, postStop } from './client.ts';
import { insertIntoComposer, registerComposer } from './deliver.ts';

export function Composer(props: {
  sessionId: string;
  busy: boolean;
  onError: (message: string | null) => void;
  /** Paint the user line before the POST / SSE catch up. */
  onSend?: (text: string) => void;
  /** Drop that optimistic line when the POST fails. */
  onSendFailed?: (text: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal('');
  let sending = false;
  let field: HTMLTextAreaElement | undefined;
  const fitField = () => {
    const el = field;
    if (!el) return;
    // Fallback when `field-sizing: content` is missing: grow to the text,
    // then cap at the CSS max-height so long drafts scroll inside.
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

  const send = async () => {
    const value = text().trim();
    if (!value || sending || props.busy) return;
    sending = true;
    setText('');
    props.onSend?.(value);
    try {
      await postMessage(props.sessionId, value);
      props.onError(null);
    } catch (e) {
      props.onSendFailed?.(value);
      setText(value);
      props.onError(e instanceof ApiError ? e.message : 'Could not send that message.');
    } finally {
      sending = false;
    }
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
    <form
      class="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <span class="chat-avatar chat-avatar-user" aria-hidden="true">
        {icons.messageSquarePlus()}
      </span>
      <textarea
        ref={field}
        rows={1}
        placeholder="Message"
        aria-label="Message"
        disabled={props.busy}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          fitField();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <Show
        when={props.busy}
        fallback={
          <button
            type="submit"
            class="btn"
            data-size="icon-sm"
            aria-label="Send"
            title="Send"
            disabled={!text().trim()}
          >
            {icons.send()}
          </button>
        }
      >
        <button type="button" class="btn" onClick={() => void stop()}>
          Stop
        </button>
      </Show>
    </form>
  );
}
