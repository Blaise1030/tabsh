# Module Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the daemon's single `src/main.rs` and the app page's
1,000-line inline script into feature modules, with type, lint and format
gates on the web side, without changing behaviour.

**Architecture:** The daemon becomes one crate with a folder per feature
(`web/`, `sessions/`, `files/`, plus `auth`, `settings`, `upload`). Each
feature exposes `routes()`, and `state::router()` combines them under the
`guard`. The inline script first becomes one bundled module, `app/main.ts`,
with no inline code left, so the CSP can drop `'unsafe-inline'` from
`script-src`. Typed feature folders are then carved out of that module
until `main.ts` only handles startup.

**Tech Stack:** Rust 2024, axum 0.8, rusqlite; Astro 7, TypeScript (strict),
Biome 2, `node --test`, xterm.js 5.5 (CDN global), CodeMirror 6.

**Spec:** `docs/superpowers/specs/2026-10-04-module-architecture-design.md`

## Global Constraints

- Behaviour stays the same. URLs, status codes, headers, UI, and stored
  settings and sessions are unchanged.
- The `guard` wraps every route. The token is never readable from anything
  rendered from a file. Iframe sandboxes are unchanged. No `innerHTML` with
  file content.
- `web/public/_headers` and `APP_CSP` change together.
- `cargo install --git` builds without npm. `src/app.html` and
  `src/app-assets/` are rebuilt (`cd web && npm run build`) and committed in
  every commit that changes the app.
- After every commit, these all pass:
  - `cargo fmt --check`
  - `cargo clippy --all-targets --locked -- -D warnings`
  - `cargo test --locked`
  - in `web/`: `npm run check && npm run lint && npm test && npm run build`,
    once Task 1 adds those scripts.
- **Rust visibility:** nothing is `pub` beyond the crate. Use
  `pub(crate)`, or `pub(super)` inside a feature folder. A feature uses
  another only through its `pub(crate)` items.
- **Web dependencies:**
  - xterm, the fit addon and Basecoat stay as the SRI-pinned CDN `<script>`
    tags.
  - `@xterm/xterm@5.5.0` and `@xterm/addon-fit@0.10.0` are dev dependencies,
    used only through `import type`.
  - The files that hold the pure logic don't touch the DOM or `document`
    when imported, so `node --test` can load them: `links/links.ts`,
    `files/api.ts`, `settings/keys.ts`, `settings/schema.ts`,
    `settings/catalog.ts`, `sessions/bell-scan.ts`, `daemon/parse.ts`
    and `ui/drop-paths.ts`.
- **Cross-feature imports go one way only:**
  `daemon` → `settings` → `sound`; `daemon` → `files` → `links` →
  `sessions` → `palette`/`ui` → `main`.
  - `files/open.ts` never imports `sessions`. It receives a `Host` from
    `main.ts`.
  - `settings` never imports `sessions`, `files` or `palette`. It notifies
    them through `onApply`, `onSaved` and `setPreviewing`.
  - Import cycles inside one feature folder are allowed only between
    modules whose top level doesn't call into each other.
- `files/pane.ts` and `files/editor.ts` (CodeMirror, `marked`) are reached
  only through a dynamic `import()`.
- Commit messages follow the repo's style (`refactor(daemon): …`,
  `refactor(app): …`, `chore(web): …`) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never `git add` these untracked files: `.DS_Store`, `.agents/`,
  `skills-lock.json`, `docs/superpowers/plans/2026-10-03-security-hardening.md`.

## Review Focus

1. **Startup order.** After the token is adopted, the URL fragment is
   cleared with `history.replaceState`, and the Safari redirect
   (`MIXED_BLOCKED && launched` → `location.replace(LOCAL_APP)`) happens
   before any daemon request. Token parsing is pinned by `daemon/parse.test.ts` (Task 9), and the order by
   the manual pass (Task 12).
2. **Settings preview.** Closing the palette without picking puts back the
   saved settings. A `loadSettings()` that arrives on window focus while
   the palette is open must not overwrite the preview. Pinned by
   `settings/schema.test.ts` for the cleanup, and by the `setPreviewing`
   behaviour checked in Task 9's steps.
3. **The editor stays lazy.** First load must not fetch CodeMirror. Pinned
   by the Rust test `entry_script_does_not_bundle_the_editor` (Task 10).
4. **Unsaved edits.** Closing a tab, opening another file, or reloading
   with unsaved edits still asks first (`confirmDiscard`, `hasUnsaved` in
   `beforeunload`). Manual pass, Task 12.
5. **No inline code under the tightened CSP.** No `<script>` without `src`,
   and no `on*=` attribute. Pinned by the Rust test
   `app_page_has_no_inline_code` (Task 8).

---

### Task 1: Web quality gates

**Files:**
- Create: `web/biome.json`
- Modify: `web/package.json`, `.github/workflows/ci.yml` (the Site job), and every `web/src/**/*.ts` file (format only)

**Interfaces:**
- Produces: the `npm run check`, `npm run lint` and `npm test` scripts that later tasks run.

- [ ] **Step 1: Add the dev dependencies.** Run:
  `npm i -D @biomejs/biome@2.5.15 @astrojs/check@0.9.10 typescript @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0`
  in `web/`.
- [ ] **Step 2: Add the scripts to `web/package.json`.**
  - `"check": "astro check"`
  - `"lint": "biome ci ."`
  - `"format": "biome format --write ."`
  - Change `"test"` to `node --test "src/**/*.test.ts"`.
- [ ] **Step 3: Write `web/biome.json`.**
  - **Formatter:** `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 120`.
  - **JavaScript:** `quoteStyle: "single"`, `semicolons: "always"`,
    `trailingCommas: "all"`, `arrowParentheses: "always"`.
  - **Linter:** recommended rules.
  - **Files:** include only `src/**/*.ts`, `*.mjs` and `*.json`. That
    leaves out `.astro` files, `dist/`, `.astro/`, `public/` and
    `package-lock.json`.

  To keep the existing idiom, you may turn individual recommended rules off
  in `biome.json`. Each needs a `//`-style reason in a sibling
  `"$comment"` key or in the commit message. Don't turn off whole groups,
  and don't turn off any rule in the `correctness` or `suspicious` groups.
- [ ] **Step 4: Run `npm run format`, then `npm run lint`.** Expected: lint
  passes. Fix real findings in code; don't change behaviour.
- [ ] **Step 5: Run `npm run check`.** Expected:
  `0 errors`. Fix type errors in `src/app/*.ts` without changing
  behaviour. The `is:inline` script isn't type-checked.
- [ ] **Step 6: Wire CI.** In the Site job, after `npm ci`, run
  `npm run check`, `npm run lint` and `npm test`, in that order.
- [ ] **Step 7: Verify.** Run `npm test && npm run build` in `web/`.
  Expected: 19 tests pass, and the build leaves `git diff --stat src/app.html
  src/app-assets` empty or format-only.
- [ ] **Step 8: Commit in two parts.**
  - `chore(web): add type, lint and format checks`, with the config,
    `package.json`, the lock file and CI.
  - `style(web): apply biome formatting`, with the formatting changes only.

### Task 2: Daemon router function and route-table test

**Files:**
- Modify: `src/main.rs`, `Cargo.toml` (`[dev-dependencies]`)

**Interfaces:**
- Produces: `fn router(state: AppState) -> Router` in `src/main.rs`, returning the full app with the `guard` layer and state applied. It moves to `state.rs` in Task 5.
- Produces: `fn test_state() -> AppState` in `mod tests`. It uses `open_db(":memory:")`, token `"t0k3n"`, origins `["https://tabsh.cc"]` and `app_url: None`.

- [ ] **Step 1: Move the router.** Take the `Router::new()…with_state(state.clone())`
  chain out of `main()` into `router(state)`. `main()` calls
  `router(state.clone())`.
- [ ] **Step 2: Add the dev dependency.** In `Cargo.toml`:
  `[dev-dependencies] tower = { version = "0.5", features = ["util"] }`,
  which is already in `Cargo.lock` through axum. Use
  `tower::ServiceExt::oneshot`.
- [ ] **Step 3: Write `#[tokio::test] async fn every_route_is_guarded()`.**
  Send each request to `router(test_state())` with `Host: 127.0.0.1:7681`.
  - **Origin `https://tabsh.cc`, no token → 401.** Covers each of these:
    - `GET /`, `GET /open`, `GET /app`, `GET /app/`;
    - `GET /sounds/mx-blue/press_key1.mp3`;
    - `GET /api/sessions`, `POST /api/sessions`;
    - `PATCH /api/sessions/x`, `DELETE /api/sessions/x`;
    - `GET /api/settings`, `PUT /api/settings`, `GET /api/about`;
    - `POST /api/uploads?name=a`;
    - `GET /api/files?session=x&path=a`, `HEAD /api/files?session=x&path=a`,
      `PUT /api/files`, `GET /api/files/raw?path=/a`;
    - `GET /ws?id=x`;
    - `GET /nope`.
  - **Origin `https://tabsh.cc`, no token, public asset → 200.** For
    `GET /_astro/<the first name in APP_ASSETS>`.
  - **No Origin, no token → 401.** For
    `GET /api/files?session=x&path=a` and `GET /api/files/raw?path=/a`.
  - **Foreign Origin → 403.** `Origin: https://evil.example` on
    `GET /api/sessions`.
  - **Non-address Host → 403.** `Host: evil.example` on
    `GET /api/sessions`.
  - **Unrouted path → 404.** `GET /nope` with `Origin: https://tabsh.cc`
    and `Authorization: Bearer t0k3n`.

  Put the 401 cases in a table (`&[(Method, &str)]`), with the request in
  the assertion message.
- [ ] **Step 4: Run `cargo test every_route_is_guarded`.** Expected: PASS
  against today's routes. This test pins the current behaviour; it isn't
  driving a change. If any row fails, the row is wrong. Fix the row, not
  the guard.
- [ ] **Step 5: Run the full Rust gate**, then commit:
  `test(daemon): pin every route behind the guard`.

### Task 3: Daemon `error`, `auth` and `web/`

**Files:**
- Create: `src/error.rs`, `src/auth.rs`, `src/web/mod.rs`, `src/web/guard.rs`, `src/web/pages.rs`, `src/web/assets.rs`
- Modify: `src/main.rs`

**Interfaces:**
- `error.rs`: `pub(crate) type BoxError`, `pub(crate) fn internal_error(e: impl Display) -> StatusCode`.
- `auth.rs`: `pub(crate) fn load_or_create_token(path: &Path) -> io::Result<String>`, `random_hex(len) -> io::Result<String>`, `token_eq(a, b) -> bool`, `presented_token(req: &Request) -> Option<&str>`.
- `web/guard.rs`: `pub(crate) async fn guard(...)`, `pub(crate) const HOSTED_ORIGINS`, `pub(crate) const LOCAL_NAME`. `admits_without_origin`, `is_public_asset` and `host_is_address` are private, with their tests.
- `web/pages.rs`: `pub(crate) fn open_browser(url: &str)`, the handlers `open_app`, `open_local_app`, `local_app` and `about`, and `APP_HTML`, `APP_PAGE`, `HOSTED_DAEMON_META` and `APP_CSP`.
- `web/assets.rs`: the `SOUNDS` and `APP_ASSETS` `include!`s, and the handlers `sound` and `app_asset`.
- `web/mod.rs`: `pub(crate) fn routes() -> Router<AppState>`, covering `/`, `/open`, `/app`, `/app/`, `/sounds/{*path}`, `/_astro/{name}` and `/api/about`.

- [ ] **Step 1: Move `error.rs` and `auth.rs`.** Move the items as listed.
  `main.rs` gets `mod error; mod auth;`. Commit:
  `refactor(daemon): move errors and the token into modules`.
- [ ] **Step 2: Move `web/`.** `router()` merges `web::routes()` in place of
  those seven `.route` calls. The tests `local_app_points_at_its_own_origin`,
  `host_must_be_local_or_an_address`, `app_page_scripts_are_embedded`,
  `only_astro_assets_skip_the_token`, `file_api_needs_the_token_without_origin`
  and `typing_sounds_are_embedded` move into the `mod tests` of the file
  that owns the item they test.
- [ ] **Step 3: Run the full Rust gate.** Expected: 21 tests pass,
  including `every_route_is_guarded`. Commit:
  `refactor(daemon): move pages, assets and the guard into web/`.

### Task 4: Daemon `sessions/`

**Files:**
- Create: `src/sessions/mod.rs`, `store.rs`, `pty.rs`, `modes.rs`, `ws.rs`
- Modify: `src/main.rs`, `src/web/pages.rs` (`about` reads the counts through `sessions`)

**Interfaces:**
- `sessions/mod.rs`: `pub(crate) struct Session`, `Output`, `Event`, `SessionInfo`, `Rename`, `NewSession`, `SCROLLBACK_BYTES` and `FLUSH_INTERVAL`, plus `pub(crate) fn routes() -> Router<AppState>`. The routes are `/api/sessions` (GET, POST), `/api/sessions/{id}` (PATCH, DELETE) and `/ws`.
- `pub(crate) fn cwd(st: &AppState, id: &str) -> Option<PathBuf>` returns the live `process_cwd(pid)`, falling back to the `sessions.cwd` column. Behaviour is identical to the first half of today's `session_base_dir`.
- `pub(crate) fn counts(st: &AppState) -> Result<(usize, i64), rusqlite::Error>` returns (running, total), for `about`.
- `store.rs`: `pub(crate) fn open_db(path: &str)`, `insert_session`, `pub(crate) fn flush(state: &AppState)`.
- `pty.rs`: `spawn_session`, `get_or_spawn`, `process_cwd` (three `cfg` variants), and `pub(crate) static SHUTTING_DOWN`.
- `modes.rs`: `ModeTracker`, `ScanState`, `RESTORE_MARKER`, `TRACKED_MODES`, with `mode_tracker_follows_split_sequences`.
- `ws.rs`: `ws_handler`, `attach`.
- `new_session_can_start_in_a_directory` moves into `store.rs`.

- [ ] **Step 1: Move the items.** Add `mod sessions;` to `main.rs`.
  `main()` uses `sessions::store::{open_db, flush}`,
  `sessions::FLUSH_INTERVAL` and `sessions::pty::SHUTTING_DOWN`, re-exported
  from `sessions/mod.rs` as `pub(crate) use`.
- [ ] **Step 2: Add a test,
  `#[test] fn cwd_falls_back_to_the_saved_column()`, in `sessions/mod.rs`.**
  Use `test_state()` from Task 2; move that helper to a
  `#[cfg(test)] pub(crate) mod test_support` in `main.rs`. Insert a session
  with `cwd = "/tmp"` that isn't running, and assert
  `cwd(&st, &id) == Some("/tmp".into())`. Also assert `cwd(&st, "missing")`
  is `None`.
- [ ] **Step 3: Run the full Rust gate.** Expected: all tests pass. Commit:
  `refactor(daemon): move shells, scrollback and sockets into sessions/`.

### Task 5: Daemon `files/`, `settings`, `upload`, `state`, and a slim `main.rs`

**Files:**
- Create: `src/files/mod.rs`, `resolve.rs`, `kind.rs`, `read.rs`, `save.rs`, `src/settings.rs`, `src/upload.rs`, `src/state.rs`
- Modify: `src/main.rs`

**Interfaces:**
- `files/mod.rs`: `pub(crate) fn routes()`, covering `/api/files` (GET; PUT with `DefaultBodyLimit::max(4 * TEXT_LIMIT_BYTES as usize)`) and `/api/files/raw`. Also `FileQuery` and `SaveFile`, and the handlers `file_info`, `file_raw` and `save`.
- `files/resolve.rs`: `resolve_path`, and `session_base_dir(st, id) -> PathBuf`, which is `sessions::cwd(st, id)`, else `$HOME`, else `/`.
- `files/kind.rs`: `FileKind`, `file_kind`, `IMAGE_EXTS`, `raw_content_type`.
- `files/read.rs`: `FileInfo`, `read_file_info`, `open_regular`, `not_a_regular_file`, `version_of`, `detect_eol`, `file_error`, `TEXT_LIMIT_BYTES`, `RAW_LIMIT_BYTES`.
- `files/save.rs`: `save_file`, `create_temp`, `SaveError`.
- `settings.rs`: `routes()` for `/api/settings` (GET, PUT).
- `upload.rs`: `routes()` for `/api/uploads` (POST, with the `UPLOAD_LIMIT_BYTES` body limit), plus `UploadQuery`.
- `state.rs`: `pub(crate) struct AppState`, and `pub(crate) fn router(state: AppState) -> Router`, which merges `web`, `sessions`, `files`, `settings` and `upload` routes, then `.layer(guard)`, then `.with_state`.
- The file tests move with their items. `scratch()` goes into `files/mod.rs`'s tests as `pub(super)`, or into `test_support`.

- [ ] **Step 1: Move `files/`.** Commit:
  `refactor(daemon): move the file API into files/`.
- [ ] **Step 2: Move `settings.rs`, `upload.rs` and `state.rs`.** `main.rs`
  keeps only the following, and comes out under 130 lines:
  - its `mod` lines;
  - `#[tokio::main] async fn main()`: reading the environment, migrating
    the database path, building `AppState`, the flusher thread, binding,
    printing the URLs, `open_browser`, and the select on `shutdown_signal`;
  - `shutdown_signal`;
  - `test_support`.
- [ ] **Step 3: Check the result.**
  - `grep -n 'pub fn\|pub struct\|pub const' src -r` prints nothing. Every
    item uses `pub(crate)` or narrower.
  - `wc -l src/main.rs` is under 130.
- [ ] **Step 4: Run the full Rust gate.** Expected: all tests pass, with the
  same count as after Task 4. Commit:
  `refactor(daemon): settings, uploads and a router in their own modules`.

### Task 6: Existing app modules into feature folders

**Files:**
- Move (`git mv`):
  - `web/src/app/links.ts` and `links.test.ts` → `web/src/app/links/`
  - `files.ts` → `files/api.ts`, `files.test.ts` → `files/api.test.ts`
  - `editor.ts` → `files/editor.ts`, `file-pane.ts` → `files/pane.ts`
- Create: `web/src/app/globals.d.ts`
- Modify: the import paths in the moved files, and the module `<script>` in `web/src/pages/app/index.astro`

**Interfaces:**
- `globals.d.ts` declares the CDN globals:
  `declare const Terminal: typeof import('@xterm/xterm').Terminal;`
  and `declare const FitAddon: { FitAddon: typeof import('@xterm/addon-fit').FitAddon };`

- [ ] **Step 1: Move the files and fix the imports.** The `window.tabsh*`
  hooks keep working; only their `import()` paths change.
- [ ] **Step 2: Run the gates.** Run `npm run check && npm run lint && npm
  test && npm run build` in `web/`, then `cargo test`. Expected: 19 web
  tests pass, and `app_page_scripts_are_embedded` passes with the rebuilt
  assets.
- [ ] **Step 3: Commit** `refactor(app): group the app's modules by feature`.

### Task 7: The inline script becomes one bundled module

**Files:**
- Create: `web/src/app/main.ts`
- Modify: `web/src/pages/app/index.astro`, `src/app.html`, `src/app-assets/*`

**Interfaces:**
- `main.ts` takes the body of the `<script is:inline>`, verbatim apart from
  the changes listed here. It is the page's only script:
  `<script>import '../../app/main.ts';</script>`, which Astro bundles.
- In place of the `window.tabsh*` hooks, `main.ts` uses
  `import('./files/pane.ts')` and `import('./files/api.ts')` directly. It
  imports `findLinks` from `./links/links.ts` statically; that module is
  small and pure.

- [ ] **Step 1: Create `main.ts`.**
  - The first lines are `// @ts-nocheck` and
    `// biome-ignore-all lint: moved verbatim; typed and split up in Tasks 9 to 11`.
  - Paste the inline script's body.
  - Replace the three `window.tabsh*()` calls as described above.
  - Delete the inline script and the hooks script from `index.astro`.
- [ ] **Step 2: Move the inline handlers.** Remove the three `onclick="…"`
  attributes from the markup:
  - the `#palette` dialog's backdrop close;
  - the `#about` dialog's backdrop close;
  - the About Close button.

  Add the same behaviour in `main.ts` with `addEventListener`: the dialog
  closes when `event.target === dialog`, and the button closes its
  `closest('dialog')`.
- [ ] **Step 3: Check the module still runs in strict mode.** Module code
  is strict, so look for implicit globals and assignments to undeclared
  names. `npm run build` must succeed, and so must a browser load with the
  dev server.
- [ ] **Step 4: Verify.** Run all the web gates and `cargo test`. Then
  check the page:
  - `grep -c '<script>' src/app.html` prints `0`;
  - `grep -o '<script type="module" src="/_astro/[^"]*"' src/app.html`
    prints exactly one line.
- [ ] **Step 5: Commit**
  `refactor(app): run the app script as a bundled module`.

### Task 8: Tighten the CSP

**Files:**
- Modify: `web/public/_headers`, `src/web/pages.rs` (`APP_CSP`, tests), `src/app.html`, `src/app-assets/*`

- [ ] **Step 1: Write the failing tests in `src/web/pages.rs`.**

```rust
#[test]
fn app_page_has_no_inline_code() {
    for tag in APP_HTML.split("<script").skip(1) {
        let open = tag.split('>').next().unwrap();
        assert!(open.contains("src="), "inline script: <script{open}>");
    }
    for attr in [" onclick=", " onload=", " onerror=", " onsubmit=", " oninput=", " onkeydown="] {
        assert!(!APP_HTML.contains(attr), "inline handler {attr}");
    }
}

#[test]
fn csp_has_no_inline_scripts_and_matches_the_hosted_policy() {
    let hosted = include_str!("../../web/public/_headers");
    let directive = |csp: &str, name: &str| {
        csp.split(';').map(str::trim).find(|d| d.starts_with(name)).map(str::to_owned)
    };
    let hosted_csp = hosted.lines().find_map(|l| l.trim().strip_prefix("Content-Security-Policy: ")).unwrap();
    for name in ["script-src", "style-src", "img-src", "frame-src", "default-src"] {
        assert_eq!(directive(APP_CSP, name), directive(hosted_csp, name), "{name}");
    }
    assert!(!directive(APP_CSP, "script-src").unwrap().contains("'unsafe-inline'"));
    assert!(directive(APP_CSP, "style-src").unwrap().contains("'self'"));
}
```

- [ ] **Step 2: Run `cargo test csp_`.** Expected: FAIL on `'unsafe-inline'`.
- [ ] **Step 3: Change both policies.**
  - `script-src` becomes `'self' https://cdn.jsdelivr.net`.
  - `style-src` becomes
    `'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com`.
  - Every other directive stays as it is.
- [ ] **Step 4: Run the full Rust gate and the web build.** Expected: PASS.
  Then load the daemon's copy and confirm the console shows no CSP
  violation on load. To do that, run `cargo run -- 7690` and open the
  printed Safari URL in Chrome.
- [ ] **Step 5: Commit**
  `fix(app): drop 'unsafe-inline' from the app's script policy`.

### Task 9: Carve out `daemon/`, `settings/` and the shared `ui/dom.ts`

**Files:**
- Create:
  - `web/src/app/daemon/config.ts`, `parse.ts`, `parse.test.ts`, `token.ts`, `client.ts`
  - `web/src/app/settings/catalog.ts`, `keys.ts`, `keys.test.ts`,
    `schema.ts`, `schema.test.ts`, `settings.ts`
  - `web/src/app/ui/dom.ts`
- Modify: `web/src/app/main.ts`, `web/src/app/files/pane.ts` (imports `el` from `ui/dom.ts`)

**Interfaces:**
- **`ui/dom.ts`:**
  - `export const isMac: boolean`, which is
    `/Mac|iPhone|iPad/.test(navigator.platform)`;
  - `export function el(...)`, moved from `files/pane.ts` with the same
    signature.
- **`daemon/config.ts`:**
  - `export const DAEMON: string`, `MIXED_BLOCKED: boolean` and
    `LOCAL_APP: string`, with the same expressions as today.
- **`daemon/parse.ts`** (a pure file):
  `export function parseToken(text: string): string | null`. It trims the
  text and accepts `token=<hex>` anywhere in it, or bare hex of at least 32
  characters.
- **`daemon/token.ts`:**
  - `export function getToken(): string | null`;
  - `export function adoptToken(text: string): boolean`, which stores the
    token under `tabsh.token:${DAEMON}`;
  - an initial read from `tabsh.token:${DAEMON}`, falling back to
    `webterm.token:${DAEMON}`.
- **`daemon/client.ts`:**
  - `export function daemonFetch(path: string, init?: RequestInit): Promise<Response>`;
  - `export async function api<T>(method: string, path: string, body?: unknown): Promise<T | null>`
    (`/api/sessions${path}`; 204 gives `null`);
  - `export function socketUrl(id: string): string`;
  - `export function waitForDaemon(): Promise<void>`;
  - `export function initGate(): void`, which wires the `#open-local` href
    and the `#pair-form` submit.
- **`settings/catalog.ts`:**
  - `export interface Theme { name: string; system?: boolean; light?: boolean; colors: ThemeColors }`;
  - `THEMES`, `FONTS`, `FONT_SIZES`, `TYPING_SOUNDS`, `TABSH_COLORS` and
    `fontStack(f)`;
  - `export const prefersLight: MediaQueryList | null`, which is
    `globalThis.matchMedia?.('(prefers-color-scheme: light)') ?? null`.
- **`settings/keys.ts`:**
  - `export type KeyId = 'keyPalette' | 'keyNextTab' | 'keyPrevTab'`;
  - `export function keybindings(isMac: boolean): Record<KeyId, { name: string; keywords: string; presets: string[] }>`;
  - `export function keyLabel(combo: string, isMac: boolean, words = !isMac): string`;
  - `export function matchesKey(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, combo: string): boolean`.
- **`settings/schema.ts`:**
  - `export interface Settings { theme: string; font: string; fontSize: number; typingSound: string; paneWidth: number; keyPalette: string; keyNextTab: string; keyPrevTab: string }`;
  - `export function defaults(isMac: boolean): Settings`;
  - `export function cleanSettings(stored: Record<string, unknown>, isMac: boolean): Settings`,
    which implements today's `loadSettings` rules exactly.
- **`settings/settings.ts`:**
  - `export const KEYBINDINGS` (`keybindings(isMac)`) and
    `export const current: { saved: Settings; applied: Settings }`;
  - `export function onApply(fn: (s: Settings) => void): void`, called
    after each apply that isn't stale;
  - `export function onSaved(fn: (s: Settings) => void): void`, called
    when `saved` changes through `loadSettings` or `saveSetting`;
  - `export function setPreviewing(on: boolean): void`;
  - `export function applySettings(s: Settings): Promise<void>`, which
    loads the font, keeps the stale-sequence check, sets
    `--term-bg`/`--term-fg` and the `themed`/`dark` classes, then calls
    the `onApply` listeners;
  - `export function loadSettings(): Promise<void>`, which applies only
    when not previewing;
  - `export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void`;
  - `export function terminalOptions(s: Settings)`.

  Retheming terminals, `--pane-width`, `pane.applyTheme()` and `sendSize`
  now happen in `onApply` listeners that `main.ts` registers. Preloading
  the sound pack happens in an `onSaved` listener.

- [ ] **Step 1: Write `daemon/token.test.ts`.**

```ts
test('parseToken accepts a pairing link, a fragment or a bare token', () => {
  const t = 'a'.repeat(32);
  assert.equal(parseToken(`https://tabsh.cc/app/#token=${t}`), t);
  assert.equal(parseToken(`#token=${t}`), t);
  assert.equal(parseToken(`  ${t.toUpperCase()}  `), t.toUpperCase());
  assert.equal(parseToken('a'.repeat(31)), null);
  assert.equal(parseToken('hello'), null);
});
```

  The test file is `daemon/parse.test.ts`, and it imports `./parse.ts`.
  `adoptToken` in `token.ts` uses `parseToken`.
- [ ] **Step 2: Write `settings/keys.test.ts`.**

```ts
test('keyLabel', () => {
  assert.equal(keyLabel('meta+KeyK', true), '⌘K');
  assert.equal(keyLabel('ctrl+shift+BracketRight', true), '⌃⇧]');
  assert.equal(keyLabel('ctrl+shift+BracketRight', false), 'Ctrl+Shift+]');
  assert.equal(keyLabel('meta+KeyK', true, true), 'Cmd+K');
});
test('matchesKey compares code and every modifier', () => {
  const e = { code: 'KeyK', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
  assert.ok(matchesKey(e, 'meta+KeyK'));
  assert.ok(!matchesKey({ ...e, shiftKey: true }, 'meta+KeyK'));
  assert.ok(!matchesKey(e, 'ctrl+KeyK'));
});
test('presets differ by platform and never repeat across actions', () => {
  for (const mac of [true, false]) {
    const all = Object.values(keybindings(mac)).flatMap((k) => k.presets);
    assert.equal(new Set(all).size, all.length);
  }
  assert.equal(keybindings(true).keyPalette.presets[0], 'meta+KeyK');
  assert.equal(keybindings(false).keyPalette.presets[0], 'ctrl+shift+KeyK');
});
```

- [ ] **Step 3: Write `settings/schema.test.ts`.**

```ts
test('cleanSettings keeps valid values and drops unknown ones', () => {
  const d = defaults(true);
  assert.deepEqual(cleanSettings({}, true), d);
  assert.equal(cleanSettings({ theme: 'nord' }, true).theme, 'nord');
  assert.equal(cleanSettings({ theme: 'gone' }, true).theme, 'tabsh');
  assert.equal(cleanSettings({ theme: 'webterm' }, true).theme, 'tabsh');
  assert.equal(cleanSettings({ fontSize: 17 }, true).fontSize, 13);
  assert.equal(cleanSettings({ paneWidth: 0.9 }, true).paneWidth, 0.5);
  assert.equal(cleanSettings({ paneWidth: 0.3 }, true).paneWidth, 0.3);
  assert.equal(cleanSettings({ typingSound: 'off' }, true).typingSound, 'off');
});
test('a keybinding saved on another OS falls back to this OS default', () => {
  assert.equal(cleanSettings({ keyPalette: 'meta+KeyK' }, false).keyPalette, 'ctrl+shift+KeyK');
  assert.equal(cleanSettings({ keyPalette: 'meta+shift+KeyK' }, true).keyPalette, 'meta+shift+KeyK');
});
```

- [ ] **Step 4: Run `npm test`.** Expected: FAIL, because the modules
  don't exist yet.
- [ ] **Step 5: Create the modules.** Move the code out of `main.ts` into
  them, and have `main.ts` import from them.
  - Startup order in `main.ts` is unchanged:
    1. adopt the token from `location.hash`;
    2. `replaceState`;
    3. the Safari redirect;
    4. `initGate()`.
  - The palette calls `setPreviewing(true)` when it opens and
    `setPreviewing(false)` in its `close` listener, before
    `applySettings(current.saved)`.
- [ ] **Step 6: Run all the web gates and `cargo test`.** Expected: PASS.
  Then check in the dev server:
  - pairing through the form;
  - switching the theme with a live preview, and Esc to revert;
  - focusing the window while the palette previews a theme leaves the
    preview showing.
- [ ] **Step 7: Commit**
  `refactor(app): typed daemon client and settings modules`.

### Task 10: Carve out `sessions/`, `links/provider.ts` and `files/open.ts`

**Files:**
- Create:
  - `web/src/app/sessions/store.ts`, `terminal.ts`, `tabs.ts`, `bell.ts`,
    `bell-scan.ts`, `bell-scan.test.ts`
  - `web/src/app/links/provider.ts`, `web/src/app/files/open.ts`
- Modify: `web/src/app/main.ts`, `src/web/pages.rs` (test)

**Interfaces:**
- **`sessions/bell-scan.ts`:** `export function scanBell(esc: number, bytes: Uint8Array): { esc: number; bell: boolean }`,
  using today's state machine. `export const TEXT = 0`.
- **`sessions/store.ts`:**
  - `export interface Session { id: string; name: string; term: Terminal; fit: FitAddon; el: HTMLDivElement; tab: HTMLElement; ws: WebSocket | null; closed: boolean; replaying: boolean; esc: number; bell: boolean }`;
  - `export const store: { sessions: Session[]; active: Session | null }`;
  - `sync()`, `newSession()`, `closeSession(s)`, `removeSession(s)`,
    `activate(s: Session | null)`, `sendSize(s)`, `cycleTab(step: 1 | -1)`;
  - `newTabAt(cwd: string): Promise<void>`;
  - `savedActive(): string | null`.
- **`sessions/terminal.ts`:** `openSession(info: { id: string; name: string }): Session`
  (xterm, fit, right-click, link provider, tab element), and
  `connect(s)`.
- **`sessions/tabs.ts`:** `setName(s, name, save = true)`,
  `initTabStrip()` (wheel scrolling and fades), and `updateFades()`.
- **`sessions/bell.ts`:** `ring(s)`, `clearBell(s)`, `updateBadge()`, and
  `initBell()` (favicon, `visibilitychange` and focus listeners).
- **`links/provider.ts`:** `export function linkProvider(session: () => Session, term: Terminal, el: HTMLElement)`
  and the `pathExists` cache. It imports `openInPane` from `files/open.ts`.
  To keep the cross-feature imports one-way (`links` → `sessions` is
  forbidden), the `Session` type is imported with `import type` only.
- **`files/open.ts`:**
  - `export function initFilePane(host: Host): void`;
  - `export function loadedPane(): typeof import('./pane.ts') | null`;
  - `export function openInPane(s: { id: string; closed: boolean }, f: { text: string; line?: number; col?: number }): Promise<void>`;
  - the load-failure "Couldn't load the editor" UI, which calls
    `host.layout()` in place of `sendSize(active)`.

  `main.ts` builds the `Host` (`fetch`, `theme`, `layout`, `newTabAt`,
  `focusTerminal`) from `sessions` and `settings`. `sessions/store.ts`
  calls `loadedPane()?.show/forget/confirmDiscard`.

- [ ] **Step 1: Write `sessions/bell-scan.test.ts`.**

```ts
const scan = (chunks: string[]) => {
  let esc = TEXT, bells = 0;
  for (const c of chunks) { const r = scanBell(esc, new TextEncoder().encode(c)); esc = r.esc; bells += +r.bell; }
  return bells;
};
test('a bare BEL rings', () => assert.equal(scan(['make: done\x07']), 1));
test('BEL ending an OSC title does not ring', () => assert.equal(scan(['\x1b]0;~/src\x07$ ']), 0));
test('the OSC state carries across chunks', () => assert.equal(scan(['\x1b]0;ti', 'tle\x07', 'x\x07']), 1));
test('ESC \\ ends a string; DCS, APC, PM and SOS are strings too', () => {
  assert.equal(scan(['\x1b]0;t\x1b\\\x07']), 1);
  for (const intro of ['P', '_', '^', 'X']) assert.equal(scan([`\x1b${intro}data\x07`]), 0, intro);
});
test('CAN aborts a string', () => assert.equal(scan(['\x1b]0;t\x18\x07']), 1));
```

- [ ] **Step 2: Write the Rust test `entry_script_does_not_bundle_the_editor`
  in `src/web/pages.rs`.**
  1. Find the page's one `<script type="module" src="/_astro/NAME">`.
  2. Collect NAME and every file it imports statically, recursively. Match
     `from"./X.js"` and `import"./X.js"` in the minified output, and look
     each one up in `APP_ASSETS`.
  3. Assert that none of them contains `cm-gutter` or `marked`.

  Then run `cargo test entry_script`. Expected: PASS today, because the
  pane is behind `import()`. The test pins that it stays there.
- [ ] **Step 3: Run `npm test`.** Expected: `bell-scan` FAILs because the
  module is missing.
- [ ] **Step 4: Create the modules and move the code.** `main.ts` keeps the
  wiring, and registers the `onApply` listeners for retheming terminals and
  `pane.applyTheme()`.
- [ ] **Step 5: Run all the web gates and `cargo test`.** Expected: PASS.
  Then check in the dev server:
  - opening, renaming (title), closing and middle-click closing tabs;
  - the bell badge on a background tab (`printf '\a'`);
  - Cmd-clicking a path, then editing and saving;
  - closing a tab with unsaved edits asks first;
  - CodeMirror's chunk loads only on the first Cmd-click, which you can
    see in the network panel.
- [ ] **Step 6: Commit**
  `refactor(app): typed sessions, links and file pane wiring`.

### Task 11: Carve out `sound/`, `palette/`, `ui/`, the CSS, and a typed `main.ts`

**Files:**
- Create:
  - `web/src/app/sound/packs.ts`, `typing.ts`
  - `web/src/app/palette/pages.ts`, `palette.ts`
  - `web/src/app/ui/divider.ts`, `about.ts`, `drop.ts`
  - `web/src/styles/app.css`
- Modify: `web/src/app/main.ts`, `web/src/pages/app/index.astro`

**Interfaces:**
- **`sound/packs.ts`:** `SOUND_PACKS`, `loadPack(id)`, `playSample(buf)`,
  `previewSound(setting)`, `keySound(setting, key)`.
- **`sound/typing.ts`:** `initTypingSound()`, the two capture-phase
  `window` listeners with the same selector and checks as today.
- **`palette/pages.ts`:** `ICONS`, `CHECK`, and
  `pages(ctx: { hasFile: boolean; closeFile(): void; openAbout(): void })`.
  It returns the same page map as today's `PAGES`.
- **`palette/palette.ts`:** `initPalette()`, which sets up:
  - the open/close listeners and the backdrop close;
  - the live-preview `MutationObserver`;
  - `setPreviewing`;
  - the palette and tab-cycle keybindings;
  - the settings button.

  It also exports `openPalette()`.
- **`ui/divider.ts`:** `initDivider()`, which also registers the
  `onApply` listener that sets `--pane-width`.
- **`ui/about.ts`:** `initAbout()` and `openAbout()`.
- **`ui/drop.ts`:** `initDrop()`, plus `export function shellQuote(p: string): string`
  and `export function localPaths(uriList: string): string[]`. Both are
  pure, and tested in `ui/drop-paths.test.ts` from the pure file
  `ui/drop-paths.ts`.
- **`main.ts`:** only startup and wiring, under 120 lines, with no
  `@ts-nocheck` and no `biome-ignore-all`.

- [ ] **Step 1: Write `ui/drop-paths.test.ts`.**

```ts
test('shellQuote leaves plain paths and quotes the rest', () => {
  assert.equal(shellQuote('/tmp/a.png'), '/tmp/a.png');
  assert.equal(shellQuote('/tmp/my file.png'), `'/tmp/my file.png'`);
  assert.equal(shellQuote(`/tmp/it's.png`), `'/tmp/it'\\''s.png'`);
});
test('localPaths keeps file URLs only, decoded', () => {
  assert.deepEqual(localPaths('file:///Users/a/My%20Shot.png\r\nhttps://x.y/z\nfile:///b'), ['/Users/a/My Shot.png', '/b']);
  assert.deepEqual(localPaths(''), []);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because the module is
  missing.
- [ ] **Step 3: Create the modules and move the code.**
  - Move the page's `<style is:inline>` into `web/src/styles/app.css`, and
    import it from the page's frontmatter (`import '../../styles/app.css'`).
  - Remove `// @ts-nocheck` and the `biome-ignore-all` line from
    `main.ts`, then fix every type and lint error. Use real types, not
    `any`. A narrowing `as` on a DOM lookup such as `getElementById` is
    fine.
- [ ] **Step 4: Verify.**
  - `grep -rn 'ts-nocheck\|biome-ignore-all' web/src` prints nothing.
  - `wc -l web/src/app/main.ts` is under 120.
  - `grep -c '<style' src/app.html` is `0` or only Astro's bundled
    `<link rel="stylesheet" href="/_astro/…css">`.
  - All web gates and all Rust tests pass, including
    `app_page_scripts_are_embedded`, which also covers the CSS file.
- [ ] **Step 5: Manual check in the dev server.**
  - the palette: themes, fonts, sizes, sounds with preview, keybindings,
    and "Close file" only shown with a file open;
  - typing sounds in the terminal and in the editor, but not in read-only
    view or for shortcuts;
  - dragging the divider, then a reload keeps the width;
  - dropping a file types its path;
  - About shows the right info and closes with the button and with the
    backdrop.
- [ ] **Step 6: Commit**
  `refactor(app): typed sound, palette and UI modules; main.ts is startup only`.

### Task 12: Architecture doc, CLAUDE.md, and the final pass

**Files:**
- Create: `docs/architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Write `docs/architecture.md`,** about one page:
  - both module maps, as built, with one line per file;
  - the boundary rules: Rust visibility, the one-way cross-feature
    imports, the pure files `node --test` loads, and the lazy pane;
  - where a new feature goes on each side: a daemon folder with `routes()`
    merged in `state::router()`, and a web folder whose `init…()` is called
    from `main.ts`;
  - the security invariants: the `guard` wraps every route; the token
    stays out of anything rendered from a file; the iframe sandboxes; no
    `innerHTML` with file content; both CSP copies stay in sync, with no
    `'unsafe-inline'` in `script-src`;
  - the gate commands.
- [ ] **Step 2: Write `CLAUDE.md`.** One line:
  `Read docs/architecture.md before changing code: it sets the module layout, boundaries and security invariants.`
- [ ] **Step 3: Final manual pass.** Use Chrome on the dev server (hosted
  copy) and Safari on `cargo run`'s copy. Run through each item in
  spec §6. The console must show no errors and no CSP violations.
- [ ] **Step 4: Commit**
  `docs: architecture and module rules`.
