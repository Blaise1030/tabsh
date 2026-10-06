# File explorer — Slice Plan

- Spec: `docs/superpowers/specs/2026-10-06-file-explorer-design.md` (approved 2026-10-06)
- Feature branch: `features/file-explorer` (spec + plan committed here; final PR → `main`)
- Base SHA: `2b5b8af` (`origin/main` when `features/file-explorer` was cut)
- Tracker: GitHub Issues, repo `Blaise1030/tabsh` — parent: `<filled in Phase 3>`
- CI checks on PR: `.github/workflows/ci.yml` → `daemon` (fmt, clippy, `cargo test --locked` on ubuntu + macos), `site` (`astro check`, biome, `npm test`, `npm run build` + committed app copy), `e2e` (Playwright chromium)
- E2E: Playwright (`@playwright/test`), specs in `web/e2e/`, run with `cd web && TABSH_BIN=../target/debug/tabsh npm run test:e2e`, conventions doc at `web/e2e/README.md`
- Conventions source: `CLAUDE.md` → `docs/architecture.md` (module layout, route rules, dependency order, pure-logic testability, security invariants); `.agents/skills/trees` (the `@pierre/trees` API); exemplars: `src/files/` (daemon feature), `src/sessions/ws.rs` (WebSocket route), `web/src/app/files/open.ts` (lazy `import()` of a heavy module), `web/src/app/sessions/bell.ts` + `bell-scan.ts` (app feature with pure logic)

**Standing rules for every slice** (from the conventions source, not repeated below):

- Daemon: routes merge in `state::router()` only; add each route to `every_route_is_guarded`; `pub(crate)`/`pub(super)` visibility; tests live in the owning file's `mod tests`.
- App: pure logic in its own file with a `*.test.ts` beside it, importable without touching the DOM; `explorer` sits between `sessions` and `palette` in the one-way dependency order; no inline scripts (CSP); file names never go through `innerHTML`.
- `@pierre/trees` is only reached through `import()`; never imported at the top level of a module the entry script loads.
- e2e: the tree lives in the library's Shadow DOM. Playwright's locators pierce open shadow roots; select rows by role and accessible name (`getByRole('treeitem', { name })`) — Slice 1 confirms the library exposes these and documents the rule in `web/e2e/README.md`.
- Any slice touching `web/` runs `npm run build` in `web/` and commits `src/app.html` + `src/app-assets/`.
- Every slice's PR closes its tracker issue; the chain stays CI-green after each merge.

## Slice 1: walking skeleton — open the sidebar, see the tab's project, click a file to open it

- Issue: `<filled in Phase 3>`
- Depends on: none
- Flow (REQUIRED): In a tab whose shell is inside a git repo, you click the tab bar's explorer button (or press Mod+Shift+E, or pick "Toggle file explorer" in the palette) → a sidebar opens on the left showing the repo root's files and folders, ignored ones left out; you open a folder and click a file → it opens in the file pane. The sidebar's open state and width survive a reload. A tab in `~` (no repo, too many files) shows "Too many files to show here" instead of a tree.
- E2E spec (REQUIRED): `web/e2e/explorer.spec.ts` —
  1. Fixture makes a temp project: `git init`, `README.md`, `src/main.rs`, `.gitignore` with `target/`, `target/junk.txt`, an empty `docs/` folder, a dotfile `.env.example`, and a file named `<img src=x onerror=alert(1)>.txt`.
  2. Open the app; in the active tab type `cd <project>/src` and press Enter.
  3. Click `#explorer-btn` → `#explorer` visible; tree rows `README.md`, `src`, `docs`, `.env.example` visible; no `target` row (rooted at the repo root, not `src/`; ignored skipped).
  4. The malicious name shows as a row whose text is the literal name; no dialog fires (`page.on('dialog')` fails the test) and no `<img>` exists in the tree's shadow root.
  5. Expand `src`, click `main.rs` → `#pane` visible and its header shows `main.rs`.
  6. Drag the explorer divider wider; reload → sidebar still open at the new width (± a few px).
  7. Press Mod+Shift+E → sidebar hidden; reload → still hidden.
  8. Fixture writes 20,001 empty files into a temp dir outside any repo (Node `fs`, a second or so). New tab, `cd` there, sidebar open → "Too many files" message, no tree. (No test-only cap override in the daemon.)
- Unit tests (REQUIRED):
  - Daemon (`src/files/tree.rs`): `tree_root` picks the nearest ancestor holding `.git` (dir or file, for worktrees), else the cwd; `list_tree` respects `.gitignore` (also without git), lists dotfiles, never lists `.git/`, marks directories with a trailing `/`, includes empty directories, returns paths relative to the root, sets `truncated` at the cap and returns no partial list beyond it; route: 200 with JSON for a known session, unknown session falls back to home (like `/api/files`), no Origin and no token → 401, foreign Origin → 403; `every_route_is_guarded` lists `/api/files/tree`.
  - Daemon (`src/web/pages.rs`): `entry_script_does_not_bundle_the_editor` (or a sibling test) also fails if the entry's static import closure contains the tree library (e.g. the `file-tree-container` tag name).
  - App: `web/src/app/explorer/listing.test.ts` — turning the response into the tree's input (truncated → message state, empty root, trailing-`/` directories, absolute path of a row from root + relative path, shell-quoting of paths with spaces, quotes and Unicode for later slices' paste); `settings/schema` tests — `cleanSettings` keeps `explorerOpen` (default `false`) and `explorerWidth` (default and clamped range); `keys` tests — the new `toggleExplorer` binding has a default and no conflict with existing defaults.
- Layers touched:
  - Daemon: `Cargo.toml` (`ignore`), new `src/files/tree.rs` (`tree_root`, `list_tree`, `TREE_LIMIT_PATHS = 20_000`), `src/files/mod.rs` (`GET /api/files/tree` route, `spawn_blocking` walk), `src/state.rs` (`every_route_is_guarded`), `src/web/pages.rs` (bundle test).
  - App: `web/package.json` (`@pierre/trees` exact version, `react`/`react-dom` peers), new `web/src/app/explorer/` — `explorer.ts` (`initExplorer()`: toggle, divider, fetch, active-tab change), `view.ts` (the only importer of `@pierre/trees`; `FileTree` mount, `resetPaths`, click → `openInPane`), `listing.ts` + `listing.test.ts` (pure), `api.ts` (fetch through `daemonFetch`); `web/src/app/main.ts` (`initExplorer()` after sessions); `web/src/app/palette/pages.ts` ("Toggle file explorer"); `web/src/app/settings/keys.ts` (`toggleExplorer`, Mod+Shift+E), `settings/schema.ts` (`explorerOpen`, `explorerWidth`); `web/src/pages/app/index.astro` (`#explorer-btn` in `.tabbar`, `<aside id="explorer" hidden>` + `#explorer-divider` before `#main`); `web/src/styles/app.css` (layout, `--trees-*` mapped from tabsh theme variables); `web/e2e/fixture.ts` (temp project helper) + `web/e2e/README.md` (shadow-DOM selector rule, project fixture); `docs/architecture.md` (`files/tree.rs`, `explorer/` row, dependency order, lazy-tree rule).
- Out of scope for this slice: live updates (Slice 2); re-rooting on `cd`/tab switch while open — this slice fetches on open and on tab switch only, nothing more (Slice 3); row menu actions (Slice 4).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 2: the tree stays current as files change on disk

- Issue: `<filled in Phase 3>`
- Depends on: 1
- Flow (REQUIRED): With the sidebar open, you (or an agent, or `git checkout`) create, delete or rename files and folders in the project → the tree shows the change within about a second, keeping open folders and the selection; a huge change (or a `.gitignore` edit) re-fetches the whole tree; ignored paths never appear.
- E2E spec (REQUIRED): `web/e2e/explorer-live.spec.ts` —
  1. Project fixture from Slice 1; open the app, `cd` into it, open the sidebar, expand `src`.
  2. Type `touch src/new.rs` → row `new.rs` appears under the still-open `src` (assert within 3 s).
  3. `mkdir -p lib/deep && touch lib/deep/x.ts` → `lib` row appears; expand it → `deep` → `x.ts`.
  4. `mv src/new.rs src/renamed.rs` → `new.rs` gone, `renamed.rs` present.
  5. `rm -r lib` → `lib` row gone.
  6. `touch target/ignored.txt` → no `target` row appears.
  7. `echo 'docs/' >> .gitignore` → `docs` row disappears (reset path).
  8. `for i in $(seq 1 1500); do touch bulk$i; done` → `bulk1500` row exists (reset path for a big batch), `src` still expanded.
- Unit tests (REQUIRED):
  - Daemon (`src/files/watch.rs`): coalescing — a burst within 100 ms yields one message; post-window disk check turns create+delete of the same path into nothing, and rename into remove+add; a new directory brings its walked children; ignored and `.git/` paths are dropped; > 1,000 paths → `reset`; `.gitignore` changed → `reset`; backend rescan/overflow flag → `reset`; two sockets on one root share one watcher, which is dropped with the last; a truncated root gets no watcher. Route: upgrade with `?token=` works, without it → 401 (no Origin) / 403 (foreign Origin); `every_route_is_guarded` lists `/api/files/watch`.
  - App: `web/src/app/explorer/changes.test.ts` — a `{add, remove}` message → `FileTree.batch()` operations: adds of paths already present and removes of absent ones are dropped, a removed directory removes its subtree once, adds order parents before children; `{reset}` → re-fetch action.
- Layers touched:
  - Daemon: `Cargo.toml` (`notify`), new `src/files/watch.rs` (shared watcher registry on `AppState` or a `OnceLock`, coalescer as a pure function over `(events, disk lookup)` for testing, WebSocket handler modelled on `src/sessions/ws.rs`), `src/files/mod.rs` (route), `src/files/tree.rs` (reuse the walk's ignore matcher for single paths), `src/state.rs` (route list), `docs/architecture.md` (`files/watch.rs`).
  - App: `web/src/app/explorer/socket.ts` (open/close per active tab, `?token=`, reconnect with backoff like the terminal socket), `changes.ts` + `changes.test.ts` (pure), `view.ts` (`batch`, `resetPaths`).
- Out of scope for this slice: re-rooting when the shell's directory changes (Slice 3); watching while the sidebar is closed (the socket opens only while it is open); git status badges.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 3: the tree follows the shell — `cd` and tab switches re-root it

- Issue: `<filled in Phase 3>`
- Depends on: 2 (the `root` message rides the watch socket)
- Flow (REQUIRED): With the sidebar open, you `cd` from one project into another (or out of any repo) → within about a second the tree re-roots to the new project; switching to a tab in a different project shows that project's tree; `cd` within the same repo changes nothing.
- E2E spec (REQUIRED): `web/e2e/explorer-follow.spec.ts` —
  1. Fixture makes two git projects `alpha` (has `alpha.md`) and `beta` (has `beta.md`).
  2. Tab A: `cd alpha`, open sidebar → `alpha.md` visible.
  3. `cd ../beta` → within 3 s `beta.md` visible, `alpha.md` gone.
  4. `mkdir sub && cd sub` (same repo) → tree unchanged (`beta.md` still visible, no reload flicker: an expanded folder stays expanded).
  5. New tab B: `cd alpha` → `alpha.md`; switch back to tab A → `beta.md`.
  6. In tab A, `touch beta-2.md` → appears (the socket moved with the root and still watches).
- Unit tests (REQUIRED): daemon `src/files/watch.rs` — the root check emits `{"root": …}` only when `tree_root(cwd)` changes (not on every `cd`), moves the socket to the new root's watcher and releases the old one; a closed session ends the socket. App `changes.test.ts` (or `explorer` pure state) — a `root` message triggers one re-fetch and discards batches queued for the old root.
- Layers touched: `src/files/watch.rs` (1 s root check per socket, root swap), `web/src/app/explorer/socket.ts` + `explorer.ts` (handle `root`, re-fetch, header shows the root's name).
- Out of scope for this slice: following a tab's root while the sidebar is closed; any `cd` performed by the explorer itself (Slice 4).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 4: act on a row — insert its path, `cd` there, open a tab there

- Issue: `<filled in Phase 3>`
- Depends on: 1 (independent of 2 and 3 — can run in parallel with them)
- Flow (REQUIRED): You right-click a row (or use its menu button) → **Insert path** pastes the shell-quoted absolute path at the prompt; on a folder, **cd here** pastes `cd -- '<dir>'` for you to confirm with Enter; **Open in new tab** opens a terminal in that folder (a file's parent folder).
- E2E spec (REQUIRED): `web/e2e/explorer-actions.spec.ts` —
  1. Project fixture with `my file's notes.md` and folder `src/`; open sidebar.
  2. Type `test -f ` (no Enter). Right-click `my file's notes.md` → menu shows the three items; pick **Insert path**. Type ` && printf '\033]0;ok\007'` and press Enter → tab label `ok`, proving the pasted path was quoted correctly and exists.
  3. Right-click `src` → **cd here** → press Enter → `printf '\033]0;%s\007' "$(basename "$PWD")"` → tab label `src`.
  4. Right-click `src` → **Open in new tab** → a new tab is active; in it the same `basename $PWD` title trick → `src`.
  5. Keyboard: focus a row, open its menu with the keyboard (library's trigger), Escape closes it and focus returns to the row.
- Unit tests (REQUIRED): `listing.test.ts` (from Slice 1) — shell quoting covers spaces, `'`, `$`, backticks, newlines in names, Unicode; `cd` command built with `--`; a file's "open in new tab" target is its parent directory.
- Layers touched: `web/src/app/explorer/view.ts` (`composition.contextMenu`: `render` builds the menu with `el()`/`textContent`), `explorer.ts` (paste into the active session's `term.paste()`, `newTabAt()` from `sessions/store.ts`), `listing.ts` (quoting helpers), `web/src/styles/app.css` (menu matches the palette's look).
- Out of scope for this slice: pressing Enter for `cd` automatically (the front program may not be the shell); file operations (rename/delete/create/move); drag from the tree onto the terminal.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Phase 5 (after all slices merge): regression + finalization

1. Pull `features/file-explorer`; run everything CI runs locally: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`, and in `web/`: `npm run check && npm run lint && npm test && npm run build && npm run test:e2e`.
2. Audit `2b5b8af..features/file-explorer` against `docs/architecture.md` and neighbouring modules, including cross-slice seams: the walk's ignore rules shared between `tree.rs` and `watch.rs` (one matcher, not two), path/quoting helpers duplicated between `explorer/` and `ui/drop.ts`, the bundle test still guarding both lazy modules, the architecture doc matching what merged.
3. Numbered findings (`file:line`, convention broken, code to match, fix size) → shown for a pick, or all fixed in one finalization PR if pre-authorised; regression suite must stay green. Then the final PR `features/file-explorer` → `main`; close the parent issue when it merges.
