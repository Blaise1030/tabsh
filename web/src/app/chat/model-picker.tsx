// Compact model chip for a UI card. Hidden when the agent advertises no models.
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { type ChatModelChoice, type ChatModels, fetchModels, postModel } from './client.ts';

export function ModelPicker(props: {
  sessionId: string;
  busy: boolean;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [models, setModels] = createSignal<ChatModels | null>(null);
  const [pending, setPending] = createSignal(false);

  const load = async (id: string) => {
    try {
      const next = await fetchModels(id);
      setModels(next.options.length ? next : null);
    } catch {
      setModels(null);
    }
  };

  createEffect(() => {
    const id = props.sessionId;
    void load(id);
    // Retry shortly after mount — the chat may still be handshaking.
    const t = window.setTimeout(() => void load(id), 800);
    onCleanup(() => clearTimeout(t));
  });

  createEffect(() => {
    // Refresh when a turn ends so a late-started agent shows its list.
    if (!props.busy) void load(props.sessionId);
  });

  const currentName = () => {
    const m = models();
    if (!m) return '';
    const hit = m.options.find((o) => o.id === m.current);
    return hit?.name ?? m.current ?? 'Model';
  };

  const select = async (choice: ChatModelChoice) => {
    if (props.busy || pending() || choice.id === models()?.current) return;
    setPending(true);
    try {
      const next = await postModel(props.sessionId, choice.id);
      setModels(next.options.length ? next : null);
      props.onError(null);
    } catch (e) {
      props.onError(e instanceof ApiError ? e.message : 'Could not change the model.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Show when={models()}>
      {(m) => (
        <div
          class="dropdown-menu chat-model-menu"
          on:keydown={(e) => {
            if (e.key !== 'Escape' || !(e.currentTarget as Element).querySelector('[aria-expanded="true"]'))
              return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            class="chat-model-chip"
            aria-label="Model"
            aria-haspopup="menu"
            aria-expanded="false"
            disabled={props.busy || pending()}
            title={props.busy ? 'Wait for the current turn to finish' : 'Model'}
          >
            <span class="chat-model-chip-label">{currentName()}</span>
            {icons.chevronDown()}
          </button>
          <div data-popover="" aria-hidden="true">
            <div role="menu" aria-label="Model">
              <For each={m().options}>
                {(opt) => (
                  // biome-ignore lint/a11y/useFocusableInteractive: Basecoat menu keeps focus
                  <div
                    role="menuitemradio"
                    aria-checked={opt.id === m().current}
                    on:click={() => void select(opt)}
                  >
                    <span>{opt.name}</span>
                    {opt.id === m().current ? icons.check() : <span />}
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
