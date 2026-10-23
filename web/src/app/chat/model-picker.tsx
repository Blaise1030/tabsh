// Compact model chip for a UI card. Hidden when the agent advertises no models.
// The popover is position:fixed and placed against the viewport so a sticky
// composer dock or short card does not clip it.
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import { type ChatModelChoice, type ChatModels, fetchModels, postModel } from './client.ts';

const VIEW_PAD = 8;
const GAP = 6;
const MAX_POPOVER = 20 * 16; // 20rem

export function ModelPicker(props: {
  sessionId: string;
  busy: boolean;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [models, setModels] = createSignal<ChatModels | null>(null);
  const [pending, setPending] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let trigger: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;

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
    const t = window.setTimeout(() => void load(id), 800);
    onCleanup(() => clearTimeout(t));
  });

  createEffect(() => {
    if (!props.busy) void load(props.sessionId);
  });

  const placePopover = () => {
    const btn = trigger;
    const pop = popover;
    if (!btn || !pop || btn.getAttribute('aria-expanded') !== 'true') return;
    const r = btn.getBoundingClientRect();
    const spaceAbove = r.top - VIEW_PAD;
    const spaceBelow = window.innerHeight - r.bottom - VIEW_PAD;
    const preferAbove = spaceAbove >= 12 * 16 || spaceAbove >= spaceBelow;
    const avail = Math.max(120, preferAbove ? spaceAbove - GAP : spaceBelow - GAP);
    const maxH = Math.min(MAX_POPOVER, avail);
    pop.style.maxHeight = `${maxH}px`;
    void pop.offsetHeight;
    const ph = pop.offsetHeight || maxH;
    const pw = Math.max(pop.offsetWidth, 224);
    let top = preferAbove ? r.top - GAP - ph : r.bottom + GAP;
    if (top < VIEW_PAD) top = VIEW_PAD;
    if (top + ph > window.innerHeight - VIEW_PAD) {
      top = Math.max(VIEW_PAD, window.innerHeight - VIEW_PAD - ph);
    }
    let left = r.left;
    left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - pw - VIEW_PAD));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
  };

  const schedulePlace = () => {
    requestAnimationFrame(() => requestAnimationFrame(placePopover));
  };

  createEffect(() => {
    if (!models()) return;
    let obs: MutationObserver | undefined;
    let cancelled = false;
    const bind = () => {
      if (cancelled) return;
      const btn = trigger;
      if (!btn) {
        requestAnimationFrame(bind);
        return;
      }
      obs = new MutationObserver(() => {
        if (btn.getAttribute('aria-expanded') === 'true') {
          setQuery('');
          schedulePlace();
        }
      });
      obs.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
    };
    bind();
    const onReposition = () => placePopover();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      cancelled = true;
      obs?.disconnect();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  const currentName = () => {
    const m = models();
    if (!m) return '';
    const hit = m.options.find((o) => o.id === m.current);
    return hit?.name ?? m.current ?? 'Model';
  };

  const filtered = createMemo(() => {
    const m = models();
    if (!m) return [];
    const q = query().trim().toLowerCase();
    if (!q) return m.options;
    return m.options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
    );
  });

  createEffect(() => {
    filtered();
    query();
    if (trigger?.getAttribute('aria-expanded') === 'true') schedulePlace();
  });

  const select = async (choice: ChatModelChoice) => {
    if (props.busy || pending() || choice.id === models()?.current) return;
    setPending(true);
    try {
      const next = await postModel(props.sessionId, choice.id);
      setModels(next.options.length ? next : null);
      setQuery('');
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
            ref={trigger}
            type="button"
            class="chat-model-chip"
            aria-label="Model"
            aria-haspopup="menu"
            aria-expanded="false"
            disabled={props.busy || pending()}
            title={props.busy ? 'Wait for the current turn to finish' : 'Model'}
            onClick={() => schedulePlace()}
          >
            <span class="chat-model-chip-label">{currentName()}</span>
            {icons.chevronDown()}
          </button>
          <div ref={popover} class="chat-model-popover" data-popover="" aria-hidden="true">
            <div class="chat-model-search">
              <input
                type="search"
                placeholder="Search models"
                aria-label="Search models"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div role="menu" aria-label="Model">
              <Show
                when={filtered().length}
                fallback={<p class="chat-model-empty">No matches</p>}
              >
                <For each={filtered()}>
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
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
