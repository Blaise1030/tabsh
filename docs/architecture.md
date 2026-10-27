# Architecture

tabsh has two parts:
- a Rust daemon (`src/`) that runs your shells;
- a web app (`web/`, built with Astro) that shows them.

The daemon also embeds a built copy of the app (`src/app.html` and
`src/app-assets/`), so that `cargo install --git` works without npm.

Both sides are split by **feature**, not by layer. A change to one feature
should touch one folder.

## Daemon (`src/`)

| File | Holds |
|---|---|
| `main.rs` | Startup only: CLI dispatch (`cli::run`), then environment, database path, `AppState`, flusher thread, bind, shutdown |
| `state.rs` | `AppState`, and `router()`, which merges every feature's routes under the guard |
| `error.rs` | `BoxError`, `internal_error` |
| `auth.rs` | The pairing token: load or create it, compare it, read it from a request |
| `web/guard.rs` | The one access check: Host, Origin and token |
| `web/pages.rs` | The pages (`/`, `/open`, `/app/`), the CSP, `/api/about` |
| `perf.rs` | `/api/performance`: resident memory and CPU (a percent of one core, sampled over 200 ms) for the daemon process and for each running session including the processes that shell started |
| `web/assets.rs` | Embedded typing sounds and app bundle (`/sounds/…`, `/_astro/…`) |
| `sessions/` | Shells in PTYs that outlive browser tabs: `store.rs` (SQLite, including `parent` — null on a card, the card's id on a side terminal; closing a card or its shell exiting runs `close_children` — and the tab order set by `PUT /api/sessions/order`), `pty.rs` (spawn, cwd; a shell starts on the blocking pool (`pty::open`), one start, restart or close per session at a time (`Starting`), holding no lock across `openpty` or fork), `ws.rs` (attach: a `{"stream":{epoch,at,resumed}}` text frame, then the replay as the first binary frame; each shell's output counts its bytes under an `epoch` new per shell and daemon run, and a page that kept its screen asks `resume=<epoch>:<at>` for only the bytes after, honoured while they are still in the scrollback, else the whole of it; a text frame from the page is a resize, or `{"ping":n}` answered `{"pong":n}`), `modes.rs` (terminal modes for replay), `activity.rs` (a shell's output as a throttled `output` signal, at most one a second plus a trailing one when the second held some back, and a `bell` for a BEL outside an escape string, at most one per 250 ms, sent on `/api/board/events` as `{session, activity}` from the reader thread outside the `output` lock and from a small sweeper thread, so a parked tab still shows unread and rings; a signal also carries `title`, the window title (OSC 0 or 2) the shell set since the last signal when it changed, so a parked tab, such as a card dragged to In progress, is renamed as its agent names its terminal); shells get `TABSH_SESSION_ID` and `TABSH_URL` (`pty::shell_env`) and type a card's short pending launch line once it runs and the card is In progress (`sessions::launch` types it into a running shell); its first prompt rides in `TABSH_PROMPT` in that shell's environment; a card created with a name (or renamed by the user) is `pinned`, so shell titles don't replace it; after a restart, a card that's In progress, Needs input or Completed whose agent reported its conversation gets its `resume_input` typed into the fresh shell (`pty::startup_input`); one created without a name is titled by its prompt's first line (`board::prompt_title`), unpinned |
| `files/` | The file pane's and the explorer's API: `resolve.rs`, `kind.rs`, `read.rs`, `save.rs`, `folders.rs` (`/api/files/folders`: the New card dialog's folder search, the subfolders that complete a typed path, `~` read as home, hidden ones only after a `.`, capped at `FOLDER_LIMIT`; paths only, and the home folder), `tree.rs` (a tab's project root, served alone at `/api/files/root` for the tab strip's labels, and its listing, capped at `TREE_LIMIT_PATHS`: past it, the sidebar gets its folders alone from the same walk, within the same cap and a scan budget of `FOLDER_SCAN_FACTOR` times it), `watch.rs` (`/api/files/watch`: one `notify` watcher per root shared by its sockets, events coalesced over 100 ms and checked on disk, sent as `{add, remove}` or `{reset}`; a socket also checks its tab's project root every second and sends `{root}` when it changes, moving to the new root's watcher) |
| `board/` | The kanban board: card status columns and their migration (`mod.rs`), `PATCH /api/sessions/{id}/status` (409 for a side terminal, as is `PATCH /api/sessions/{id}/prompt`, so a hook there changes nothing; a hook that changes a card's status moves it to the end of its new column in the tab order, side terminals skipped; pages do the same on its event), `PATCH /api/board/agents/{session}/status` (a hook that can't see its terminal, like an OpenCode plugin, names its card by the conversation tabsh named for it, `agent_session`, with or without the agent's prefix) and `launch_line` (the short line typed for a new card: the agent command with `"$TABSH_PROMPT"` for `{prompt}`, control characters dropped; the prompt itself is stored in `pending_prompt` and passed in the environment, since a PTY line is cut at 1024 bytes on macOS), `resume_line` (a hook fills the card's `resume_command`, its provider's, with the conversation it names, `{session}` taking plain ids only, and stores it as `resume_input`; a card without one resumes Claude Code alone; `{session}` in a startup command has tabsh name the conversation itself, `mint_session`, so the card can resume and be found without a hook saying so), `rules.rs` (hooks never touch archived cards; `unless`; a card made from Backlog's `+` waits there, and only a move to In progress by the board, `launches`, starts its agent), `events.rs` (`/api/board/events`: status changes pushed to pages, each with its `source`: user or hook; and sessions' activity, `{session, activity}`, keyed so older pages ignore it) |
| `chat/` | UI-mode cards' ACP chat: `acp.rs` (newline-delimited JSON-RPC over the agent's stdio: `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/update`, `session/request_permission` held until `POST …/chat/approve` answers it, or answered as allow straight away while the card's Approvals toggle is on; the child is given that card's `TABSH_SESSION_ID` and this daemon's `TABSH_URL`, overriding any inherited value; stdout EOF drops the live chat after one error chunk so the next message starts a new agent and the JSONL stays above it), `normalize.rs` (ACP events → the locked `UiChunk` shape, one flat `type`-tagged JSON object per chunk, plus an `error` chunk whose `message` is a spawn or auth failure), `manager.rs` (`ChatManager` in `AppState.chats`: at most one live ACP agent per card; a card's ACP command is stored at create in the nullable `acp_command` session column, mirroring `pending_command`; a UI card moved to In progress starts ACP with its `pending_prompt` as the first prompt and never types a PTY launch line; `POST …/chat/message` may continue a live chat in any column but does not start the first agent unless the card is In progress or further along, and a launch that finds a live chat which has not yet been given `pending_prompt` sends that prompt once, while a TUI card keeps the PTY path; one agent surface per card is a single atomic claim — the chat entries and the PTY claims are taken under one lock in `manager.rs`, so starting a chat over a claimed PTY is 409 and `pty::get_or_spawn` refuses while a chat is claimed, with no check-then-act window; the PTY claim is released on shell exit or close; a card's Approvals setting is kept beside the surfaces so it applies before the handshake finishes and is dropped with the live chat, so a new agent process starts at Ask), `transcript.rs` (append-only JSONL at `{data_dir}/chats/{session_id}.jsonl`, `data_dir` beside the database), `models.rs` (the model and session-mode selects from ACP `configOptions`, each choice's optional description, refreshed together from every `set_config_option` reply), `routes.rs` (guarded `GET …/chat` history as `{messages}`, `GET …/chat/stream` SSE replaying history then live chunks, `POST …/chat/message` 202 spawning the prompt turn, `POST …/chat/stop` cancelling the turn even when the agent never answers, `POST …/chat/approve` answering a pending permission, `GET/POST …/chat/approvals` for auto-answering permission requests, `GET …/chat/models` and `POST …/chat/model` for `session/set_config_option` when the agent advertises a model option, `GET …/chat/modes` and `POST …/chat/mode` for its session-mode option. An idle `end_turn` moves an In progress card to Needs input unless a hook or a drag already did; `completed` only when the agent sends `sessionUpdate: session_end`). With `TABSH_TEST_ACP=1`, a UI card stores `TABSH_CHAT_ACP` when that is set, otherwise `fake-agent` (on `PATH`), as `acp_command` instead of the provider command the page sent |
| `cli/` | Subcommands on the same binary: `status.rs` (`tabsh status`, a one-shot loopback PATCH; `--hook` is silent, always exits 0, never reads a terminal's stdin, and accepts one trailing JSON payload argument whose `message` is the note; the payload's `session_id` is sent as the card's agent conversation, and under Claude Code (`CLAUDECODE=1`) so is the agent; without `TABSH_SESSION_ID`, a hook reports by that conversation instead), `setup.rs` and `setup.md` (`tabsh setup`: the guide an agent follows to wire its own hooks to `tabsh status`, with OpenCode's plugin given whole, the binary and daemon filled in as JavaScript strings; tabsh never edits agent config) |
| `remote/` | "Open on another device": `mod.rs` (`/api/remote` routes, the `remote` and `devices` tables, minting and revoking device tokens, `admit` for sockets), `listen.rs` (the Tailscale address and the second listener on it; `TABSH_REMOTE_ADDRESS` replaces the detection, for tests). Revoking a device closes that device's sockets; turning sharing off closes every socket from another machine, the main token's included, and none of this machine's; a socket that races the subscribe is refused with 403 |
| `settings.rs` | `/api/settings`: the page's preferences as one JSON object |
| `upload.rs` | `/api/uploads`: files dropped onto a terminal or attached to a new card |
| `test_support.rs` | `test_state()` and `scratch()` for tests |

**Rules**
- **Routes:** each feature exposes `pub(crate) fn routes() -> Router<AppState>`.
  `state::router()` is the only place routes are attached.
- **Visibility:** nothing is bare `pub`. Use `pub(crate)` across features,
  `pub(super)` inside one, and private otherwise. Features reach each other
  only through these items. For example, `files` asks
  `sessions::cwd()` for a tab's directory.
- **Tests:** they live in the `mod tests` of the file that owns the code.
  `state.rs`'s `every_route_is_guarded` pins every route behind the guard.

**A new daemon feature** gets its own file or folder with `routes()`. Merge
it in `state::router()`, and add its routes to `every_route_is_guarded`.

## App (`web/src/app/`)

| Folder | Holds |
|---|---|
| `main.ts` | Startup only: adopt the token, wire the features, restore tabs |
| `nav/` | `place.ts` (the place: tab, term, view, drawer, file, line, explorer, palette, and its query string; pure; `term` names the side terminal on screen inside the tab, and a change of tab without `term` clears it; the board is home, so `view=terms` is written only for the legacy terminal workspace), `router.ts` (the one `navigate` handler, on the Navigation API: `go`, `here`, `onPlace` (each feature's step, run in the order tab → view → drawer → file → explorer → palette), `onLeave`, `startRouter`, `back`, `forward`, `backPastPalette`, `isPaletteEntry`, `isLeavingPalette`; the Back and Forward keybindings (`keyBack`, `keyForward`) and the palette's "Go back" live in `palette/palette.ts` and call them) |
| `daemon/` | `config.ts` (which daemon), `token.ts` and `parse.ts` (pairing), `client.ts` (`daemonFetch`, `api`, the connection gate) |
| `settings/` | `catalog.ts` (themes, fonts, sounds), `keys.ts` (keybindings), `schema.ts` (`Settings`, cleanup, the agent providers: a name, a startup command with `{prompt}`, a resume command with `{session}`, an optional ACP command for UI mode), `settings.ts` (current values, apply, save, `keyHint`, `onApply` and `onSaved`) |
| `sessions/` | `store.ts` (tabs and the active tab as states, sync; `sessionList` is cards only, each card's `sides` are its side terminals, `onScreen()` is the place's `term` or else the active card), `session-bar.ts` (Agent, those side terminals, and `+`, above the terminal in the terminals view and the board's drawer), `terminal.ts` (xterm, socket; only the on-screen terminal holds a socket — the place's `term`, or the active card, while terms or the board drawer show; a UI-mode card shows chat instead and does not attach — so sleep, tab switches and a drag that launches an agent do not replay every scrollback at once; reconnects still drain one at a time; the on-screen tab's live output reaches xterm once a frame, the replay at once; a reattach resumes after the bytes the screen holds rather than clearing it, and a parked tab's unpainted output is painted, not dropped), `coalesce.ts` (that per-frame write coalescing, pure), `keybar.ts` (the touch key bar under the terminal: a paperclip whose picked files are uploaded and their paths typed, as a drop's are, Paste (the clipboard API where the page may read it; over plain HTTP a sheet with a text box, where the phone's own Paste goes straight to the terminal and Send takes typed text), Esc, a sticky Ctrl, a one-tap ^C, Shift+Tab (back-tab, Claude Code's mode switch), Tab, Space, Enter, arrows and a few symbols, typed through xterm; its buttons never take focus; touch screens only, and while a terminal has focus the workspace ends above the keyboard, `--keyboard`), `extra-keys.ts` (what those keys type, arrows by cursor-key mode, and a Ctrl chord; pure), `touch.ts` (a terminal's touch gestures in place of xterm's: one finger scrolls the scrollback by whole lines, full-screen programs keep xterm's handling; a long press selects a word, a drag extends it, lifting copies it; two fingers pinch this device's font size, `setDeviceFontSize`, kept in the browser and cleared by choosing a size in the palette), `gestures.ts` (their arithmetic; pure), `heartbeat.ts` (a ping every 15 s and on waking, `online` or `pageshow`; no pong within 4 s drops the socket and reattaches, once its daemon has answered one; pure), `reconnect.ts` (coalesced sync, reconnect queue and in-view check, pure), `tab.ts` (a tab, drawn from its session's states), `tabs.ts` (tab strip, dragging tabs into order), `order.ts` (where a dragged tab lands), `tags.ts` (each tab's repo and tags, the tag menu), `groups.ts` (`TabStrip`, the strip drawn from state: grouping it by repo or tag, labels, collapsing, copies of multi-tag tabs; archived cards' tabs kept out of the strip and its groups), `labels.ts` (their pure logic), `bell.ts` and `bell-scan.ts`, `activity.ts` (what a board-events activity signal does to a tab: unread for a parked, inactive one, and a ring for any parked one, `ring()` deciding whether you're looking; pure; a signal's `title` renames a parked, unpinned tab in `board/events.ts`, as xterm's title does an attached one) |
| `chat/` | A UI-mode card's agent surface: `client.ts` (SSE `data:` lines into the locked `UiChunk` shape, plus an `error` for a spawn or auth failure; one connection's replay replaces the transcript so a reconnect does not show finished turns twice; `POST …/chat/message`, `POST …/chat/stop`, `POST …/chat/approve`, `GET …/chat/models`, and `POST …/chat/model` through `daemonFetch`), `turn.ts` (a turn is open from `user_text` until `turn_end` or `error`), `panel.tsx` (`ChatPanel` with `{ sessionId }`), `composer.tsx`, `select-picker.tsx` (model and agent-mode chips when the agent advertises them; each model wears its vendor's mark, falling back to the card agent's), `model-brand.ts` (that inference, pure), `approvals-toggle.tsx` (Approve or Allow all for permission requests), `parts.tsx` (Solid JSX). `ui/app.tsx` mounts it instead of that card's `TermHost` when the on-screen card's `mode` is `ui` and the place names no side terminal |
| `links/` | `links.ts` (finding URLs and paths), `provider.ts` (xterm link provider) |
| `files/` | `api.ts` (file API client), `open.ts` (the file step and its unsaved-edits guard: the place's file is the active tab's, by the absolute path the daemon resolved; loads the pane on first use, reopens the other tabs' files after a reload), `remember.ts` (each tab's file, in `localStorage`), `pane.ts` and `editor.ts` (pane and CodeMirror), `comments.ts` (a source comment's range and the message Send pastes; `mapComments` moves a range with an edit and marks it lost when its quote no longer matches), `notes.ts` (the Comment button over a rested selection, the box and the hover card). The box shows the selection, its first line then the rest. Cancel sits on the left. Queue (Shift+Enter, outline) keeps the comment on the list, and Send directly (Enter, solid) pastes that one comment and leaves the others. The pane header's paper plane wears the comment count and opens the list for every file noted in this tab (each row is the muted file name and the lines, then the note, then the quote, each on its own line; choosing one opens that file and jumps to the passage). Opening another file keeps the comments. Send to terminal stays at the top of the list while the rows scroll, and pastes them through `Host.paste` only when that terminal is in bracketed-paste mode, then clears the list. The Markdown preview, still without script, draws each comment on the block it covers without scrolling the preview away, and a selection there offers Comment the same way the source does, including when the pointer is released at once. Unsent comments count as unsaved work (`hasUnsaved`, `isDirty`, `confirmDiscard`) |
| `explorer/` | `explorer.ts` (the sidebar: its states `open`, `root`, `note`, `message`, `width`; toggle, divider drag, fetch on open and on tab switch, `/`, "Search files" and its keybinding opening the search), `sidebar.ts` (`Sidebar()`: the aside's root, note and message lines and the tree's host, made once, and the divider, from those states), `view.ts` (the tree, its search and its row menu, drawn by `@pierre/trees`), `listing.ts` (the listing as what the sidebar shows, row paths, pasted paths and `cd` commands, a row menu's entries, whether a key opens the search), `api.ts` (the listing request), `socket.ts` (the live socket, open while the sidebar is, reconnecting), `changes.ts` (a live message as tree operations, or a re-fetch for a new root) |
| `board/` | `model.ts` (statuses, columns, grouping, drop order, no DOM), `glyph.ts` (status names), `status.ts` (a tab's card: glyph, archived tabs hidden, bell on needs input), `events.ts` (the board events socket; each event says its `source`, user or hook; activity events go to `sessions/activity.ts`), `notify.ts` (a desktop notification and a chime when a hook moves a card to Needs input or Completed, unless that terminal is on screen in a focused window; permission asked on the first click), `view.ts` (the board as components following `sessionList` and each card's state and tags, `shown` set by the view step; columns for the stages then Archived, shown like the others (no +; its cards dragged and opened as any card), drag and drop incl. onto Archived (archiving is otherwise in the card's menu: right-click a card, long-press it on a phone, or press Shift+F10), titles and notes clamped to two lines with Show more; the board fades at the left and right where columns are scrolled out of view; until the `boardOnboarded` setting is true, a setup screen instead of columns, whose button opens a Claude Code card that runs `tabsh setup` and leaves the board open; a Filter icon beside Settings, shown once the board is onboarded, checks tags and folders: any checked tag, any checked folder, and nothing checked shows every card; the board is the only workspace and opens as a list (the `boardLayout` setting's default); the Board button and its shortcut (`keyToggleBoard`, ⌘B) switch between the columns and the list, and return from an expanded drawer (the button's icon the list's while it shows; the tab bar as tall in each), and the palette's Board layout switches between the two; a phone (`ui/dom.ts`'s `phone`) opens the active terminal in the board's drawer, and `openTerminalOnPhone` does that after startup and on a turn into phone size; `drawerExpanded` gives the drawer the whole page, the board and list stepping out of its way while its bar stays for the way back; the list is like Linear's: each status a sticky heading over one-line rows (status, name, note, tags, folder, agent, time), a heading's chevron folding its rows away (kept in this browser), rows dragged and dropped as cards, a drop on a folded heading going to its end), `move-menu.ts` (a card's menu, as Basecoat's dropdown (`dropdown-menu.min.js`, pinned in the page) with its popover fixed under the button, following it as the board scrolls: a card's ⋯ button beside its status glyph, or the status by name in the drawer's bar, lists the stages to move it to, its Tags (`tags-submenu.ts`: a submenu beside it, the same rows as a tab's tag menu: a field making a new tag above checkboxes for the tags in use; New card's Tags chip uses this panel), then Archive (Restore, for an archived card, which has no buttons of its own) and Delete session), `new-card.ts` (the New card dialog, laid out like Linear's New issue (clicking its backdrop closes it), from the + of Backlog or In progress (the other columns have none), or the New card shortcut (`keyNewCard`, Backlog): folder, a combobox chip whose popover holds its search (`folder-picker.ts`, the folder field as a search: subfolders listed as it's typed, recent folders until it's edited, ↑↓, Enter, Tab to go into one, Esc; `folders.ts`, its pure logic), prompt as the body, agent provider as a chip, a Basecoat dropdown (set up in the palette, the last one used first; its startup and resume commands go to the daemon), the column (Backlog or In progress, a Basecoat dropdown) and tags, a chip opening the same tags panel as a card's Tags submenu (`tags-submenu.ts`'s `TagsPanel`: the tags in use to tick several, and a field making a new one; the group it opens in gives its tag, which can be unticked), no title; images dropped on the dialog, pasted into the prompt or picked with the paperclip are uploaded (`/api/uploads`) on Create and their paths follow the prompt, one a line (`withImages`); Create more keeps it open for the next card; the board stays open; the card goes on top of its column; made from In progress, its agent starts at once) |
| `sound/` | `packs.ts` (samples), `typing.ts` (key listeners: typing sounds everywhere in the app, in the pack on screen, except app shortcuts), `chime.ts` (the notifications' chimes, synthesized, each status's picked in the palette's Sound group (`needsInputSound`, `completedSound`; by default a rising ping for Needs input, an arpeggio for Completed) and heard while highlighted; audio unlocked by the first click or key) |
| `remote/` | `model.ts` (which screen the palette's Open on another device page shows from the daemon's answer, its message, and a device's last-seen text; pure), `api.ts` (the four `/api/remote` calls through `daemonFetch`), `qr.ts` (the pairing QR as SVG elements, reaching `uqr` only through `import()`), `share.ts` (what those pages show and their changes, one at a time: the sharing switch, Add device, the QR and link shown once, revoking; the palette draws it and redraws on `onRemoteChange`, and `forgetRemote` drops it all once the pages are left; the link, which holds the device's token, is never stored, put in the address bar or logged) |
| `welcome/` | `steps.ts` (the tour's screens as data — title, body, whether the screen offers Skip, whether it is the agents setup — with the step clamp, the settings a view choice saves and the choice the saved settings name, and what a dismissal and a finished setup write — pure), `view.ts` (the dialog: one full-page screen per step with its choices, opened on first load and again from the palette's Show welcome, which closes the palette first — both are modals; a layout picked during an opening moves the app to the board on close, Skip marks only the tour seen, and the agents screen's Set up opens the provider's setup card and ends the tour in split with that card once it opened) |
| `pwa/` | `register.ts` (installability: `serviceWorkerUrl` says only `/app/` gets the worker at `/app/sw.js` — never the demo — and `initPwa` registers it; the manifest, worker and icons live in `web/public/app/`, served by the hosted site and embedded by the daemon; the worker caches the page shell and hashed `/_astro/` bundles cache-first, navigations network-first, and never intercepts `/api/`, `/ws` or `/sounds/`) |
| `palette/` | `pages.ts` (what the palette offers), `palette.ts` (dialog, preview, shortcuts, a text edit in its input (the agent providers' pages), the grouping page the group button and its keybinding open; Esc on a page returns to the page that opened it, the providers list from a provider; About tabsh and Performance are pages too, their rows copied on click; Performance is fetched from `/api/performance` each time it opens; Open on another device (`remote`, from Help) is a page, each device's own page (`remote:<id>`) holding Revoke, Esc there returning to the devices) |
| `ui/` | `dom.ts` (`isMac`, `phone`: a touch screen under 800px), `icons.tsx` (every icon, as SVG in JSX), `presence.tsx` (lists by key that keep leaving items while they exit), `app.tsx` (the page shell: the board replaces the workspace — terminals, file pane, then the file sidebar on the right — and the tab bar keeps only its Board button, the Filter button once the board is onboarded, and Settings; a clicked card (or the open tab, when the board is opened) shows the workspace in a drawer beside the board, and a click on the board's empty space closes it, `drawer=1` in the URL, with its own bar and a divider whose width is the `drawerWidth` setting; on a wide window that terminal column is the full height of the page, and the tab bar (Board, Filter, Settings) covers only the board, in columns and in the list; the drawer's close is arrow-right-to-line and its expand button hides the board, list and the board's bar, giving the drawer the page, with its own bar staying for the way back; the file explorer's button sits on the right of the tab bar and the drawer's bar, over the sidebar), `gate.tsx` (the connection gate's screens, from `daemon/client.ts`'s `gateMode`), `divider.ts`, `about.ts` (About tabsh's rows, fetched from `/api/about` each time the palette's About page opens), `drop.ts` and `drop-paths.ts`, `keyboard.ts` (`--keyboard`: how much an iOS on-screen keyboard covers, so the phone sheets sit above it), `no-markup.test.ts` (the guard: no `innerHTML` in the app) |

**The demo (`web/src/demo/`, `web/src/pages/demo/`).** The landing page
frames `/demo/`: the same app, built into a second page, on a pretend daemon.
`demo/daemon.ts` answers the app's requests and sockets from memory (scripted
shells, files, board events, and a UI card's chat: `GET …/chat` as
`{messages}`, an SSE `…/chat/stream` that replays that history and stays
open, `POST …/chat/message` appending a short assistant reply, and
`POST …/chat/stop` and `…/chat/approve`), keeps browser storage in memory, and holds off
focus until the visitor clicks in. It starts `main.ts` with a dynamic import
after those replacements: a static import is evaluated first, and the app's
opening `/api/about` would then be a real request, which `/demo/`'s
`connect-src` refuses.
`demo/origin.ts` is the never-resolving origin the page's meta tag names. The
app itself knows nothing of the demo: a change to the app shows up there as is,
and a new daemon endpoint may need an answer in `demo/daemon.ts`.

The page's CSS is in `web/src/styles/app.css`. Shared design tokens (shadcn-shaped
CSS variables plus a Tailwind `@theme` bridge) live in `web/src/styles/tokens.css`:
`settings` sets `--term-bg` / `--term-fg` on `<html>`, `html.themed` derives
`--background`, `--foreground`, `--muted`, and the rest, and Basecoat consumes
those same variables. The page's `<head>` is in `web/src/pages/app/index.astro`;
its body is one mount point, `#app`, and `main.ts` mounts `ui/app.tsx`'s `App()`
into it first, so the markup comes from components.

**Rules**
- **One-way dependencies between features:**
  - `nav` → `daemon` → `settings` → `sound`
  - `nav` → `daemon` → `chat` → `sessions` → `explorer` → `palette` and `ui` → `main`
  - `nav` → `daemon` → `files` → `links` → `sessions`

  A lower feature never imports a higher one:
  - `settings` tells others about changes through `onApply` and `onSaved`;
  - `files/open.ts` gets a `Host` from `main.ts`;
  - `nav` imports no feature: features register their steps with it;
  - `palette` and `ui` may import `welcome` and `remote`, and `welcome` may import `settings` and the board helper.

  Inside one folder, modules may import each other, as long as their top
  level doesn't call across.
- **Only the router moves:** only the router changes the active tab, view,
  file, explorer or palette; everything else calls `go()`. Back, Forward and
  reload then walk the same places.
- **Pure logic stays testable:** files that `node --test` loads don't touch
  the DOM when imported: `links.ts`, `files/api.ts`, `files/comments.ts`, `daemon/parse.ts`,
  `chat/client.ts`, `chat/deliver.ts`, `chat/model-brand.ts`,
  `settings/catalog.ts`, `keys.ts`, `schema.ts`, `sessions/bell-scan.ts`, `sessions/activity.ts`,
  `sessions/coalesce.ts`, `sessions/extra-keys.ts`, `sessions/gestures.ts`, `sessions/heartbeat.ts`, `sessions/labels.ts`, `sessions/order.ts`, `sessions/reconnect.ts`,
  `explorer/listing.ts`, `explorer/changes.ts`, `board/folders.ts`, `welcome/steps.ts`, `remote/model.ts`, `pwa/register.ts`, `ui/drop-paths.ts`, `ui/presence.ts`, `ui/performance.ts`, `nav/place.ts`, and `ui/no-markup.test.ts`'s rule (it only reads files). Their tests sit beside them as `*.test.ts`.
- **Components:** a component is a function returning JSX in a `.tsx` file.
  Props are typed and not destructured. Lists and conditionals use `<For>`
  and `<Show>`. Prefer `on:` handlers where stopPropagation or capture
  matters. User text goes in as a child string or an attribute value, never
  as markup.
- **State:** each feature owns its `createSignal` pairs; the router's steps
  assign them. Signals are assigned whole (`setX(next)`), never mutated in
  place. There is no global store. Read signals in JSX or in effects
  (`createEffect`, `createComputed`), not once in a component body for a
  value that should update.
- **Timing:** do not wait for a framework to apply state. Use `ref`,
  `onMount` and `createEffect` for work that needs the DOM after render.
  xterm, CodeMirror and the tree stay in hosts created once.
- **The editor stays lazy:** `files/pane.ts` and `editor.ts` (CodeMirror,
  `marked`) are only reached through `import()`. The daemon test
  `entry_script_does_not_bundle_the_editor` fails if the page's first load
  includes them.
- **The tree stays lazy:** `explorer/view.ts` is the only importer of
  `@pierre/trees`, and `explorer.ts` reaches it through `import()` when the
  sidebar first has a tree to show. The same daemon test fails if the page's
  first load includes the library.
- **The QR encoder stays lazy:** `remote/qr.ts` is the only importer of `uqr`,
  and reaches it through `import()` when the palette first draws a code.
- **CDN globals:** xterm and its fit addon come from the SRI-pinned CDN
  scripts. Their npm packages are used for types only (`import type`,
  `globals.d.ts`).

**A new app feature** gets a folder with an `init…()` function, called from
`main.ts`. Put its pure logic in a file of its own, with a test.

## Security invariants

A refactor must not change any of these.

- **Guard:** `web/guard.rs`'s `guard` wraps every route.
  - The Host must be loopback, `tabsh.localhost` or an IP address.
  - From a browser page (with an Origin), every route needs a known Origin
    and the token. The only exceptions are GET or HEAD of a single-segment
    `/_astro/{name}` and of the named PWA files under `/app/` (manifest,
    service worker, icons in `web/public/app/`, embedded by `build.rs`).
  - Without an Origin, only GET/HEAD of the page (`/`, `/open`, `/app`,
    `/app/`) and its assets pass without the token. Every other route
    needs it as a direct call. Trusted local callers (`tabsh status`,
    agent hooks) read the token file and send `Authorization: Bearer …`.
  - **Threat model:** tabsh is a single-user daemon. `/` and `/open`
    deliberately hand the token to loopback browsers so they can pair,
    and a process running as this user can read the token file anyway.
    The guard is therefore a boundary against browsers, DNS rebinding
    and remote peers — not a sandbox between local processes. Do not
    claim protection against local malware running as the user.
  - From a non-loopback peer, every route needs a token (the main one or a
    device's), with or without an Origin, except GET or HEAD of the page
    (`/`, `/open`, `/app`, `/app/`) and its assets (`/_astro/{name}`,
    `/sounds/…`). With sharing off, a non-loopback peer is refused, unless
    `HOST` is fixed. An IPv4-mapped loopback address (`::ffff:127.0.0.1`)
    is loopback. A request without a peer address is refused.
  - A device token can't reach `/api/remote*`.
- **Token:** it arrives in the URL fragment and is cleared from the address
  bar before any request, except on another device (the page's host is a
  non-loopback IP), where a home-screen app needs it in its saved address.
  Nothing rendered from a file can read it. Its file is opened with
  `O_NOFOLLOW` and validated by `fstat` on that same descriptor, then
  read, repaired (`0600`) or replaced through it — never re-resolved by
  path. A symlink, a non-regular file or another user's file is refused.
  Browser WebSockets carry
  it as `?token=` (they cannot set headers); that accepted exposure is
  limited to the daemon's own logs, never a proxy by default.
- **Bind:** `HOST=0.0.0.0`/`::` is refused unless
  `TABSH_ALLOW_INSECURE_BIND=1`. A specific non-loopback `HOST` is the
  documented fixed-host mode and only warns: it exposes the same plain
  HTTP API to that interface, so the warning, not the guard, is its
  safeguard. Prefer Tailscale sharing or a trusted tunnel.
- **File previews:**
  - HTML renders in `<iframe sandbox="allow-scripts allow-popups">`.
  - Markdown renders in `<iframe sandbox="allow-same-origin">`. Scripts stay off, so a file still cannot read the token or call the daemon; same origin only lets the pane read a text selection and offer Comment. SVG renders in `<iframe sandbox="">`.
  - Images and PDFs load from `blob:` URLs.
  - File content never goes through `innerHTML`.
- **No markup strings:** no `innerHTML`, `outerHTML` or `insertAdjacentHTML` in
  `web/src/app` (`ui/no-markup.test.ts`).
- **URLs select, never act:** a URL only selects what exists: it never opens
  a tab, runs a command, sets a `cwd` or saves a file. The query string
  holds the place; the router never reads the fragment (the token's), and
  the daemon's app page sends `Referrer-Policy: no-referrer`
  (`local_app_sends_no_referrer`).
- **The demo holds nothing:** `/demo/` never reaches a daemon. It answers
  only its own `.invalid` origin, refuses every other request and socket,
  never reads real storage (so no token), and its CSP in `web/public/_headers`
  allows `connect-src 'self'` alone. Only `/demo/` may be framed, and only by
  this site; `/app/` keeps `frame-ancestors 'none'`.
- **CSP:** `web/public/_headers` and `APP_CSP` (`web/pages.rs`) stay in step.
  Neither allows `'unsafe-inline'` scripts, so the page has no inline
  `<script>` or `on…=` attributes. Tests in `web/pages.rs` enforce both.

## Checks

Run at the repo root:
- `cargo fmt --check`
- `cargo clippy --all-targets --locked -- -D warnings`
- `cargo test --locked`

Run in `web/`:
- `npm run check`: strict TypeScript, through `astro check`
- `npm run lint`: Biome, for lint and formatting
- `npm test`
- `npm run build`: this also refreshes `src/app.html` and `src/app-assets/`,
  which are committed
