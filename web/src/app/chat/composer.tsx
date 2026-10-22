// The footer of a UI card: posts the text, and puts it back if the daemon
// refuses so a spawn failure does not eat the message.
import { createSignal, type JSX } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { postMessage } from './client.ts';

export function Composer(props: { sessionId: string; onError: (message: string | null) => void }): JSX.Element {
  const [text, setText] = createSignal('');
  let sending = false;

  const send = async () => {
    const value = text().trim();
    if (!value || sending) return;
    sending = true;
    setText('');
    try {
      await postMessage(props.sessionId, value);
      props.onError(null);
    } catch (e) {
      setText(value);
      props.onError(e instanceof ApiError ? e.message : 'Could not send that message.');
    } finally {
      sending = false;
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
      <textarea
        rows={2}
        placeholder="Message"
        aria-label="Message"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" class="btn" disabled={!text().trim()}>
        Send
      </button>
    </form>
  );
}
