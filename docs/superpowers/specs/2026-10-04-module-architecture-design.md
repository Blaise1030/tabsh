# Module architecture for the daemon and the app

Status: approved design, 2026-10-04. Stacked on PR #6 (`feat/file-pane`).

## Intent

**Problem:** nearly all the code sits in two files. `src/main.rs` (1,864
lines) holds the whole daemon, and `web/src/pages/app/index.astro` (1,386
lines) holds the app's CSS plus a single ~1,000-line `is:inline` script. Any
change means reading and editing a file that does everything.

**Success looks like:**
- Each area of the product lives in its own feature folder, behind a small
  interface.
- A new feature or a fix touches one folder, and that folder can be tested
  on its own.
- CI catches type errors, lint problems and formatting drift on the web
  side, as it already does for Rust.

**Constraints:**
- **Behaviour stays the same.** URLs, status codes, headers, the UI, and
  stored settings and sessions are all unchanged. This is a restructure, not
  a feature.
- **Security invariants hold.** The pairing token, the `guard`, and the
  sandboxed previews behave exactly as before.
- The daemon's own copy of the app (`src/app.html`, used by Safari) keeps
  working.
- `cargo install --git` still builds without npm.

**Out of scope:**
- bundling xterm and Basecoat from npm;
- the file pane follow-ups from PR #6;
- the separate security-hardening plan.

## 1. Daemon (`src/`)

There is one crate with one folder per feature. Each feature exposes
`pub(crate) fn routes() -> Router<AppState>`, and its tests live beside its
code in that file's own `#[cfg(test)] mod tests`.

```
src/
  main.rs            startup: args, open the database, token, AppState, bind, serve, shutdown
  state.rs           AppState, plus router() combining every feature's routes() under the guard
  error.rs           BoxError, internal_error
  auth.rs            load_or_create_token, random_hex, token_eq, presented_token
  web/
    mod.rs           routes() for pages and assets
    guard.rs         guard, admits_without_origin, is_public_asset, host_is_address, HOSTED_ORIGINS, LOCAL_NAME
    pages.rs         APP_HTML/APP_PAGE, HOSTED_DAEMON_META, APP_CSP, open_app, open_local_app, local_app, about, open_browser
    assets.rs        SOUNDS and APP_ASSETS (the build.rs include!s), sound, app_asset
  sessions/
    mod.rs           Session, Output, Event, SessionInfo, Rename, NewSession, plus routes: list, create, rename, delete
    store.rs         open_db, insert_session, flush, the scrollback columns
    pty.rs           spawn_session, get_or_spawn, process_cwd (one per OS), SHUTTING_DOWN
    modes.rs         ModeTracker, ScanState, RESTORE_MARKER, TRACKED_MODES
    ws.rs            ws_handler, attach
  files/
    mod.rs           FileQuery, SaveFile, plus routes: file_info, file_raw, save
    resolve.rs       resolve_path, session_base_dir
    kind.rs          FileKind, file_kind, IMAGE_EXTS, raw_content_type
    read.rs          FileInfo, read_file_info, open_regular, version_of, detect_eol, file_error, TEXT_LIMIT_BYTES, RAW_LIMIT_BYTES
    save.rs          save_file, create_temp, SaveError
  settings.rs        get_settings, put_settings
  upload.rs          upload, UploadQuery, UPLOAD_LIMIT_BYTES
```

Constants move with the code that uses them. `SCROLLBACK_BYTES` and
`FLUSH_INTERVAL` go to `sessions`.

**Rules**
- A feature uses another only through its `pub(crate)` items. Everything
  else stays private to its module. `files` reaches `sessions` through one
  function that returns the session's working directory.
- `state::router()` is the only place routes are attached, and the `guard`
  layer wraps all of them. A new route cannot skip the guard.
- `build.rs` doesn't change. Only the `include!(concat!(env!("OUT_DIR"), …))`
  lines move into `web/assets.rs`.
- No `pub` items beyond the crate. The binary has no library API.

## 2. Frontend (`web/src/`)

```
web/src/
  pages/app/index.astro   markup only, plus one <script> importing ../../app/main.ts
  styles/app.css          the page's CSS, moved out of index.astro
  app/
    main.ts               startup: theme the gate, wait for the daemon, load settings, sync tabs
    daemon/
      config.ts           DAEMON, MIXED_BLOCKED, LOCAL_APP
      token.ts            adoptToken, token storage including the old webterm key
      client.ts           daemonFetch, api, waitForDaemon, the connection gate UI
    sessions/
      store.ts            the sessions list, the active tab, sync, newSession, closeSession
      terminal.ts         openSession (xterm, fit, right-click), connect, sendSize
      tabs.ts             the tab strip: render, activate, setName, cycleTab, scroll fades
      bell.ts             scanBell, ring, clearBell, updateBadge, favicon
    links/
      links.ts            findLinks (moved from app/links.ts)
      provider.ts         the xterm link provider, pathExists cache
    files/
      api.ts              moved from app/files.ts
      editor.ts           moved from app/editor.ts
      pane.ts             moved from app/file-pane.ts
      open.ts             openInPane, the "couldn't load the editor" retry
    settings/
      catalog.ts          TABSH_COLORS, THEMES, FONTS, FONT_SIZES, TYPING_SOUNDS, DEFAULTS
      keys.ts             KEYBINDINGS, keyLabel, matchesKey
      settings.ts         saved and applied values, loadSettings, applySettings, saveSetting, loadFont
    sound/
      packs.ts            SOUND_PACKS, loadPack, playSample, sampleFor, previewSound, keySound
      typing.ts           the window keydown and keyup listeners
    palette/
      pages.ts            PAGES, ICONS
      palette.ts          showPage, openPalette, live preview, fades
    ui/
      dom.ts              el, icon helpers shared by modules
      divider.ts          the pane divider drag
      about.ts            openAbout
      drop.ts             drag and drop: uploadFile, localPaths, textForDrop, drop glow
```

Each existing test file moves next to its module (`links/links.test.ts`,
`files/api.test.ts`). These pure units gain tests as they are pulled out:
- `sessions/bell.ts`: `scanBell` finds BEL in text, ignores the BEL that ends
  an OSC/DCS/APC/PM/SOS string, and keeps its state across chunk boundaries.
- `settings/keys.ts`: `matchesKey` and `keyLabel`, on Mac and other systems.
- `settings/settings.ts`: the cleanup that drops unknown values, and the
  fallback for a keybinding saved from another OS.

To make that possible, these functions take their inputs as parameters
(state, `isMac`) rather than reading globals.

**Rules**
- Modules talk to each other only through `export`s. The `window.tabshFilePane`,
  `window.tabshFiles` and `window.tabshLinks` hooks are removed.
- `files/pane.ts` and `files/editor.ts`, with CodeMirror and `marked`, are
  still loaded with `import()` on first use. `main.ts` must not import them
  statically.
- Shared state lives in one owning module and is exported from there:
  `sessions/store.ts` owns the sessions and the active tab, and
  `settings/settings.ts` owns `saved` and `applied`. Other modules import
  them. No module queries another feature's DOM.
- xterm, the fit addon and Basecoat stay the SRI-pinned CDN scripts. The
  `@xterm/xterm` and `@xterm/addon-fit` npm packages are dev dependencies
  used only through `import type`, plus a `globals.d.ts` declaring the CDN
  globals.
- The markup's `onclick="…"` attributes on the two dialogs and the About
  Close button move into modules.

**CSP:** once no inline script or handler is left, drop `'unsafe-inline'`
from `script-src`, and add `'self'` to `style-src` for the bundled CSS. Both
copies change together: `web/public/_headers` and `APP_CSP`. In `index.astro`,
the CDN `<script>` tags keep their `integrity` attributes.

## 3. Quality gates

| Command | What it runs | In CI |
|---|---|---|
| `npm run check` | `astro check` (strict TypeScript, including `.astro` files) | web job |
| `npm run lint` | `biome ci .` (lint and format) | web job |
| `npm test` | `node --test "src/app/**/*.test.ts"` | web job (already) |
| Rust | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` | already |

Biome's formatter is configured to the current style: 2-space indent,
single quotes, semicolons, line width 120. `dist/`, `.astro/`,
`../src/app-assets` and the vendored sounds are ignored. Applying it is one
format-only commit.

## 4. Conventions document

`docs/architecture.md`, about a page:
- the module maps above;
- the boundary rules;
- where a new feature goes on each side;
- the security invariants a refactor must not change: the `guard` wrapping
  every route, token handling, the iframe sandboxes, no `innerHTML` with
  file content, and both CSP copies kept in sync.

A new root `CLAUDE.md` (none exists yet) points to it in one line.

## 5. Migration order

Every commit leaves the build and every test green.

1. Add the Biome and `astro check` gates, then a format-only commit.
2. Daemon: first move the router construction out of `main()` into a
   `router(state)` function, still in `main.rs`, and add the route-table test
   against it (see §6). Then make one commit per
   extraction: `error`, then `auth`, `web`, `sessions`, `files`, `settings`,
   `upload`, and finally `state` and the slim `main.rs`.
3. Frontend: move the existing `app/*.ts` into feature folders. Then pull
   the inline script out feature by feature: daemon, sessions, links and
   files, settings, sound, palette, ui, and finally `main.ts`. Remove the
   `window.tabsh*` hooks once nothing uses them. Every commit that changes
   the app rebuilds `src/app.html` and `src/app-assets`.
4. Tighten the CSP.
5. Write `docs/architecture.md` and `CLAUDE.md`.

## 6. Proving behaviour didn't change

- **Route table test** (written before any move): it builds the real
  `router()` and sends one request for each method and path, exercising the
  `guard`'s current rules:
  - with `Origin: https://tabsh.cc` and no token, every route answers 401,
    except a single-segment `GET /_astro/{name}`, which passes;
  - with no Origin and no token, `/api/files` and `/api/files/raw` answer
    401;
  - a foreign Origin answers 403, and so does a non-address `Host`;
  - a path that isn't routed answers 404 once it passes the guard.

  A route that is lost, or added without the guard, fails the test.
- **Existing tests:** the 20 Rust tests and the 19 web tests keep passing,
  unchanged apart from their import paths.
- **Manual pass at the end**, in Chrome on the hosted copy (dev server) and
  Safari on the daemon's copy:
  - pairing;
  - tabs survive a reload;
  - bell badge;
  - Cmd-click into the pane, then edit and save;
  - palette themes, fonts and sounds;
  - divider;
  - drag and drop;
  - About;
  - no CSP violations in the console.
