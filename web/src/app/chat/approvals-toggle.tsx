// A UI card's permission posture: Ask (requests wait in the chat) or
// Allow all (the daemon answers them as allow). Per live agent process;
// a restarted agent goes back to Ask.
import { createEffect, createSignal, type JSX } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { fetchApprovals, postApprovals } from './client.ts';

export function ApprovalsToggle(props: { sessionId: string; onError: (message: string | null) => void }): JSX.Element {
  const [auto, setAuto] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let loadedFor = '';

  createEffect(() => {
    const id = props.sessionId;
    loadedFor = id;
    setAuto(false);
    void fetchApprovals(id)
      .then((next) => {
        if (loadedFor === id) setAuto(next.auto);
      })
      .catch(() => {
        /* no chat yet — Ask is the safe default */
      });
  });

  const toggle = async () => {
    if (pending()) return;
    setPending(true);
    try {
      const next = await postApprovals(props.sessionId, !auto());
      setAuto(next.auto);
      props.onError(null);
    } catch (e) {
      props.onError(e instanceof ApiError ? e.message : 'Could not change the approvals setting.');
    } finally {
      setPending(false);
    }
  };

  const title = () =>
    auto() ? 'Permission requests are approved automatically' : 'Permission requests wait for you in the chat';

  return (
    <button
      type="button"
      class="btn chat-approvals-chip"
      data-variant="ghost"
      data-on={auto() ? 'true' : undefined}
      aria-label="Approvals"
      aria-pressed={auto()}
      disabled={pending()}
      title={title()}
      onClick={() => void toggle()}
    >
      {auto() ? icons.shieldOff() : icons.shield()}
      <span>{auto() ? 'Allow all' : 'Approve'}</span>
    </button>
  );
}
