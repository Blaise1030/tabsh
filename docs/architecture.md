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
| `web/assets.rs` | Embedded typing sounds and app bundle (`/sounds/…`, `/_astro/…`) |
| `sessions/` | Shells in PTYs that outlive browser tabs: `store.rs` (SQLite, and the tab order set by `PUT /api/sessions/order`), `pty.rs` (spawn, cwd), `ws.rs` (attach), `modes.rs` (terminal modes for replay), `activity.rs` (a shell's output as a throttled `output` signal, at most one a second, and an immediate `bell` for a BEL outside an escape string, sent on `/api/board/events` from the reader thread outside the `output` lock, so a parked tab still shows unread and rings); shells get `TABSH_SESSION_ID` and `TABSH_URL` (`pty::shell_env`) and type a card's short pending launch line once it runs and the card is In progress (`sessions::launch` types it into a running shell); its first prompt rides in `TABSH_PROMPT` in that shell's environment; a card created with a name (or renamed by the user) is `pinned`, so shell titles don't replace it; after a restart, a card that's In progress, Needs input or Completed whose agent reported its conversation gets its `resume_input` typed into the fresh shell (`pty::startup_input`); one created without a name is titled by its prompt's first line (`board::prompt_title`), unpinned |
| `files/` | The file pane's and the explorer's API: `resolve.rs`, `kind.rs`, `read.rs`, `save.rs`, `folders.rs` (`/api/files/folders`: the New card dialog's folder search, the subfolders that complete a typed path, `~` read as home, hidden ones only after a `.`, capped at `FOLDER_LIMIT`; paths only, and the home folder), `tree.rs` (a tab's project root, served alone at `/api/files/root` for the tab strip's labels, and its listing, capped at `TREE_LIMIT_PATHS`: past it, the sidebar gets its folders alone from the same walk, within the same cap and a scan budget of `FOLDER_SCAN_FACTOR` times it), `watch.rs` (`/api/files/watch`: one `notify` watcher per root shared by its sockets, events coalesced over 100 ms and checked on disk, sent as `{add, remove}` or `{reset}`; a socket also checks its tab's project root every second and sends `{root}` when it changes, moving to the new root's watcher) |
| `board/` | The kanban board: card status columns and their migration (`mod.rs`), `PATCH /api/sessions/{id}/status` (a hook that changes a card's status moves it to the end of its new column in the tab order; pages do the same on its event), `PATCH /api/board/agents/{session}/status` (a hook that can't see its terminal, like an OpenCode plugin, names its card by the conversation tabsh named for it, `agent_session`, with or without the agent's prefix) and `launch_line` (the short line typed for a new card: the agent command with `"$TABSH_PROMPT"` for `{prompt}`, control characters dropped; the prompt itself is stored in `pending_prompt` and passed in the environment, since a PTY line is cut at 1024 bytes on macOS), `resume_line` (a hook fills the card's `resume_command`, its provider's, with the conversation it names, `{session}` taking plain ids only, and stores it as `resume_input`; a card without one resumes Claude Code alone; `{session}` in a startup command has tabsh name the conversation itself, `mint_session`, so the card can resume and be found without a hook saying so), `rules.rs` (hooks never touch archived cards; `unless`; a card made from Backlog's `+` waits there, and only a move to In progress by the board, `launches`, starts its agent), `events.rs` (`/api/board/events`: status changes pushed to pages, each with its `source`: user or hook; and sessions' activity, `{id, activity}`) |
| `cli/` | Subcommands on the same binary: `status.rs` (`tabsh status`, a one-shot loopback PATCH; `--hook` is silent, always exits 0, never reads a terminal's stdin, and accepts one trailing JSON payload argument whose `message` is the note; the payload's `session_id` is sent as the card's agent conversation, and under Claude Code (`CLAUDECODE=1`) so is the agent; without `TABSH_SESSION_ID`, a hook reports by that conversation instead), `setup.rs` and `setup.md` (`tabsh setup`: the guide an agent follows to wire its own hooks to `tabsh status`, with OpenCode's plugin given whole, the binary and daemon filled in as JavaScript strings; tabsh never edits agent config) |
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
| `nav/` | `place.ts` (the place: tab, view, drawer, file, line, explorer, palette, and its query string; pure), `router.ts` (the one `navigate` handler, on the Navigation API: `go`, `here`, `onPlace` (each feature's step, run in the order tab → view → drawer → file → explorer → palette), `onLeave`, `startRouter`, `back`, `forward`, `backPastPalette`, `isPaletteEntry`, `isLeavingPalette`; the Back and Forward keybindings (`keyBack`, `keyForward`) and the palette's "Go back" live in `palette/palette.ts` and call them) |
| `daemon/` | `config.ts` (which daemon), `token.ts` and `parse.ts` (pairing), `client.ts` (`daemonFetch`, `api`, the connection gate) |
| `settings/` | `catalog.ts` (themes, fonts, sounds), `keys.ts` (keybindings), `schema.ts` (`Settings`, cleanup, the agent providers: a name, a startup command with `{prompt}`, a resume command with `{session}`), `settings.ts` (current values, apply, save, `keyHint`, `onApply` and `onSaved`) |
| `sessions/` | `store.ts` (tabs and the active tab as states, sync), `terminal.ts` (xterm, socket; only the on-screen tab holds a socket — active while terms or the board drawer show — so sleep, tab switches and a drag that launches an agent do not replay every scrollback at once; reconnects still drain one at a time), `reconnect.ts` (coalesced sync, reconnect queue and in-view check, pure), `tab.ts` (a tab, drawn from its session's states), `tabs.ts` (tab strip, dragging tabs into order), `order.ts` (where a dragged tab lands), `tags.ts` (each tab's repo and tags, the tag menu), `groups.ts` (`TabStrip`, the strip drawn from state: grouping it by repo or tag, labels, collapsing, copies of multi-tag tabs; archived cards' tabs kept out of the strip and its groups), `labels.ts` (their pure logic), `bell.ts` and `bell-scan.ts`, `activity.ts` (what a board-events activity signal does to a tab: unread and a ring for a parked, inactive one only; pure) |
| `links/` | `links.ts` (finding URLs and paths), `provider.ts` (xterm link provider) |
| `files/` | `api.ts` (file API client), `open.ts` (the file step and its unsaved-edits guard: the place's file is the active tab's, by the absolute path the daemon resolved; loads the pane on first use, reopens the other tabs' files after a reload), `remember.ts` (each tab's file, in `localStorage`), `pane.ts` and `editor.ts` (pane and CodeMirror) |
| `explorer/` | `explorer.ts` (the sidebar: its states `open`, `root`, `note`, `message`, `width`; toggle, divider drag, fetch on open and on tab switch, `/`, "Search files" and its keybinding opening the search), `sidebar.ts` (`Sidebar()`: the aside's root, note and message lines and the tree's host, made once, and the divider, from those states), `view.ts` (the tree, its search and its row menu, drawn by `@pierre/trees`), `listing.ts` (the listing as what the sidebar shows, row paths, pasted paths and `cd` commands, a row menu's entries, whether a key opens the search), `api.ts` (the listing request), `socket.ts` (the live socket, open while the sidebar is, reconnecting), `changes.ts` (a live message as tree operations, or a re-fetch for a new root) |
| `board/` | `model.ts` (statuses, columns, grouping, drop order, no DOM), `glyph.ts` (status names), `status.ts` (a tab's card: glyph, archived tabs hidden, bell on needs input), `events.ts` (the board events socket; each event says its `source`, user or hook; activity events go to `sessions/activity.ts`), `notify.ts` (a desktop notification and a chime when a hook moves a card to Needs input or Completed, unless that terminal is on screen in a focused window; permission asked on the first click), `view.ts` (the board as components following `sessionList` and each card's state and tags, `shown` set by the view step; columns for the stages then Archived, shown like the others (no +; its cards dragged and opened as any card), drag and drop incl. onto Archived (archiving is otherwise in the card's menu), titles and notes clamped to two lines with Show more, ⌘B; the board fades at the left and right where columns are scrolled out of view; until the `boardOnboarded` setting is true, a setup screen instead of columns, whose button opens a Claude Code card that runs `tabsh setup` and leaves the board open; a Filter icon beside Settings, shown once the board is onboarded, checks tags and folders: any checked tag, any checked folder, and nothing checked shows every card), `move-menu.ts` (a card's menu, as Basecoat's dropdown (`dropdown-menu.min.js`, pinned in the page) with its popover fixed under the button, following it as the board scrolls: a card's ⋯ button beside its status glyph, or the status by name in the drawer's bar, lists the stages to move it to, its Tags (`tags-submenu.ts`: a submenu beside it, the same rows as a tab's tag menu: a field making a new tag above checkboxes for the tags in use; New card's Tags chip uses this panel), then Archive (Restore, for an archived card, which has no buttons of its own) and Delete session), `new-card.ts` (the New card dialog, laid out like Linear's New issue (clicking its backdrop closes it), from the + of Backlog or In progress (the other columns have none), or the New card shortcut (`keyNewCard`, Backlog): folder, a combobox chip whose popover holds its search (`folder-picker.ts`, the folder field as a search: subfolders listed as it's typed, recent folders until it's edited, ↑↓, Enter, Tab to go into one, Esc; `folders.ts`, its pure logic), prompt as the body, agent provider as a chip, a Basecoat dropdown (set up in the palette, the last one used first; its startup and resume commands go to the daemon), the column (Backlog or In progress, a Basecoat dropdown) and tags, a chip opening the same tags panel as a card's Tags submenu (`tags-submenu.ts`'s `TagsPanel`: the tags in use to tick several, and a field making a new one; the group it opens in gives its tag, which can be unticked), no title; images dropped on the dialog, pasted into the prompt or picked with the paperclip are uploaded (`/api/uploads`) on Create and their paths follow the prompt, one a line (`withImages`); Create more keeps it open for the next card; the board stays open; the card goes on top of its column; made from In progress, its agent starts at once) |
| `sound/` | `packs.ts` (samples), `typing.ts` (key listeners: typing sounds everywhere in the app, in the pack on screen, except app shortcuts), `chime.ts` (the notifications' chimes, synthesized, each status's picked in the palette's Sound group (`needsInputSound`, `completedSound`; by default a rising ping for Needs input, an arpeggio for Completed) and heard while highlighted; audio unlocked by the first click or key) |
| `palette/` | `pages.ts` (what the palette offers), `palette.ts` (dialog, preview, shortcuts, a text edit in its input (the agent providers' pages), the grouping page the group button and its keybinding open; Esc on a page returns to the page that opened it, the providers list from a provider) |
| `ui/` | `dom.ts` (`isMac`), `icons.ts` (every icon, as SVG tags), `keyed.ts` (lists by key), `app.ts` (the page shell: the board replaces the workspace — file sidebar, terminals, file pane — and the tab bar keeps only its Board button, the Filter button once the board is onboarded, and Settings; a clicked card (or the open tab, when the board is opened) shows the workspace in a drawer beside the board, and a click on the board's empty space closes it, `drawer=1` in the URL, with its own bar and a divider whose width is the `drawerWidth` setting; the drawer's close is arrow-right-to-line, in front of the file sidebar), `gate.ts` (the connection gate's screens, from `daemon/client.ts`'s `gateMode`), `divider.ts`, `about.ts`, `drop.ts` and `drop-paths.ts`, `no-markup.test.ts` (the guard: no `innerHTML` in the app) |

The page's CSS is in `web/src/styles/app.css`. The page's `<head>` is in
`web/src/pages/app/index.astro`; its body is one mount point, `#app`, and
`main.ts` mounts `ui/app.ts`'s `App()` into it first, so the markup comes from
components.

**Rules**
- **One-way dependencies between features:**
  - `nav` → `daemon` → `settings` → `sound`
  - `nav` → `daemon` → `files` → `links` → `sessions` → `explorer` → `palette` and `ui` → `main`

  A lower feature never imports a higher one:
  - `settings` tells others about changes through `onApply` and `onSaved`;
  - `files/open.ts` gets a `Host` from `main.ts`;
  - `nav` imports no feature: features register their steps with it.

  Inside one folder, modules may import each other, as long as their top
  level doesn't call across.
- **Only the router moves:** only the router changes the active tab, view,
  file, explorer or palette; everything else calls `go()`. Back, Forward and
  reload then walk the same places.
- **Pure logic stays testable:** files that `node --test` loads don't touch
  the DOM when imported: `links.ts`, `files/api.ts`, `daemon/parse.ts`,
  `settings/catalog.ts`, `keys.ts`, `schema.ts`, `sessions/bell-scan.ts`, `sessions/activity.ts`,
  `sessions/labels.ts`, `sessions/order.ts`, `sessions/reconnect.ts`,
  `explorer/listing.ts`, `explorer/changes.ts`, `board/folders.ts`, `ui/drop-paths.ts`, `ui/keyed.ts`, `nav/place.ts`, and `ui/no-markup.test.ts`'s rule (it only reads files). Their tests sit beside them as `*.test.ts`.
- **Components:** a component is a function returning a node, built with
  VanJS tags (`import van from 'vanjs-core'`). A feature owns its
  `van.state`s and the router's steps assign them. States are assigned
  whole (`s.val = next`), never mutated in place. User text goes in as a
  child string or an attribute value, never as markup. Lists go through
  `keyed()`. Code that waits for VanJS to apply a state's DOM update relies
  on VanJS 1.6 doing it in a microtask queued before its own (`store.activate`,
  `board.showBoard`, `files/open.ts`'s layout derive, `pane.applied()`, the
  explorer's `load()`), so `vanjs-core` is pinned to `~1.6.1`. Read states inside binding functions (`() => s.val`), never
  directly in a component body: a direct read renders a value that never
  updates. xterm, CodeMirror and the tree stay in hosts created once.
- **The editor stays lazy:** `files/pane.ts` and `editor.ts` (CodeMirror,
  `marked`) are only reached through `import()`. The daemon test
  `entry_script_does_not_bundle_the_editor` fails if the page's first load
  includes them.
- **The tree stays lazy:** `explorer/view.ts` is the only importer of
  `@pierre/trees`, and `explorer.ts` reaches it through `import()` when the
  sidebar first has a tree to show. The same daemon test fails if the page's
  first load includes the library.
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
    and the token. The only exception is GET or HEAD of a single-segment
    `/_astro/{name}`.
  - Without an Origin, `/api/files*` still needs the token.
- **Token:** it arrives in the URL fragment and is cleared from the address
  bar before any request. Nothing rendered from a file can read it.
- **File previews:**
  - HTML renders in `<iframe sandbox="allow-scripts allow-popups">`.
  - Markdown and SVG render in `<iframe sandbox="">`.
  - Images and PDFs load from `blob:` URLs.
  - File content never goes through `innerHTML`.
- **No markup strings:** no `innerHTML`, `outerHTML` or `insertAdjacentHTML` in
  `web/src/app` (`ui/no-markup.test.ts`).
- **URLs select, never act:** a URL only selects what exists: it never opens
  a tab, runs a command, sets a `cwd` or saves a file. The query string
  holds the place; the router never reads the fragment (the token's), and
  the daemon's app page sends `Referrer-Policy: no-referrer`
  (`local_app_sends_no_referrer`).
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
