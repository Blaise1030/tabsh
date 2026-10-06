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
| `main.rs` | Startup only: environment, database path, `AppState`, flusher thread, bind, shutdown |
| `state.rs` | `AppState`, and `router()`, which merges every feature's routes under the guard |
| `error.rs` | `BoxError`, `internal_error` |
| `auth.rs` | The pairing token: load or create it, compare it, read it from a request |
| `web/guard.rs` | The one access check: Host, Origin and token |
| `web/pages.rs` | The pages (`/`, `/open`, `/app/`), the CSP, `/api/about` |
| `web/assets.rs` | Embedded typing sounds and app bundle (`/sounds/…`, `/_astro/…`) |
| `sessions/` | Shells in PTYs that outlive browser tabs: `store.rs` (SQLite), `pty.rs` (spawn, cwd), `ws.rs` (attach), `modes.rs` (terminal modes for replay) |
| `files/` | The file pane's and the explorer's API: `resolve.rs`, `kind.rs`, `read.rs`, `save.rs`, `tree.rs` (a tab's project root, and its listing, capped at `TREE_LIMIT_PATHS`), `watch.rs` (`/api/files/watch`: one `notify` watcher per root shared by its sockets, events coalesced over 100 ms and checked on disk, sent as `{add, remove}` or `{reset}`; a socket also checks its tab's project root every second and sends `{root}` when it changes, moving to the new root's watcher) |
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
| `daemon/` | `config.ts` (which daemon), `token.ts` and `parse.ts` (pairing), `client.ts` (`daemonFetch`, `api`, the connection gate) |
| `settings/` | `catalog.ts` (themes, fonts, sounds), `keys.ts` (keybindings), `schema.ts` (`Settings`, cleanup), `settings.ts` (current values, apply, save, `onApply` and `onSaved`) |
| `sessions/` | `store.ts` (tabs, active tab, sync), `terminal.ts` (xterm, socket), `tabs.ts` (tab strip), `bell.ts` and `bell-scan.ts` |
| `links/` | `links.ts` (finding URLs and paths), `provider.ts` (xterm link provider) |
| `files/` | `api.ts` (file API client), `open.ts` (loads the pane on first use, reopens files after a reload), `remember.ts` (each tab's file, in `localStorage`), `pane.ts` and `editor.ts` (pane and CodeMirror) |
| `explorer/` | `explorer.ts` (the sidebar: toggle, divider, fetch on open and on tab switch), `view.ts` (the tree, drawn by `@pierre/trees`), `listing.ts` (the listing as what the sidebar shows, row paths, pasted paths), `api.ts` (the listing request), `socket.ts` (the live socket, open while the sidebar is, reconnecting), `changes.ts` (a live message as tree operations, or a re-fetch for a new root) |
| `sound/` | `packs.ts` (samples), `typing.ts` (key listeners) |
| `palette/` | `pages.ts` (what the palette offers), `palette.ts` (dialog, preview, shortcuts) |
| `ui/` | `dom.ts` (`el`, `isMac`), `divider.ts`, `about.ts`, `drop.ts` and `drop-paths.ts` |

The page's CSS is in `web/src/styles/app.css`. The markup is in
`web/src/pages/app/index.astro`.

**Rules**
- **One-way dependencies between features:**
  - `daemon` → `settings` → `sound`
  - `daemon` → `files` → `links` → `sessions` → `explorer` → `palette` and `ui` → `main`

  A lower feature never imports a higher one:
  - `settings` tells others about changes through `onApply` and `onSaved`;
  - `files/open.ts` gets a `Host` from `main.ts`.

  Inside one folder, modules may import each other, as long as their top
  level doesn't call across.
- **Pure logic stays testable:** files that `node --test` loads don't touch
  the DOM when imported: `links.ts`, `files/api.ts`, `daemon/parse.ts`,
  `settings/catalog.ts`, `keys.ts`, `schema.ts`, `sessions/bell-scan.ts`,
  `explorer/listing.ts`, `explorer/changes.ts`, `ui/drop-paths.ts`. Their tests sit beside them as `*.test.ts`.
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
