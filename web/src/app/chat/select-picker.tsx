// Compact select chip for a UI card: the agent's models, or its session
// modes (how it asks permission). Hidden when the agent advertises none.
// The popover is position:fixed and placed against the viewport so a sticky
// composer dock or short card does not clip it.
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { ApiError } from '../daemon/client.ts';
import { icons, providerIcon } from '../ui/icons.tsx';
import {
  type ChatSelect,
  type ChatSelectChoice,
  ensureChat,
  fetchModels,
  fetchModes,
  postMode,
  postModel,
} from './client.ts';
import { modelBrand } from './model-brand.ts';
import { scrollFades } from './scroll.ts';

const VIEW_PAD = 8;
const GAP = 6;
const MAX_POPOVER = 20 * 16; // 20rem

export type SelectKind = 'model' | 'mode';

const labels = {
  model: { title: 'Model', search: 'Search models', change: 'model', fallback: 'Model' },
  mode: {
    title: 'Agent mode',
    search: 'Search modes',
    change: 'mode',
    fallback: 'Mode',
  },
} as const;

function modeIcon(choice: ChatSelectChoice): JSX.Element {
  const key = `${choice.id} ${choice.name}`.toLowerCase();
  if (/bypass|allow|full|auto|agent|build|code|accept|yolo/.test(key)) return icons.bot();
  if (/plan|read.only|review/.test(key)) return icons.map();
  if (/ask|default|permission|confirm/.test(key)) return icons.shield();
  return icons.shield();
}

export function SelectPicker(props: {
  kind: SelectKind;
  sessionId: string;
  busy: boolean;
  /** The card's agent command; model rows wear that agent's mark. */
  agentCommand?: string | null;
  onError: (message: string | null) => void;
}): JSX.Element {
  const words = () => labels[props.kind];
  const agentMark = () => providerIcon(props.agentCommand?.trim() || 'agent');
  const choiceIcon = (choice: ChatSelectChoice) => {
    if (props.kind === 'mode') return modeIcon(choice);
    switch (modelBrand(choice.id, choice.name)) {
      case 'claude':
        return icons.claude();
      case 'openai':
        return icons.openai();
      case 'gemini':
        return icons.gemini();
      case 'cursor':
        return icons.cursor();
      default:
        return agentMark()();
    }
  };
  const [select, setSelect] = createSignal<ChatSelect | null>(null);
  const [pending, setPending] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let trigger: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  let optionsEl: HTMLDivElement | undefined;

  const load = async (id: string): Promise<boolean> => {
    try {
      const next = props.kind === 'model' ? await fetchModels(id) : await fetchModes(id);
      if (next.options.length) {
        setSelect(next);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // The list only exists after the ACP agent is live. Wake it (no prompt),
  // then poll until the list appears — otherwise the chip stays hidden next
  // to attach. Both pickers do this; start answers 204 once one is up.
  createEffect(() => {
    const id = props.sessionId;
    setSelect(null);
    let tries = 0;
    let done = false;
    let cancelled = false;
    const tick = () => {
      if (done || cancelled) return;
      void load(id).then((ok) => {
        if (ok) done = true;
      });
    };
    void ensureChat(id)
      .catch(() => {
        /* backlog / conflict — still poll in case it is already live */
      })
      .finally(() => {
        if (!cancelled) tick();
      });
    const iv = window.setInterval(() => {
      tries += 1;
      if (done || cancelled || tries > 40) {
        window.clearInterval(iv);
        return;
      }
      tick();
    }, 500);
    onCleanup(() => {
      cancelled = true;
      done = true;
      window.clearInterval(iv);
    });
  });

  createEffect(() => {
    props.busy;
    void load(props.sessionId);
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
    const pw = Math.max(pop.offsetWidth, 224);
    let left = r.left;
    left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - pw - VIEW_PAD));
    pop.style.left = `${left}px`;
    pop.style.right = 'auto';
    // Anchor the edge nearest the chip, so the popover grows away from it
    // and its top is never computed from a stale height (the clipped search).
    if (preferAbove) {
      pop.style.top = 'auto';
      pop.style.bottom = `${window.innerHeight - r.top + GAP}px`;
    } else {
      pop.style.bottom = 'auto';
      pop.style.top = `${r.bottom + GAP}px`;
    }
  };

  const schedulePlace = () => {
    requestAnimationFrame(() => requestAnimationFrame(placePopover));
  };

  const syncFades = () => {
    const el = optionsEl;
    if (!el) return;
    const fades = scrollFades(el);
    el.toggleAttribute('data-fade-top', fades.top);
    el.toggleAttribute('data-fade-bottom', fades.bottom);
  };

  createEffect(() => {
    if (!select()) return;
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
          requestAnimationFrame(syncFades);
        }
      });
      obs.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
    };
    bind();
    const onReposition = () => {
      placePopover();
      syncFades();
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      cancelled = true;
      obs?.disconnect();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  const current = () => {
    const m = select();
    if (!m) return null;
    return m.options.find((o) => o.id === m.current) ?? null;
  };

  const currentName = () => {
    const m = select();
    if (!m) return '';
    return current()?.name ?? m.current ?? words().fallback;
  };

  const filtered = createMemo(() => {
    const m = select();
    if (!m) return [];
    const q = query().trim().toLowerCase();
    if (!q) return m.options;
    return m.options.filter((o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
  });

  createEffect(() => {
    filtered();
    query();
    if (trigger?.getAttribute('aria-expanded') === 'true') {
      schedulePlace();
      requestAnimationFrame(syncFades);
    }
  });

  const selectChoice = async (choice: ChatSelectChoice) => {
    if (props.busy || pending() || choice.id === select()?.current) return;
    setPending(true);
    try {
      const next =
        props.kind === 'model'
          ? await postModel(props.sessionId, choice.id)
          : await postMode(props.sessionId, choice.id);
      setSelect(next.options.length ? next : null);
      setQuery('');
      props.onError(null);
    } catch (e) {
      props.onError(e instanceof ApiError ? e.message : `Could not change the ${words().change}.`);
    } finally {
      setPending(false);
    }
  };

  return (
    <Show when={select()}>
      {(m) => (
        <div
          class="dropdown-menu chat-select-menu"
          on:keydown={(e) => {
            if (e.key !== 'Escape' || !(e.currentTarget as Element).querySelector('[aria-expanded="true"]')) return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            ref={trigger}
            type="button"
            class="btn nc-trigger chat-select-chip"
            data-variant="ghost"
            aria-label={words().title}
            aria-haspopup="menu"
            aria-expanded="false"
            disabled={props.busy || pending()}
            title={props.busy ? 'Wait for the current turn to finish' : words().title}
            onClick={() => schedulePlace()}
          >
            <span class="nc-trigger-body">
              {props.kind === 'model' ? choiceIcon(current() ?? { id: '', name: '' }) : icons.bot()}
              <span class="nc-value">{currentName()}</span>
              {icons.chevronDown()}
            </span>
          </button>
          <div ref={popover} class="chat-select-popover nc-pop" data-popover="" aria-hidden="true">
            <div class="chat-select-search">
              {icons.search()}
              <input
                class="nc-search"
                type="search"
                placeholder={words().search}
                aria-label={words().search}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div
              ref={optionsEl}
              class="chat-select-options"
              role="menu"
              aria-label={words().title}
              onScroll={syncFades}
            >
              <Show when={filtered().length} fallback={<p class="tags-submenu-empty">No matches</p>}>
                <For each={filtered()}>
                  {(opt) => (
                    // biome-ignore lint/a11y/useFocusableInteractive: Basecoat menu keeps focus
                    <div
                      class="menu-check"
                      role="menuitemradio"
                      aria-checked={opt.id === m().current}
                      on:click={() => void selectChoice(opt)}
                    >
                      <span class="chat-select-option">
                        <span class="chat-select-option-icon">{choiceIcon(opt)}</span>
                        <span class="chat-select-option-text">
                          <span class="chat-select-option-name">{opt.name}</span>
                          <Show when={props.kind === 'model' ? opt.description : null}>
                            <span class="chat-select-option-desc">{opt.description}</span>
                          </Show>
                        </span>
                      </span>
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
