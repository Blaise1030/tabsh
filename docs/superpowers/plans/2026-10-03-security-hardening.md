# Daemon Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every path from "another user or process on this machine (or LAN)" to "a shell as the tabsh user", without changing anything for the paired browser.

**Architecture:** All daemon changes are in `src/main.rs`, a single-file axum app. Its request guard (`guard`) gets one rule: every request needs the token, except a CORS preflight and `GET /`. `GET /` stops handing out the token. State files become owner-only, and listening on a non-loopback address must be asked for. Site copy in `web/` is updated so "lost the link" no longer points at the daemon's redirect.

**Tech Stack:** Rust 2024, axum 0.8, tokio, rusqlite (bundled SQLite), `tower` 0.5 (dev-only, for `oneshot` tests). The site uses Astro.

---

## Background (read first)

tabsh is a localhost daemon (`src/main.rs`) that runs shells in PTYs. A hosted page (`https://tabsh.cc/app/`, source in `web/src/pages/app/index.astro`) drives the daemon over HTTP and a WebSocket. Possession of the 32-byte hex token (`~/.tabsh/token`) means you get a shell.

Gaps this plan closes (found by reading the code, not yet reproduced):

| # | Where | Gap |
|---|---|---|
| 1 | `open_app`, `src/main.rs:468-480` | `GET /` from loopback redirects to `…/app/#token=<token>`. Any local user can read it with `curl -si http://127.0.0.1:7681/`. |
| 2 | `guard`, `src/main.rs:414-416` | A request with no `Origin` header skips the token check. Any local process can list, rename and kill sessions, write settings, and upload unlimited 100 MB files. |
| 3 | `open_db` `src/main.rs:285-307`, `upload` `:606-648` | `~/.tabsh/`, `state.db` (holding up to 512 KB of scrollback per tab) and `uploads/` get default permissions (`0755`/`0644`), so other users can read them. |
| 4 | `main`, `src/main.rs:186` | `HOST=0.0.0.0` silently exposes all of the above to the LAN over plain HTTP. |

Out of scope: processes running as the same user (they can already read `~/.tabsh/token`), and compromise of tabsh.cc itself.

Not doing, on purpose:
- **No `--open` flag that launches the browser with the pairing link.** The token would appear in the `open`/`xdg-open` command line, which other local users can see in `ps`.
- **No escaping pass on the command palette.** Saved settings are already checked against known lists before they reach `innerHTML` (`index.astro:701-708`).

## File structure

| File | Change |
|---|---|
| `Cargo.toml` / `Cargo.lock` | Add `tower` as a dev-dependency (already in the lockfile via axum, 0.5.3). |
| `src/main.rs` | Pull out `router()`; rewrite `open_app` and `guard`; add `preflight`, `restrict`, `uploads_dir`, `is_loopback_host`; tighten `open_db` and `upload`; add tests in the existing `mod tests`. |
| `web/src/pages/index.astro` | Replace the "Lost the link? Open the daemon URL" sentence. |
| `web/src/pages/app/index.astro` | Pairing screen also mentions `~/.tabsh/token`. |

The repo keeps the daemon in one file with tests at the bottom, and this plan follows that. Don't split `main.rs`.

Commands used throughout (run from the repo root `/Users/blaise/Developer/ide`):
- Tests: `cargo test`
- CI-equivalent checks: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`

---

### Task 0: Branch

- [ ] **Step 1: Create a branch off main**

```bash
git switch -c security-hardening
```

Expected: `Switched to a new branch 'security-hardening'`

---

### Task 1: Test harness + stop serving the token from `GET /`

**Files:**
- Modify: `Cargo.toml` (dev-dependencies)
- Modify: `src/main.rs` (imports, `main`, `open_app`, `mod tests`)

- [ ] **Step 1: Add `tower` as a dev-dependency**

```bash
cargo add --dev tower@0.5 --features util
```

Expected: `Cargo.toml` gains

```toml
[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
```

- [ ] **Step 2: Pull the router out of `main` so tests can build it**

In `src/main.rs`, replace the `let app = Router::new() … .with_state(state.clone());` block inside `main` (currently lines 240-255) with:

```rust
    let app = router(state.clone());
```

Add this function directly after `main` (before `shutdown_signal`):

```rust
fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(open_app))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route(
            "/api/sessions/{id}",
            patch(rename_session).delete(delete_session),
        )
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/about", get(about))
        .route(
            "/api/uploads",
            post(upload).layer(DefaultBodyLimit::max(UPLOAD_LIMIT_BYTES)),
        )
        .route("/ws", get(ws_handler))
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}
```

- [ ] **Step 3: Add the test helpers and the failing test**

In the existing `#[cfg(test)] mod tests` at the bottom of `src/main.rs`, replace `use super::*;` with:

```rust
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const ORIGIN: &str = "https://tabsh.cc";

    /// A path for a fresh state directory; it does not exist yet.
    fn temp_dir() -> std::path::PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "tabsh-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn test_state() -> AppState {
        let db_path = temp_dir().join("state.db").to_string_lossy().into_owned();
        AppState {
            db: Arc::new(Mutex::new(open_db(&db_path).unwrap())),
            live: Default::default(),
            db_path: db_path.as_str().into(),
            started: std::time::Instant::now(),
            token: TOKEN.into(),
            origins: vec![ORIGIN.to_owned()].into(),
            app_url: Some(format!("{ORIGIN}/app/").into()),
        }
    }

    /// A request as it arrives on loopback: the Host is an address.
    fn request(method: Method, uri: &str) -> axum::http::request::Builder {
        axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "127.0.0.1:7681")
    }

    async fn send(st: &AppState, req: axum::http::request::Builder, body: Body) -> Response {
        router(st.clone())
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn root_redirect_carries_no_token() {
        let st = test_state();
        let res = send(&st, request(Method::GET, "/"), Body::empty()).await;
        assert_eq!(res.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(res.headers()[header::LOCATION], "https://tabsh.cc/app/");
    }
```

Keep the existing `mode_tracker_follows_split_sequences` test below the helpers.

- [ ] **Step 4: Run the test and confirm it fails**

Run: `cargo test root_redirect_carries_no_token`
Expected: FAIL. The status is `500 Internal Server Error`, because `open_app` asks for `ConnectInfo`, which `oneshot` doesn't provide. With `ConnectInfo` present, the `Location` header would contain `#token=`.

- [ ] **Step 5: Make `open_app` never serve the token**

Replace `open_app` and its doc comment (currently lines 464-480) with:

```rust
/// The UI lives on the hosted site, so visiting the daemon sends you there.
/// The token is never served: every user and process on this machine can
/// reach this port. Pairing uses the link printed at startup, or the token
/// in `~/.tabsh/token` pasted into the app.
async fn open_app(State(st): State<AppState>) -> Response {
    match &st.app_url {
        Some(app_url) => Redirect::temporary(app_url).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
```

In `main`, change the serve line from

```rust
        res = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()) => res.unwrap(),
```

to

```rust
        res = axum::serve(listener, app) => res.unwrap(),
```

In the `use` block at the top, remove `ConnectInfo, ` from the `extract::{…}` list and remove the `net::SocketAddr,` line. Clippy fails on unused imports.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cargo test`
Expected: PASS, including `root_redirect_carries_no_token` and `mode_tracker_follows_split_sequences`.

- [ ] **Step 7: Run clippy**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock src/main.rs
git commit -m "Daemon: stop serving the pairing token from GET /

Any local user could read it from the redirect's Location header with
curl and open a shell as the daemon's user.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Require the token on every request

**Files:**
- Modify: `src/main.rs` (`guard`, new `preflight`, `mod tests`)

- [ ] **Step 1: Write the tests**

Add to `mod tests`:

```rust
    #[tokio::test]
    async fn requests_without_origin_need_the_token() {
        let st = test_state();
        let res = send(&st, request(Method::GET, "/api/sessions"), Body::empty()).await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let res = send(&st, request(Method::DELETE, "/api/sessions/x"), Body::empty()).await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let res = send(
            &st,
            request(Method::POST, "/api/uploads?name=a.txt"),
            Body::from("hi"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_opens_the_api_with_or_without_origin() {
        let st = test_state();
        let auth = format!("Bearer {TOKEN}");
        let res = send(
            &st,
            request(Method::GET, "/api/sessions").header(header::AUTHORIZATION, &auth),
            Body::empty(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);
        let res = send(
            &st,
            request(Method::GET, "/api/sessions")
                .header(header::ORIGIN, ORIGIN)
                .header(header::AUTHORIZATION, &auth),
            Body::empty(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], ORIGIN);
    }

    #[tokio::test]
    async fn wrong_token_and_foreign_origin_are_refused() {
        let st = test_state();
        let res = send(
            &st,
            request(Method::GET, "/api/sessions").header(header::AUTHORIZATION, "Bearer nope"),
            Body::empty(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let res = send(
            &st,
            request(Method::GET, "/api/sessions")
                .header(header::ORIGIN, "https://evil.example")
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}")),
            Body::empty(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn preflight_and_root_need_no_token() {
        let st = test_state();
        let res = send(
            &st,
            request(Method::OPTIONS, "/api/sessions").header(header::ORIGIN, ORIGIN),
            Body::empty(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let res = send(&st, request(Method::GET, "/"), Body::empty()).await;
        assert_eq!(res.status(), StatusCode::TEMPORARY_REDIRECT);
    }
```

- [ ] **Step 2: Run the tests and confirm the new rule fails**

Run: `cargo test -- requests_without_origin token_opens wrong_token preflight_and_root`
Expected:
- `requests_without_origin_need_the_token` FAILS: `left: 200, right: 401` on the first assert.
- The other three PASS already. They pin the behaviour Step 3 must keep.

- [ ] **Step 3: Rewrite `guard`**

Replace `guard` and its doc comment (currently lines 400-451) with:

```rust
/// Browsers let any site send requests to localhost, and every user and
/// process on this machine can connect to the port, so every request passes
/// through here:
/// - The Host must be `localhost` or an IP address. A DNS name means DNS
///   rebinding: a page whose own domain resolves to us, which would
///   otherwise look same-origin.
/// - An Origin, when sent, must be a hosted UI; its responses get CORS headers.
/// - Everything except a CORS preflight and `GET /` (which reveals nothing)
///   must carry the token, from a browser or not.
async fn guard(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    if !host_is_address(headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let origin = headers.get(header::ORIGIN).cloned();
    if origin
        .as_ref()
        .is_some_and(|o| !st.origins.iter().any(|allowed| o == allowed.as_str()))
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    let public = req.method() == Method::GET && req.uri().path() == "/";
    let mut res = if origin.is_some() && req.method() == Method::OPTIONS {
        preflight()
    } else if public || presented_token(&req).is_some_and(|t| token_eq(t, &st.token)) {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    };
    if let Some(origin) = origin {
        let h = res.headers_mut();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        h.insert(header::VARY, HeaderValue::from_static("origin"));
    }
    res
}

/// The answer to a hosted UI's CORS preflight.
fn preflight() -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    // Chrome's Private Network Access preflight for public pages reaching localhost.
    h.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    res
}
```

Also update the comment in `ws_handler` (currently lines 694-696) so it matches:

```rust
    // Browsers let any site open a WebSocket to localhost and always send
    // Origin when they do; `guard` has checked it is a hosted UI and the
    // token. Without one this isn't a browser we can vouch for.
```

- [ ] **Step 4: Run all the tests and confirm they pass**

Run: `cargo test`
Expected: PASS (6 tests).

- [ ] **Step 5: Run clippy and fmt**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main.rs
git commit -m "Daemon: require the token on every request

Requests without an Origin header skipped the token check, so any local
process could list, rename and kill sessions, rewrite settings and fill
the disk with uploads.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Make state files owner-only

**Files:**
- Modify: `src/main.rs` (imports, `main`, `open_db`, `upload`, new `restrict` + `uploads_dir`, `mod tests`)

- [ ] **Step 1: Write the tests**

Add to `mod tests`:

```rust
    fn mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn state_files_are_private() {
        let dir = temp_dir();
        let db = dir.join("state.db");
        let _conn = open_db(db.to_str().unwrap()).unwrap(); // keeps the WAL file around
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&db), 0o600);
        assert_eq!(mode(&dir.join("state.db-wal")), 0o600);
    }

    #[test]
    fn reopening_tightens_existing_state_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let db = dir.join("state.db");
        drop(open_db(db.to_str().unwrap()).unwrap());
        std::fs::set_permissions(&db, std::fs::Permissions::from_mode(0o644)).unwrap();
        let _conn = open_db(db.to_str().unwrap()).unwrap();
        assert_eq!(mode(&db), 0o600);
    }

    #[tokio::test]
    async fn uploads_are_private() {
        let st = test_state();
        let res = send(
            &st,
            request(Method::POST, "/api/uploads?name=a.txt")
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}")),
            Body::from("secret"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let path = std::path::Path::new(json["path"].as_str().unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"secret");
        assert_eq!(mode(path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -- private tightens`
Expected: all three FAIL on the mode asserts, e.g. `left: 493, right: 448` (`0o755` vs `0o700`) and `left: 420, right: 384` (`0o644` vs `0o600`).

- [ ] **Step 3: Add the helpers**

In the `use std::{…}` block at the top, change

```rust
    os::unix::fs::OpenOptionsExt,
```

to

```rust
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
```

Add these two functions directly after `open_db`:

```rust
/// Narrows `path` to `mode`, if it exists.
fn restrict(path: &std::path::Path, mode: u32) -> std::io::Result<()> {
    match std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        res => res,
    }
}

/// Where files dropped onto a terminal are saved: next to the database.
fn uploads_dir(db_path: &str) -> std::path::PathBuf {
    std::path::Path::new(db_path)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("uploads")
}
```

- [ ] **Step 4: Tighten `open_db`**

Replace `open_db` (currently lines 285-307) with:

```rust
fn open_db(path: &str) -> Result<Connection, BoxError> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        // The mode applies only when tabsh creates the directory; one that
        // already exists (a custom TABSH_DB in a shared folder) is left alone.
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS sessions (
             id         TEXT PRIMARY KEY,
             name       TEXT NOT NULL,
             position   INTEGER NOT NULL,
             cwd        TEXT,
             scrollback BLOB NOT NULL DEFAULT x'',
             updated_at INTEGER NOT NULL DEFAULT (unixepoch())
         );
         -- UI preferences (theme, font, ...) as one JSON object; the page owns its shape.
         CREATE TABLE IF NOT EXISTS settings (
             id    INTEGER PRIMARY KEY CHECK (id = 1),
             value TEXT NOT NULL
         );",
    )?;
    // Scrollback holds whatever was ever printed: keep it, and the WAL that
    // carries its recent writes, readable by this user only.
    for suffix in ["", "-wal", "-shm"] {
        restrict(std::path::Path::new(&format!("{path}{suffix}")), 0o600)?;
    }
    Ok(conn)
}
```

- [ ] **Step 5: Write uploads owner-only**

In `upload`, replace everything from `let dir = std::path::Path::new(&*st.db_path)` through the closing `.map_err(internal_error)?;` of the `spawn_blocking` call (currently lines 631-646) with:

```rust
    let dir = uploads_dir(&st.db_path);
    let path = dir.join(format!(
        "{nanos:x}-{:x}-{safe}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let dest = path.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)?;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&dest)?
            .write_all(&body)
    })
    .await
    .map_err(internal_error)?
    .map_err(internal_error)?;
```

- [ ] **Step 6: Tighten an existing uploads folder at startup**

In `main`, directly after the line `let db = open_db(&db_path).unwrap_or_else(…);`, add:

```rust
    // Files dropped in before uploads were made private.
    if let Err(e) = restrict(&uploads_dir(&db_path), 0o700) {
        eprintln!("tabsh: could not make uploads private: {e}");
    }
```

- [ ] **Step 7: Run all the tests and confirm they pass**

Run: `cargo test`
Expected: PASS (9 tests).

- [ ] **Step 8: Run clippy and fmt**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 9: Commit**

```bash
git add src/main.rs
git commit -m "Daemon: keep state.db and uploads readable by their owner only

They were created with default permissions, so other users on the
machine could read every tab's saved scrollback and dropped files.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Refuse non-loopback `HOST` unless opted in

**Files:**
- Modify: `src/main.rs` (`main`, new `is_loopback_host`, `mod tests`)

- [ ] **Step 1: Write the test**

Add to `mod tests`:

```rust
    #[test]
    fn only_loopback_hosts_are_local() {
        for host in ["127.0.0.1", "127.0.0.2", "::1", "localhost", "LOCALHOST"] {
            assert!(is_loopback_host(host), "{host}");
        }
        for host in ["0.0.0.0", "::", "192.168.1.10", "example.com"] {
            assert!(!is_loopback_host(host), "{host}");
        }
    }
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cargo test only_loopback_hosts_are_local`
Expected: FAIL to compile with `cannot find function `is_loopback_host``.

- [ ] **Step 3: Add `is_loopback_host` and use it in `main`**

Add after `host_is_address`:

```rust
/// Anything that reaches the port with the token gets a shell, over plain
/// HTTP, so listening beyond this machine must be asked for.
fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}
```

In `main`, directly after `let host = std::env::var("HOST")…;`, add:

```rust
    if !is_loopback_host(&host) {
        if std::env::var("TABSH_ALLOW_REMOTE").as_deref() != Ok("1") {
            eprintln!(
                "tabsh: refusing to listen on {host}: anyone who can reach it and \
                 sees the token gets a shell, over unencrypted HTTP. \
                 Set TABSH_ALLOW_REMOTE=1 to do it anyway."
            );
            std::process::exit(1);
        }
        eprintln!("tabsh: warning: listening on {host} over unencrypted HTTP");
    }
```

- [ ] **Step 4: Run all the tests and confirm they pass**

Run: `cargo test`
Expected: PASS (10 tests).

- [ ] **Step 5: Run clippy and fmt**

Run: `cargo fmt && cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main.rs
git commit -m "Daemon: refuse to listen beyond loopback unless TABSH_ALLOW_REMOTE=1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Update pairing copy on the site

The landing page tells users who lost the link to open the daemon URL "and the daemon sends you here, paired". After Task 1 that's no longer true.

**Files:**
- Modify: `web/src/pages/index.astro:117-121`
- Modify: `web/src/pages/app/index.astro:217-220`

- [ ] **Step 1: Fix the landing page**

In `web/src/pages/index.astro`, replace:

```html
        <span class="mark">&gt;</span> Chrome may ask to let this site access apps on your device. That's the
        connection to the daemon; allow it once. Lost the link? Open <code>{DAEMON_URL}</code> in
        this browser and the daemon sends you here, paired.
```

with:

```html
        <span class="mark">&gt;</span> Chrome may ask to let this site access apps on your device. That's the
        connection to the daemon; allow it once. Lost the link? Paste the token from
        <code>~/.tabsh/token</code> into the app's pairing screen.
```

Keep the `DAEMON_URL` import: line 101 still uses it.

- [ ] **Step 2: Fix the app's pairing screen**

In `web/src/pages/app/index.astro`, replace:

```html
        <p>Open the link tabsh printed when it started, or paste it here.</p>
```

with:

```html
        <p>Open the link tabsh printed when it started, or paste it, or the token in <code>~/.tabsh/token</code>, here.</p>
```

The pair form already accepts a bare token (`adoptToken`, `index.astro:265-272`).

- [ ] **Step 3: Build the site**

Run: `cd web && npm ci && npm run build`
Expected: the build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/index.astro web/src/pages/app/index.astro
git commit -m "Site: pair a lost browser with the token file, not the daemon redirect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Run the CI checks**

Run: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`
Expected: all pass (10 tests).

- [ ] **Step 2: Start a throwaway daemon**

```bash
export TABSH_DB="$(mktemp -d)/sub/state.db"
cargo run -- 7690
```

Run it in the background (or a second terminal). Expected output includes `open the app: https://tabsh.cc/app/?daemon=http://127.0.0.1:7690#token=…`.

- [ ] **Step 3: Probe it the way a local attacker would**

```bash
curl -si http://127.0.0.1:7690/ | grep -i '^location'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7690/api/sessions
curl -s -o /dev/null -w '%{http_code}\n' -X POST --data x 'http://127.0.0.1:7690/api/uploads?name=x'
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat "$(dirname "$TABSH_DB")/token")" http://127.0.0.1:7690/api/sessions
stat -f '%Lp %N' "$(dirname "$TABSH_DB")" "$TABSH_DB" "$(dirname "$TABSH_DB")/token"
```

Expected, in order:
- `Location: https://tabsh.cc/app/?daemon=http://127.0.0.1:7690` (no `#token`)
- `401`
- `401`
- `200`
- `700 …/sub`, `600 …/state.db`, `600 …/token`

(`stat -f` is macOS; on Linux use `stat -c '%a %n'`.)

- [ ] **Step 4: Check the HOST guard**

```bash
HOST=0.0.0.0 cargo run -- 7691; echo "exit=$?"
```

Expected: `tabsh: refusing to listen on 0.0.0.0: …` then `exit=1`.

- [ ] **Step 5: Check the real app still works**

1. Start the daemon normally with `cargo run`.
2. Open the printed link in Chrome.
3. Confirm you can open a tab, type, rename it, drop an image onto it, change the theme, and reload the page with the tab restored.
4. Stop the daemon.

- [ ] **Step 6: Stop the throwaway daemon and clean up**

```bash
kill %1 2>/dev/null; rm -rf "$(dirname "$(dirname "$TABSH_DB")")"; unset TABSH_DB
```

---

## Open questions (don't block execution)

- **Hosted-origin trust.** Anyone who controls tabsh.cc or its deploy pipeline (Cloudflare token, GitHub Actions) controls every paired machine. The app CSP allows `'unsafe-inline'` scripts and all of `cdn.jsdelivr.net`. Tightening that would mean moving the inline script to a file, using hashes, and pinning exact CDN paths. That's a separate plan.
- **Existing `~/.tabsh` directory.** It stays `0755` on existing installs. This is safe after Task 3, since its contents are `0600`/`0700`, but it still shows file names. Decide whether to `chmod 0700` it when its path is the default `~/.tabsh`.
