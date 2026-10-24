// The page: the dialogs, the tab bar, the board or the workspace under it
// (or both: the workspace in a drawer beside the board), and the drop glow.
// Features find their parts by id once this is mounted.
import { createMemo, For, type JSX, untrack } from 'solid-js';
import { DrawerMoveButton } from '../board/move-menu.tsx';
import { NewCard } from '../board/new-card.tsx';
import { Board, drawer as boardDrawer, shown as boardShown, FilterButton, layout } from '../board/view.tsx';
import { ChatPanel } from '../chat/panel.tsx';
import { open as explorerOpen, toggleExplorer } from '../explorer/explorer.ts';
import { Sidebar } from '../explorer/sidebar.tsx';
import { paneShown } from '../files/open.tsx';
import { go } from '../nav/router.ts';
import { PaletteRows } from '../palette/palette.tsx';
import { grouping, TabStrip } from '../sessions/groups.tsx';
import { KeyBar } from '../sessions/keybar.tsx';
import { SessionBar } from '../sessions/session-bar.tsx';
import { active, isChatCard, noTab, type Session, screen, sessionList } from '../sessions/store.ts';
import { TermHost, termSessions } from '../sessions/terminal.tsx';
import { Welcome } from '../welcome/view.tsx';
import { Gate } from './gate.tsx';
import { type Icon, icons } from './icons.tsx';

function Palette(): JSX.Element {
  return (
    <dialog id="palette" class="command-dialog" aria-label="Command menu">
      <div class="command" id="palette-command">
        <header>
          {icons.search()}
          <input
            type="text"
            id="palette-input"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            aria-autocomplete="list"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-menu"
          />
        </header>
        <div role="menu" id="palette-menu" aria-orientation="vertical" data-empty="No results found.">
          <PaletteRows />
        </div>
      </div>
    </dialog>
  );
}

// A ghost icon button in the tab bar.
function BarButton(props: {
  icon: Icon;
  label: string;
  title?: string;
  id?: string;
  class?: string;
  pressed?: boolean;
  newSession?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={props.class ?? 'btn'}
      data-variant="ghost"
      data-size="icon-sm"
      aria-label={props.label}
      title={props.title}
      id={props.id}
      aria-pressed={props.pressed}
      data-new-session={props.newSession ? '' : undefined}
      onClick={props.onClick}
    >
      {untrack(props.icon)}
    </button>
  );
}

// The Board button's icon: the list's while the board shows as a list, else
// the columns'.
function BoardIcon(): JSX.Element {
  const shown = boardShown;
  const board = layout;
  return <>{shown() && board() === 'list' ? icons.rows() : icons.board()}</>;
}

// The tab bar spans the page: a tab owns the sidebar, terminal and file pane
// under it. On the board it keeps the Board button, Filter (once onboarded)
// and Settings.
function TabBar(): JSX.Element {
  const shown = boardShown;
  const groups = grouping;
  const explorer = explorerOpen;
  return (
    <div class={shown() ? 'tabbar on-board' : 'tabbar'}>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon-sm"
        aria-label="Board"
        title="Board"
        id="board-btn"
        aria-pressed={shown()}
      >
        <BoardIcon />
      </button>
      <TabStrip />
      <BarButton icon={icons.plus} label="New terminal" title="New terminal" newSession />
      <BarButton
        icon={icons.group}
        label="Group tabs by repo or tag"
        title="Group tabs"
        id="tab-group-btn"
        // Grouping is on: the button stays lit.
        pressed={groups() !== 'none'}
      />
      <FilterButton />
      <BarButton
        icon={icons.explorer}
        label="Toggle file explorer"
        title="Toggle file explorer"
        id="explorer-btn"
        pressed={explorer()}
      />
      <BarButton icon={icons.settings} class="btn settings-btn" label="Settings" id="settings-btn" />
    </div>
  );
}

// The drawer's own bar, standing in for the tab bar's: close, the card's name
// and status, the file explorer (over the sidebar, on the right) and the full
// terminal view.
function DrawerBar(): JSX.Element {
  const drawer = boardDrawer;
  const tab = active;
  const explorer = explorerOpen;
  const title = () => {
    const s = tab();
    return s ? s.name() : '';
  };
  return (
    <header class="drawer-bar" hidden={!drawer()}>
      <BarButton
        icon={icons.arrowRightToLine}
        label="Close drawer"
        title="Close drawer"
        id="drawer-close"
        onClick={() => go({ drawer: false })}
      />
      <span class="drawer-title">{title()}</span>
      {/* Made once: it follows the active card itself. */}
      {untrack(() => DrawerMoveButton(tab))}
      <BarButton
        icon={icons.explorer}
        label="Toggle file explorer"
        title="Toggle file explorer"
        pressed={explorer()}
        onClick={toggleExplorer}
      />
      <BarButton
        icon={icons.expand}
        label="Open in terminals"
        title="Open in terminals"
        id="drawer-expand"
        onClick={() => go({ view: 'terms' })}
      />
    </header>
  );
}

// The terminal layout: terminals, file pane and file sidebar.
function Workspace(): JSX.Element {
  const empty = noTab;
  const pane = paneShown;
  const terms = createMemo<Session[]>(termSessions, []);
  const shown = screen;
  // One chat panel per UI card (like TermHost): keep transcript state while
  // browsing other tabs so a switch never paints another card's messages.
  const chatCards = createMemo(() => sessionList().filter(isChatCard));
  return (
    <div id="workspace">
      <div id="main">
        <SessionBar />
        <div id="terms">
          <div class="empty" id="empty" hidden={!empty()}>
            <p>No terminals open.</p>
            <button type="button" class="btn" data-new-session="">
              New terminal
            </button>
          </div>
          <Gate />
          <For each={terms()}>{(s) => (isChatCard(s) ? null : <TermHost session={s} />)}</For>
          <For each={chatCards()}>
            {(s) => {
              const visible = () => {
                const on = shown();
                return !!on && on.id === s.id;
              };
              return (
                <div class="chat-host" hidden={!visible()}>
                  <ChatPanel sessionId={s.id} agentCommand={s.card().agent} active={visible()} />
                </div>
              );
            }}
          </For>
        </div>
        <KeyBar />
      </div>
      <div id="pane-divider" hidden={!pane()} />
      <aside id="pane" hidden={!pane()} tabindex="-1" aria-label="File" />
      <Sidebar />
    </div>
  );
}

// The board and the workspace side by side: the board alone, the workspace
// alone, or the workspace in a resizable drawer beside the board.
function Stage(): JSX.Element {
  const shown = boardShown;
  const drawer = boardDrawer;
  return (
    <div id="stage">
      <Board />
      <div id="drawer-divider" hidden={!drawer()} />
      <div id="frame" class={drawer() ? 'in-drawer' : ''} hidden={shown() && !drawer()}>
        <DrawerBar />
        <Workspace />
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <>
      <Palette />
      <NewCard />
      <TabBar />
      <Stage />
      <Welcome />
      <div id="drop-glow" aria-hidden="true" />
    </>
  );
}
