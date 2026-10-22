// The card's own bar: Agent, its side terminals, and + for another shell.
import { For, type JSX, Show } from 'solid-js';
import { api } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { icons } from '../ui/icons.tsx';
import { active, closeSession, onScreen, type Session, type SessionInfo, screen } from './store.ts';
import { openSession } from './terminal.tsx';

export function SessionBar(): JSX.Element {
  const card = active;
  return (
    <div id="session-bar" role="tablist" aria-label="Card terminals" hidden={!card()}>
      <Show when={card()} keyed fallback={<span />}>
        {(c) => (
          <div class="session-bar-row">
            <AgentTab card={c} />
            <For each={c.sides()}>{(side) => <SideTab side={side} />}</For>
            <button
              type="button"
              class="btn session-add"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="New terminal"
              title="New terminal"
              onClick={() => void addSide(c)}
            >
              {icons.plus()}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

function AgentTab(props: { card: Session }): JSX.Element {
  const card = props.card;
  const shown = () => screen() === card;
  return (
    <button
      type="button"
      class="side-tab"
      classList={{ active: shown(), bell: card.bell(), unread: card.unread() }}
      role="tab"
      aria-selected={shown()}
      onClick={() => {
        if (onScreen() === card) card.term.focus();
        else go({ term: null });
      }}
    >
      <span class="tab-name">Agent</span>
    </button>
  );
}

function SideTab(props: { side: Session }): JSX.Element {
  const side = props.side;
  const shown = () => screen() === side;
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: a div, as it holds its Close button, which a button can't
    // biome-ignore lint/a11y/useKeyWithClickEvents: a div, as it holds its Close button, which a button can't
    <div
      class="side-tab"
      classList={{ active: shown(), bell: side.bell(), unread: side.unread() }}
      role="tab"
      aria-selected={shown()}
      onClick={() => {
        if (onScreen() === side) side.term.focus();
        else go({ term: side.id });
      }}
      on:auxclick={(e) => e.button === 1 && closeSession(side)}
    >
      <span class="tab-name">{side.name()}</span>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon-xs"
        aria-label="Close terminal"
        // Native: stopped here, the click reaches neither the tab nor the page.
        on:click={(e) => {
          e.stopPropagation();
          void closeSession(side);
        }}
      >
        {icons.close()}
      </button>
    </div>
  );
}

async function addSide(card: Session): Promise<void> {
  const info = (await api<SessionInfo>('POST', '', { parent: card.id })) as SessionInfo | null;
  if (!info) return;
  openSession(info);
  go({ term: info.id });
}
