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
| `sessions/` | Shells in PTYs that outlive browser tabs: `store.rs` (SQLite, and the tab order set by `PUT /api/sessions/order`), `pty.rs` (spawn, cwd), `ws.rs` (attach), `modes.rs` (terminal modes for replay); shells get `TABSH_SESSION_ID` and `TABSH_URL` (`pty::shell_env`) and type a card's short pending launch line once it runs and the card is In progress (`sessions::launch` types it into a running shell); its first prompt rides in `TABSH_PROMPT` in that shell's environment; a card created with a name (or renamed by the user) is `pinned`, so shell titles don't replace it |
| `files/` | The file pane's and the explorer's API: `resolve.rs`, `kind.rs`, `read.rs`, `save.rs`, `tree.rs` (a tab's project root, served alone at `/api/files/root` for the tab strip's labels, and its listing, capped at `TREE_LIMIT_PATHS`: past it, the sidebar gets its folders alone from the same walk, within the same cap and a scan budget of `FOLDER_SCAN_FACTOR` times it), `watch.rs` (`/api/files/watch`: one `notify` watcher per root shared by its sockets, events coalesced over 100 ms and checked on disk, sent as `{add, remove}` or `{reset}`; a socket also checks its tab's project root every second and sends `{root}` when it changes, moving to the new root's watcher) |
| `board/` | The kanban board: card status columns and their migration (`mod.rs`), `PATCH /api/sessions/{id}/status` and `launch_line` (the short line typed for a new card: the agent command with `"$TABSH_PROMPT"` for `{prompt}`, control characters dropped; the prompt itself is stored in `pending_prompt` and passed in the environment, since a PTY line is cut at 1024 bytes on macOS), `rules.rs` (hooks never touch archived cards; `unless`; a new card waits in Backlog and only a drag to In progress, `launches`, starts its agent), `events.rs` (`/api/board/events`: status changes pushed to pages) |
| `cli/` | Subcommands on the same binary: `status.rs` (`tabsh status`, a one-shot loopback PATCH; `--hook` is silent, always exits 0, never reads a terminal's stdin, and accepts one trailing JSON payload argument whose `message` is the note), `setup.rs` and `setup.md` (`tabsh setup`: the guide an agent follows to wire its own hooks to `tabsh status`; tabsh never edits agent config) |
| `settings.rs` | `/api/settings`: the page's preferences as one JSON object |
| `upload.rs` | `/api/uploads`: files dropped onto a terminal |
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
| `nav/` | `place.ts` (the place: tab, view, file, line, explorer, palette, and its query string; pure), `router.ts` (the one `navigate` handler, on the Navigation API: `go`, `here`, `onPlace` (each feature's step, run in the order tab → view → file → explorer → palette), `onLeave`, `startRouter`, `back`, `forward`, `backPastPalette`, `isPaletteEntry`, `isLeavingPalette`; the Back and Forward keybindings (`keyBack`, `keyForward`) and the palette's "Go back" live in `palette/palette.ts` and call them) |
| `daemon/` | `config.ts` (which daemon), `token.ts` and `parse.ts` (pairing), `client.ts` (`daemonFetch`, `api`, the connection gate) |
| `settings/` | `catalog.ts` (themes, fonts, sounds), `keys.ts` (keybindings), `schema.ts` (`Settings`, cleanup), `settings.ts` (current values, apply, save, `onApply` and `onSaved`) |
| `sessions/` | `store.ts` (tabs and the active tab as states, sync), `terminal.ts` (xterm, socket), `tab.ts` (a tab, drawn from its session's states), `tabs.ts` (tab strip, dragging tabs into order), `order.ts` (where a dragged tab lands), `tags.ts` (each tab's repo and tags, the tag menu), `groups.ts` (`TabStrip`, the strip drawn from state: grouping it by repo or tag, labels, collapsing, copies of multi-tag tabs; archived cards' tabs kept out of the strip and its groups), `labels.ts` (their pure logic), `bell.ts` and `bell-scan.ts` |
| `links/` | `links.ts` (finding URLs and paths), `provider.ts` (xterm link provider) |
| `files/` | `api.ts` (file API client), `open.ts` (the file step and its unsaved-edits guard: the place's file is the active tab's, by the absolute path the daemon resolved; loads the pane on first use, reopens the other tabs' files after a reload), `remember.ts` (each tab's file, in `localStorage`), `pane.ts` and `editor.ts` (pane and CodeMirror) |
| `explorer/` | `explorer.ts` (the sidebar: toggle, divider, fetch on open and on tab switch, `/`, "Search files" and its keybinding opening the search), `view.ts` (the tree, its search and its row menu, drawn by `@pierre/trees`), `listing.ts` (the listing as what the sidebar shows, row paths, pasted paths and `cd` commands, a row menu's entries, whether a key opens the search), `api.ts` (the listing request), `socket.ts` (the live socket, open while the sidebar is, reconnecting), `changes.ts` (a live message as tree operations, or a re-fetch for a new root) |
| `board/` | `model.ts` (statuses, columns, grouping, drop order, no DOM), `glyph.ts`, `status.ts` (a tab's card: glyph, archived tabs hidden (re-laying out the strip), bell on needs input), `events.ts` (the board events socket), `view.ts` (the board, drag and drop incl. onto Archive, an Archive button on Completed cards, ⌘B; until the `boardOnboarded` setting is true, a setup screen instead of columns, whose button opens a Claude Code card that runs `tabsh setup`), `new-card.ts` (the New card dialog, with recent agent commands; the board stays open) |
| `sound/` | `packs.ts` (samples), `typing.ts` (key listeners) |
| `palette/` | `pages.ts` (what the palette offers), `palette.ts` (dialog, preview, shortcuts, the grouping page the group button and its keybinding open) |
| `ui/` | `dom.ts` (`el`, `isMac`), `icons.ts` (every icon, as SVG tags), `keyed.ts` (lists by key), `app.ts` (the page shell), `gate.ts` (the connection gate's screens, from `daemon/client.ts`'s `gateMode`), `divider.ts`, `about.ts`, `drop.ts` and `drop-paths.ts` |

The page's CSS is in `web/src/styles/app.css`. `web/src/pages/app/index.astro`'s
body is one mount point, `#app`; `main.ts` mounts `ui/app.ts`'s `App()` into it
first, so the markup comes from components.

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
  `settings/catalog.ts`, `keys.ts`, `schema.ts`, `sessions/bell-scan.ts`,
  `sessions/labels.ts`, `sessions/order.ts`,
  `explorer/listing.ts`, `explorer/changes.ts`, `ui/drop-paths.ts`, `ui/keyed.ts`, `nav/place.ts`. Their tests sit beside them as `*.test.ts`.
- **Components:** a component is a function returning a node, built with
  VanJS tags (`import van from 'vanjs-core'`). A feature owns its
  `van.state`s and the router's steps assign them. States are assigned
  whole (`s.val = next`), never mutated in place. User text goes in as a
  child string or an attribute value, never as markup. Lists go through
  `keyed()`. Read states inside binding functions (`() => s.val`), never
  directly in a component body: a direct read renders a value that never
  updates, and inside `keyed`'s render it also subscribes the list derive
  once. xterm, CodeMirror and the tree stay in hosts created once.
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
