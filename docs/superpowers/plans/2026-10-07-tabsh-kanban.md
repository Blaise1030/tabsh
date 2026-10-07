# tabsh kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Linear-style kanban board inside tabsh where every card is a tabsh terminal, and the coding agent in it (Claude Code first, any agent CLI with hooks) keeps the card's status current through the agent-neutral `tabsh status` CLI.

**Architecture:** The Rust daemon gains a `board` feature (status columns on the `sessions` table, a status `PATCH`, and a WebSocket that pushes status changes) and a `cli` module (`tabsh status`, and `tabsh setup`, which prints a guide the agent follows to wire its own hooks to `tabsh status`; tabsh never edits agent config) on the same binary. Shells get `TABSH_SESSION_ID`/`TABSH_URL` in their environment so hooks know their card. The web app gains a `board/` folder: status glyphs on tabs, a toggleable board view, and a New card dialog, styled only with the theme-derived Basecoat tokens.

**Tech Stack:** Rust 2024 (axum 0.8, rusqlite, tokio, serde_json), Astro + vanilla TypeScript, xterm.js, Basecoat CSS, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-tabsh-kanban-design.md`

## Global Constraints

- Read `docs/architecture.md` first. Split by feature; each daemon feature exposes `pub(crate) fn routes() -> Router<AppState>`, merged only in `state::router()`; every new route is added to `every_route_is_guarded`; nothing is bare `pub`.
- Statuses are exactly: `backlog`, `in_progress`, `needs_input`, `completed`, `archived`.
- Hooks never change an `archived` card; `--if-not completed` (sent as `"unless": "completed"`) keeps `Stop` from replacing `completed`; `source: "user"` (the board) always applies.
- `tabsh status --hook` prints nothing and always exits 0. Without `--hook`, errors print one line to stderr and exit 1. HTTP timeout 500 ms.
- `tabsh` with no subcommand (or a port number as the first argument) starts the daemon exactly as before.
- The board uses only Basecoat tokens (`--background`, `--foreground`, `--card`, `--border`, `--muted`, `--muted-foreground`, `--accent`) plus one new `--needs-input` amber. The needs-input glyph is the only coloured element on the board.
- Every user-controlled string (session names come from shell OSC titles, notes come from the agent) is put in the DOM with `textContent`, never `innerHTML`.
- tabsh never reads or writes an agent's config files and hard-codes no agent's hook names; the only agent-specific default is the launch template `claude {prompt}`.
- Spec deviation, agreed by the reality of the code: tabsh's ⌘K palette does not list sessions, so "needs_input first in ⌘K" becomes a "Toggle board" palette item instead.
- Commit after each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Work on branch `kanban-board`.
- Checks: `cargo test`, `cargo clippy --all-targets -- -D warnings`, and in `web/`: `npm test`, `npm run check`, `npm run lint`.

## Review Focus

- A session name containing markup (e.g. `<img src=x onerror=alert(1)>` set via OSC 0) must render as text on the board card. Pinned in Task 8 (e2e asserts the literal text).
- Adding an element to the tab must not break existing e2e selectors `#tabs .tab[aria-selected="true"] span` (strict mode: exactly one `span`). The glyph is therefore an `<i>`, not a `<span>`. Pinned in Task 10 by running the existing e2e suite.
- A prompt containing quotes, `$(...)`, backticks or newlines must reach the agent as one literal argument, never executed by the shell. Pinned in Task 3 (`launch_line` tests).
- An old `~/.tabsh/state.db` without the new columns must open, and its sessions show as backlog cards with a sane `status_at` (not 1970). Pinned in Task 1.
- An agent command template without `{prompt}` (e.g. `gemini`) must still start the agent with the prompt, appended as one quoted argument, and a template with `{prompt}` twice must not double-run anything unquoted. Pinned in Task 3 (`launch_line` tests).

---

## File Structure

Daemon:
- Create `src/board/mod.rs` — statuses, migration, `routes()`, the status `PATCH` handler, `BoardEvent`, `launch_line()`.
- Create `src/board/rules.rs` — the pure "does this update apply" rule.
- Create `src/board/events.rs` — the `/api/board/events` WebSocket.
- Create `src/cli/mod.rs` — subcommand dispatch and usage.
- Create `src/cli/status.rs` — `tabsh status`: args, env, the tiny HTTP client.
- Create `src/cli/setup.rs` — `tabsh setup`: prints the guide.
- Create `src/cli/setup.md` — the agent setup guide, embedded with `include_str!`.
- Modify `src/main.rs` — CLI dispatch before the daemon; `events`, `self_url` in `AppState`.
- Modify `src/state.rs` — `AppState` fields, merge `board::routes()`, guarded-route list.
- Modify `src/test_support.rs` — new `AppState` fields.
- Modify `src/sessions/mod.rs` — `SessionInfo` fields, list query, `create_session` with `name`/`prompt`.
- Modify `src/sessions/store.rs` — call `board::migrate`, `insert_card`, `info()`.
- Modify `src/sessions/pty.rs` — `shell_env()`, pending input written after spawn.

Web (`web/src/app/board/`):
- Create `model.ts` (+ `model.test.ts`) — pure: statuses, columns, grouping, time-in-status, short paths, recent folders, drop order.
- Create `glyph.ts` — status glyph SVG strings.
- Create `status.ts` — a session's card state, applying it to its tab, change listeners.
- Create `events.ts` — the board events socket.
- Create `view.ts` — the board view, drag and drop, toggle, keybinding.
- Create `new-card.ts` — the New card dialog (title, folder, first prompt, agent command).
- Modify `sessions/store.ts`, `sessions/terminal.ts`, `daemon/client.ts`, `settings/keys.ts`, `settings/schema.ts`, `palette/pages.ts`, `palette/palette.ts`, `main.ts`, `pages/app/index.astro`, `styles/app.css`.
- Create `web/e2e/board.spec.ts`.

Docs: `docs/architecture.md`, `README.md`.

---

### Task 1: Card columns on sessions

**Files:**
- Create: `src/board/mod.rs`
- Modify: `src/main.rs:1-10` (add `mod board;`), `src/sessions/store.rs`, `src/sessions/mod.rs`

**Interfaces:**
- Produces: `board::STATUSES: [&str; 5]`; `board::migrate(&Connection) -> rusqlite::Result<()>`; `sessions::SessionInfo { id, name, status, status_at, note, cwd }` (now `pub(crate)`, `Serialize`); `sessions::store::INFO_COLUMNS: &str`; `sessions::store::info(&Connection, &str) -> rusqlite::Result<Option<SessionInfo>>`; `sessions::store::NewCard<'a> { cwd: Option<&'a str>, name: Option<&'a str>, status: &'a str, pending: Option<&'a str> }` (`Default` = backlog, all `None`); `sessions::store::insert_card(&Connection, &NewCard) -> rusqlite::Result<SessionInfo>`. `insert_session(db, cwd)` stays as a wrapper and becomes `pub(crate)` (the board and CLI tests use it).

- [ ] **Step 1: Write the failing tests** — append to `src/sessions/store.rs` `mod tests`:

```rust
    #[test]
    fn new_sessions_are_backlog_cards() {
        let db = open_db(":memory:").unwrap();
        let a = insert_session(&db, Some("/tmp")).unwrap();
        assert_eq!(a.status, "backlog");
        assert!(a.status_at > 1_700_000_000, "status_at is now, not 0");
        assert_eq!(a.note, None);
        assert_eq!(a.cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn a_card_can_start_named_with_a_status_and_pending_input() {
        let db = open_db(":memory:").unwrap();
        let c = insert_card(
            &db,
            &NewCard { cwd: None, name: Some("Fix login"), status: "in_progress", pending: Some("claude 'x'\r") },
        )
        .unwrap();
        assert_eq!((c.name.as_str(), c.status.as_str()), ("Fix login", "in_progress"));
        let pending: Option<String> = db
            .query_row("SELECT pending_input FROM sessions WHERE id = ?1", params![c.id], |r| r.get(0))
            .unwrap();
        assert_eq!(pending.as_deref(), Some("claude 'x'\r"));
        assert_eq!(info(&db, &c.id).unwrap().unwrap().name, "Fix login");
        assert!(info(&db, "missing").unwrap().is_none());
    }

    #[test]
    fn an_old_database_gains_the_card_columns() {
        let dir = crate::test_support::scratch();
        let path = dir.join("state.db");
        let path = path.to_str().unwrap();
        {
            let old = Connection::open(path).unwrap();
            old.execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
                 cwd TEXT, scrollback BLOB NOT NULL DEFAULT x'', updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
                 INSERT INTO sessions (id, name, position) VALUES ('old', 'Terminal 1', 1);",
            )
            .unwrap();
        }
        let db = open_db(path).unwrap();
        let s = info(&db, "old").unwrap().unwrap();
        assert_eq!(s.status, "backlog");
        assert!(s.status_at > 1_700_000_000);
        // Opening twice is fine (migration is idempotent).
        drop(db);
        open_db(path).unwrap();
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --lib sessions::store`
Expected: compile errors (`status` field, `insert_card`, `NewCard`, `info` not found).

- [ ] **Step 3: Implement**

Create `src/board/mod.rs`:

```rust
//! The kanban board: every session is a card with a status, set by the
//! coding agent's hooks (through `tabsh status`) and by dragging cards on the board.

use rusqlite::Connection;

/// Every status a card can have, in board order.
pub(crate) const STATUSES: [&str; 5] = ["backlog", "in_progress", "needs_input", "completed", "archived"];

/// Adds the card columns to a `sessions` table that lacks them. SQLite can't
/// add a column with a non-constant default, so `status_at` starts at 0 and
/// is set to now for those rows.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('sessions')")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for (name, ddl) in [
        ("status", "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'"),
        ("status_at", "ALTER TABLE sessions ADD COLUMN status_at INTEGER NOT NULL DEFAULT 0"),
        ("note", "ALTER TABLE sessions ADD COLUMN note TEXT"),
        ("pending_input", "ALTER TABLE sessions ADD COLUMN pending_input TEXT"),
    ] {
        if !cols.iter().any(|c| c == name) {
            conn.execute(ddl, [])?;
        }
    }
    conn.execute("UPDATE sessions SET status_at = unixepoch() WHERE status_at = 0", [])?;
    Ok(())
}
```

In `src/main.rs` add `mod board;` (alphabetical, after `mod auth;`).

In `src/sessions/store.rs`:
- At the end of `open_db`, before `Ok(conn)`: `crate::board::migrate(&conn)?;`
- Add:

```rust
/// The columns `SessionInfo` is read from, in `info_row`'s order.
pub(crate) const INFO_COLUMNS: &str = "id, name, status, status_at, note, cwd";

pub(super) fn info_row(r: &rusqlite::Row) -> rusqlite::Result<SessionInfo> {
    Ok(SessionInfo {
        id: r.get(0)?,
        name: r.get(1)?,
        status: r.get(2)?,
        status_at: r.get(3)?,
        note: r.get(4)?,
        cwd: r.get(5)?,
    })
}

/// One session as the tab strip and the board see it.
pub(crate) fn info(db: &Connection, id: &str) -> rusqlite::Result<Option<SessionInfo>> {
    use rusqlite::OptionalExtension;
    db.query_row(
        &format!("SELECT {INFO_COLUMNS} FROM sessions WHERE id = ?1"),
        params![id],
        info_row,
    )
    .optional()
}

/// What a new session starts as.
pub(crate) struct NewCard<'a> {
    pub(crate) cwd: Option<&'a str>,
    /// `None`: the next free "Terminal N".
    pub(crate) name: Option<&'a str>,
    pub(crate) status: &'a str,
    /// Typed into the shell once it starts.
    pub(crate) pending: Option<&'a str>,
}

impl Default for NewCard<'_> {
    fn default() -> Self {
        NewCard { cwd: None, name: None, status: "backlog", pending: None }
    }
}

pub(crate) fn insert_session(db: &Connection, cwd: Option<&str>) -> rusqlite::Result<SessionInfo> {
    insert_card(db, &NewCard { cwd, ..Default::default() })
}
```

Rename the body of the old `insert_session` to `pub(crate) fn insert_card(db: &Connection, card: &NewCard) -> rusqlite::Result<SessionInfo>`: keep the id generation; compute `let name = match card.name { Some(n) => n.to_owned(), None => format!("Terminal {n}") };` (keep the existing `n` computation for the `None` case); insert with:

```rust
    db.execute(
        "INSERT INTO sessions (id, name, position, cwd, status, status_at, pending_input)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sessions), ?3, ?4, unixepoch(), ?5)",
        params![id, name, card.cwd, card.status, card.pending],
    )?;
    Ok(info(db, &id)?.expect("just inserted"))
```

In `src/sessions/mod.rs`:
- Replace the `SessionInfo` struct with:

```rust
#[derive(Serialize, Clone, Debug)]
pub(crate) struct SessionInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) status_at: i64,
    pub(crate) note: Option<String>,
    pub(crate) cwd: Option<String>,
}
```

- `list_sessions` query becomes `&format!("SELECT {} FROM sessions ORDER BY position", store::INFO_COLUMNS)` mapped with `store::info_row`.

- [ ] **Step 4: Run tests**

Run: `cargo test`
Expected: all pass, including the existing `new_session_can_start_in_a_directory` and `cwd_falls_back_to_the_saved_column`.

- [ ] **Step 5: Commit**

```bash
git add src/board src/main.rs src/sessions
git commit -m "feat(board): card status columns on sessions"
```

---

### Task 2: Status endpoint, rules and events socket

**Files:**
- Create: `src/board/rules.rs`, `src/board/events.rs`
- Modify: `src/board/mod.rs`, `src/state.rs`, `src/main.rs`, `src/test_support.rs`

**Interfaces:**
- Consumes: `sessions::store::info`, `SessionInfo`, `STATUSES` (Task 1).
- Produces: `AppState.events: tokio::sync::broadcast::Sender<board::BoardEvent>`; `board::BoardEvent { id, status, status_at, note }` (`Serialize`, `Clone`); `board::routes()`; `PATCH /api/sessions/{id}/status` body `{status, note?, source?: "hook"|"user", unless?}` → `200 SessionInfo` | `400` | `404`; `GET /api/board/events` WebSocket sending `BoardEvent` JSON, or `{"resync":true}` after lagging.

- [ ] **Step 1: Write the failing tests**

`src/board/rules.rs`:

```rust
//! Whether a status update applies to a card.

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Source {
    /// The agent's hooks and instructions, through `tabsh status`.
    Hook,
    /// The board: a drag always wins.
    User,
}

/// Hooks never touch an archived card, and skip the update when the card is
/// in the `unless` status (the Stop hook passes `completed`).
pub(crate) fn applies(current: &str, source: Source, unless: Option<&str>) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_board_always_wins() {
        assert!(applies("archived", Source::User, None));
        assert!(applies("completed", Source::User, Some("completed")));
    }

    #[test]
    fn hooks_leave_archived_cards_alone() {
        assert!(!applies("archived", Source::Hook, None));
    }

    #[test]
    fn unless_skips_only_that_status() {
        assert!(!applies("completed", Source::Hook, Some("completed")));
        assert!(applies("in_progress", Source::Hook, Some("completed")));
        assert!(applies("completed", Source::Hook, None));
    }
}
```

Append to `src/board/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sessions::store::insert_session, state::router, test_support::test_state};
    use axum::http::{Method, Request, StatusCode};
    use tower::ServiceExt;

    async fn patch(st: &AppState, id: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method(Method::PATCH)
            .uri(format!("/api/sessions/{id}/status"))
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer t0k3n")
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(body.to_string()))
            .unwrap();
        let res = router(st.clone()).oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    fn new_card(st: &AppState) -> String {
        insert_session(&st.db.lock().unwrap(), None).unwrap().id
    }

    #[tokio::test]
    async fn a_hook_moves_a_card_and_the_board_hears_it() {
        let st = test_state();
        let id = new_card(&st);
        let mut rx = st.events.subscribe();
        let (code, body) = patch(&st, &id, serde_json::json!({"status": "needs_input", "note": "  needs Bash  "})).await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body["status"], "needs_input");
        assert_eq!(body["note"], "needs Bash");
        let ev = rx.try_recv().unwrap();
        assert_eq!((ev.id.as_str(), ev.status.as_str()), (id.as_str(), "needs_input"));
    }

    #[tokio::test]
    async fn bad_status_is_400_and_unknown_session_is_404() {
        let st = test_state();
        let id = new_card(&st);
        assert_eq!(patch(&st, &id, serde_json::json!({"status": "doing"})).await.0, StatusCode::BAD_REQUEST);
        assert_eq!(patch(&st, "nope", serde_json::json!({"status": "backlog"})).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn hooks_skip_archived_and_unless_but_the_board_does_not() {
        let st = test_state();
        let id = new_card(&st);
        patch(&st, &id, serde_json::json!({"status": "archived", "source": "user"})).await;
        let mut rx = st.events.subscribe();
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "in_progress"})).await;
        assert_eq!(body["status"], "archived");
        assert!(rx.try_recv().is_err(), "no event when nothing changed");

        patch(&st, &id, serde_json::json!({"status": "completed", "source": "user"})).await;
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "needs_input", "unless": "completed"})).await;
        assert_eq!(body["status"], "completed");
    }

    #[tokio::test]
    async fn status_at_only_moves_when_the_status_changes() {
        let st = test_state();
        let id = new_card(&st);
        st.db.lock().unwrap().execute("UPDATE sessions SET status_at = 5 WHERE id = ?1", [&id]).unwrap();
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "backlog", "note": "x"})).await;
        assert_eq!(body["status_at"], 5);
        assert_eq!(body["note"], "x");
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "in_progress"})).await;
        assert_ne!(body["status_at"], 5);
        assert_eq!(body["note"], serde_json::Value::Null, "a change without a note clears it");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --lib board`
Expected: compile errors (`events` field, `routes`, `BoardEvent`), and `todo!()` panics in `rules`.

- [ ] **Step 3: Implement**

`rules::applies`:

```rust
pub(crate) fn applies(current: &str, source: Source, unless: Option<&str>) -> bool {
    match source {
        Source::User => true,
        Source::Hook => current != "archived" && unless != Some(current),
    }
}
```

`src/board/events.rs`:

```rust
//! `/api/board/events`: every card status change, pushed to open pages so
//! tab glyphs and the board update without a reload.

use crate::AppState;
use axum::{
    extract::{
        State,
        ws::{Message, WebSocketUpgrade},
    },
    response::Response,
};
use tokio::sync::broadcast::error::RecvError;

pub(super) async fn events(ws: WebSocketUpgrade, State(st): State<AppState>) -> Response {
    let mut rx = st.events.subscribe();
    ws.on_upgrade(move |mut socket| async move {
        loop {
            tokio::select! {
                ev = rx.recv() => {
                    let text = match ev {
                        Ok(ev) => serde_json::to_string(&ev).unwrap_or_default(),
                        // Missed some: the page re-reads the whole list.
                        Err(RecvError::Lagged(_)) => r#"{"resync":true}"#.to_owned(),
                        Err(RecvError::Closed) => break,
                    };
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                msg = socket.recv() => if !matches!(msg, Some(Ok(_))) { break },
            }
        }
    })
}
```

Add to `src/board/mod.rs` (above `#[cfg(test)]`):

```rust
mod events;
pub(crate) mod rules;

use crate::{
    AppState,
    error::internal_error,
    sessions::{SessionInfo, store},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
};
use rules::Source;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

/// A card's status changed; sent to every open page.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct BoardEvent {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) status_at: i64,
    pub(crate) note: Option<String>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/sessions/{id}/status", patch(set_status))
        .route("/api/board/events", get(events::events))
}

#[derive(Deserialize)]
struct SetStatus {
    status: String,
    note: Option<String>,
    source: Option<String>,
    unless: Option<String>,
}

const NOTE_CHARS: usize = 200;

async fn set_status(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SetStatus>,
) -> Result<Json<SessionInfo>, StatusCode> {
    if !STATUSES.contains(&body.status.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let source = if body.source.as_deref() == Some("user") { Source::User } else { Source::Hook };
    let note: Option<String> = body
        .note
        .map(|n| n.trim().chars().take(NOTE_CHARS).collect::<String>())
        .filter(|n| !n.is_empty());
    let db = st.db.lock().unwrap();
    let current: Option<String> = db
        .query_row("SELECT status FROM sessions WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(internal_error)?;
    let Some(current) = current else {
        return Err(StatusCode::NOT_FOUND);
    };
    let apply = rules::applies(&current, source, body.unless.as_deref());
    if apply {
        db.execute(
            "UPDATE sessions SET note = ?2,
                 status_at = CASE WHEN status = ?1 THEN status_at ELSE unixepoch() END,
                 status = ?1
             WHERE id = ?3",
            params![body.status, note, id],
        )
        .map_err(internal_error)?;
    }
    let info = store::info(&db, &id).map_err(internal_error)?.ok_or(StatusCode::NOT_FOUND)?;
    drop(db);
    if apply {
        let _ = st.events.send(BoardEvent {
            id: info.id.clone(),
            status: info.status.clone(),
            status_at: info.status_at,
            note: info.note.clone(),
        });
    }
    Ok(Json(info))
}
```

Note: SQLite evaluates every `SET` expression against the old row, so the `CASE` compares against the old `status` regardless of order.

`sessions/mod.rs`: make `store` reachable: change `pub(crate) mod store;` (already `pub(crate)`) and ensure `SessionInfo` is `pub(crate)` (Task 1).

`src/state.rs`:
- Add field to `AppState`:

```rust
    /// Card status changes, for `/api/board/events`.
    pub(crate) events: tokio::sync::broadcast::Sender<crate::board::BoardEvent>,
```

- `use crate::{board, files, sessions, settings, upload, web};` and `.merge(board::routes())` after `sessions::routes()`.
- In `every_route_is_guarded`'s `guarded_routes`, add `(Method::PATCH, "/api/sessions/x/status"),` and `(Method::GET, "/api/board/events"),`.

`src/main.rs` and `src/test_support.rs`: add `events: tokio::sync::broadcast::channel(256).0,` to the `AppState` literal.

- [ ] **Step 4: Run tests**

Run: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(board): status endpoint, hook rules and events socket"
```

---

### Task 3: Shell environment and first prompt (any agent)

**Files:**
- Modify: `src/board/mod.rs`, `src/sessions/pty.rs`, `src/sessions/mod.rs`, `src/state.rs`, `src/main.rs`, `src/test_support.rs`

**Interfaces:**
- Consumes: `store::{NewCard, insert_card}` (Task 1).
- Produces: `AppState.self_url: Arc<str>` (e.g. `http://127.0.0.1:7681`); `board::launch_line(command: &str, prompt: &str) -> String` (`DEFAULT_COMMAND = "claude {prompt}"`); `pty::shell_env(&AppState, &str) -> Vec<(&'static str, String)>`; `POST /api/sessions` body `{cwd?, name?, prompt?, command?}`.

- [ ] **Step 1: Write the failing tests**

Append to `src/board/mod.rs` `mod tests`:

```rust
    #[test]
    fn launch_line_passes_the_prompt_as_one_literal_argument() {
        let c = DEFAULT_COMMAND;
        assert_eq!(launch_line(c, "fix the login"), "claude 'fix the login'\r");
        assert_eq!(launch_line(c, "it's $(rm -rf ~) `x`"), "claude 'it'\\''s $(rm -rf ~) `x`'\r");
        assert_eq!(launch_line(c, "one\ntwo\r\n  three\t"), "claude 'one two three'\r");
    }

    #[test]
    fn launch_line_fits_any_agent() {
        assert_eq!(launch_line("gemini -i {prompt}", "hi"), "gemini -i 'hi'\r");
        assert_eq!(launch_line("codex", "hi"), "codex 'hi'\r", "appended when there's no {prompt}");
        assert_eq!(launch_line("  ", "hi"), "claude 'hi'\r", "blank means the default");
        assert_eq!(launch_line("a {prompt} b {prompt}", "x"), "a 'x' b 'x'\r");
        assert_eq!(launch_line("claude\n--x {prompt}", "x"), "claude --x 'x'\r", "one line only");
    }
```

Append to `src/sessions/pty.rs` (add `#[cfg(test)] mod tests` at the end):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;

    #[test]
    fn shells_know_their_card_and_the_daemon() {
        let st = test_state();
        let env = shell_env(&st, "abc-1");
        assert!(env.contains(&("TERM", "xterm-256color".into())));
        assert!(env.contains(&("TABSH_SESSION_ID", "abc-1".into())));
        assert!(env.contains(&("TABSH_URL", "http://127.0.0.1:7681".into())));
    }
}
```

Append to `src/sessions/mod.rs` `mod tests`:

```rust
    use axum::http::{Method, Request, StatusCode};
    use tower::ServiceExt;

    async fn create(st: &AppState, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/sessions")
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer t0k3n")
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(body.to_string()))
            .unwrap();
        let res = crate::state::router(st.clone()).oneshot(req).await.unwrap();
        let code = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (code, serde_json::from_slice(&bytes).unwrap_or_default())
    }

    #[tokio::test]
    async fn a_card_with_a_prompt_starts_its_agent_and_is_in_progress() {
        let st = test_state();
        let (code, body) = create(&st, serde_json::json!({"cwd": "/tmp", "name": " Fix login ", "prompt": "fix it"})).await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!((body["name"].as_str(), body["status"].as_str()), (Some("Fix login"), Some("in_progress")));
        let pending: Option<String> = st
            .db
            .lock()
            .unwrap()
            .query_row("SELECT pending_input FROM sessions WHERE id = ?1", [body["id"].as_str().unwrap()], |r| r.get(0))
            .unwrap();
        assert_eq!(pending.as_deref(), Some("claude 'fix it'\r"));
        let (_, body) = create(&st, serde_json::json!({"prompt": "hi", "command": "gemini -i {prompt}"})).await;
        let pending: Option<String> = st
            .db
            .lock()
            .unwrap()
            .query_row("SELECT pending_input FROM sessions WHERE id = ?1", [body["id"].as_str().unwrap()], |r| r.get(0))
            .unwrap();
        assert_eq!(pending.as_deref(), Some("gemini -i 'hi'\r"));
    }

    #[tokio::test]
    async fn a_card_without_a_prompt_is_a_backlog_shell() {
        let st = test_state();
        let (_, body) = create(&st, serde_json::json!({"name": "Docs", "prompt": "   "})).await;
        assert_eq!(body["status"], "backlog");
        let (_, body) = create(&st, serde_json::json!({})).await;
        assert_eq!(body["name"], "Terminal 2");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --lib`
Expected: compile errors (`launch_line`, `shell_env`, `self_url`).

- [ ] **Step 3: Implement**

`src/board/mod.rs`:

```rust
/// The agent a new card starts when the page names none.
pub(crate) const DEFAULT_COMMAND: &str = "claude {prompt}";

/// The line typed into a new card's shell to start its agent on its first
/// prompt. `command` is the agent's launch template (the user's own, from
/// the New card dialog); `{prompt}` becomes the prompt as one single-quoted
/// argument (so nothing in it runs), or the prompt is appended when the
/// template has no `{prompt}`. All on one line (a newline would submit
/// early), then Enter.
pub(crate) fn launch_line(command: &str, prompt: &str) -> String {
    let one_line = |t: &str| t.split_whitespace().collect::<Vec<_>>().join(" ");
    let command = match one_line(command) {
        c if c.is_empty() => DEFAULT_COMMAND.to_owned(),
        c => c,
    };
    let quoted = format!("'{}'", one_line(prompt).replace('\'', r"'\''"));
    let line = if command.contains("{prompt}") {
        command.replace("{prompt}", &quoted)
    } else {
        format!("{command} {quoted}")
    };
    format!("{line}\r")
}
```

`src/state.rs` `AppState`:

```rust
    /// This daemon's own address, given to shells as `TABSH_URL`.
    pub(crate) self_url: Arc<str>,
```

`src/main.rs`: after computing `host`/`port`:

```rust
    // Shells reach us on loopback even when we listen on every interface.
    let self_host = if host == "0.0.0.0" || host == "::" { "127.0.0.1" } else { host.as_str() };
    let self_url = format!("http://{self_host}:{port}");
```

and `self_url: self_url.into(),` in the `AppState` literal. `src/test_support.rs`: `self_url: "http://127.0.0.1:7681".into(),`.

`src/sessions/pty.rs`:

```rust
/// What every shell gets in its environment: hooks and `tabsh status` read
/// `TABSH_SESSION_ID` to know which card they belong to.
pub(super) fn shell_env(st: &AppState, id: &str) -> Vec<(&'static str, String)> {
    vec![
        ("TERM", "xterm-256color".into()),
        ("TABSH_SESSION_ID", id.into()),
        ("TABSH_URL", st.self_url.to_string()),
    ]
}
```

In `spawn_session`, replace `cmd.env("TERM", "xterm-256color");` with:

```rust
    for (k, v) in shell_env(&st, &id) {
        cmd.env(k, v);
    }
```

In `get_or_spawn`, read `pending_input` too and type it once the shell is up:

```rust
            "SELECT cwd, scrollback, pending_input FROM sessions WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, Option<String>>(2)?)),
        )
        .optional()?;
    let Some((cwd, scrollback, pending)) = row else {
        return Ok(None);
    };
    let session = spawn_session(st.clone(), id.to_owned(), cwd, scrollback)?;
    // The PTY buffers it until the shell reads its first line, so this is
    // safe to send before the prompt is drawn.
    if let Some(line) = pending {
        let _ = session.input.send(Bytes::from(line));
        st.db
            .lock()
            .unwrap()
            .execute("UPDATE sessions SET pending_input = NULL WHERE id = ?1", params![id])?;
    }
    live.insert(id.to_owned(), session.clone());
    Ok(Some(session))
```

`src/sessions/mod.rs`:

```rust
#[derive(Deserialize, Default)]
struct NewSession {
    cwd: Option<String>,
    name: Option<String>,
    prompt: Option<String>,
    command: Option<String>,
}
```

`create_session` body after the cwd check:

```rust
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let name: Option<String> = body
        .name
        .map(|n| n.trim().chars().take(100).collect::<String>())
        .filter(|n| !n.is_empty());
    let pending = body
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| crate::board::launch_line(body.command.as_deref().unwrap_or(crate::board::DEFAULT_COMMAND), p));
    let card = store::NewCard {
        cwd: body.cwd.as_deref(),
        name: name.as_deref(),
        status: if pending.is_some() { "in_progress" } else { "backlog" },
        pending: pending.as_deref(),
    };
    let db = st.db.lock().unwrap();
    store::insert_card(&db, &card).map(Json).map_err(internal_error)
```

(Move the existing `cwd` validity check to use `body.cwd` after the `let body = …` line.) If clippy flags `use store::insert_session;` as unused outside tests, change it to `#[cfg(test)] use store::insert_session;` (the existing `cwd_falls_back_to_the_saved_column` test needs it).

- [ ] **Step 4: Run tests**

Run: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(board): shells know their card; new cards can start their agent"
```

---

### Task 4: `tabsh status` CLI

**Files:**
- Create: `src/cli/mod.rs`, `src/cli/status.rs`
- Modify: `src/main.rs`

**Interfaces:**
- Consumes: `PATCH /api/sessions/{id}/status` (Task 2), `TABSH_SESSION_ID`/`TABSH_URL` (Task 3).
- Produces: `cli::run(&[String]) -> Option<i32>` (`None` = not a subcommand, start the daemon); `status::Env { session: Option<String>, url: String, token: Option<String> }`; `status::run(args: &[String], env: &Env, stdin: &mut dyn Read) -> i32`.

- [ ] **Step 1: Write the failing tests** — `src/cli/status.rs` test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sessions::store::insert_session, state::router, test_support::test_state};

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }
    fn env(session: Option<&str>, url: &str) -> Env {
        Env { session: session.map(String::from), url: url.into(), token: Some("t0k3n".into()) }
    }

    #[test]
    fn hook_mode_never_fails() {
        let e = env(None, "http://127.0.0.1:9");
        assert_eq!(run(&args("in_progress --hook"), &e, &mut &b""[..]), 0);
        let e = env(Some("x"), "http://127.0.0.1:9"); // nothing listens on port 9
        assert_eq!(run(&args("in_progress --hook"), &e, &mut &b""[..]), 0);
        assert_eq!(run(&args("bogus --hook"), &e, &mut &b""[..]), 0);
    }

    #[test]
    fn by_hand_errors_exit_1() {
        assert_eq!(run(&args("completed"), &env(None, "http://127.0.0.1:9"), &mut &b""[..]), 1);
        assert_eq!(run(&args("completed"), &env(Some("x"), "http://127.0.0.1:9"), &mut &b""[..]), 1);
        assert_eq!(run(&args("doing"), &env(Some("x"), "http://127.0.0.1:9"), &mut &b""[..]), 1);
        assert_eq!(run(&args(""), &env(Some("x"), "http://127.0.0.1:9"), &mut &b""[..]), 1);
    }

    #[test]
    fn parses_flags() {
        let p = parse(&args("needs_input --hook --if-not completed --note hi")).unwrap();
        assert_eq!((p.status.as_str(), p.hook, p.unless.as_deref(), p.note.as_deref()), ("needs_input", true, Some("completed"), Some("hi")));
        let p = parse(&["completed".into(), "--note".into(), "Added tests, all green".into()]).unwrap();
        assert_eq!(p.note.as_deref(), Some("Added tests, all green"));
        assert!(parse(&args("completed --note")).is_err());
    }

    #[test]
    fn a_hook_note_comes_from_the_notification_message() {
        let stdin = br#"{"hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}"#;
        assert_eq!(hook_message(&mut &stdin[..]).as_deref(), Some("Claude needs your permission to use Bash"));
        assert_eq!(hook_message(&mut &br#"{"prompt":"hi"}"#[..]), None);
        assert_eq!(hook_message(&mut &b"not json"[..]), None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_moves_a_real_card() {
        let st = test_state();
        let id = insert_session(&st.db.lock().unwrap(), None).unwrap().id;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = router(st.clone());
        tokio::spawn(async move { axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await });
        let (u, i) = (url.clone(), id.clone());
        let code = tokio::task::spawn_blocking(move || {
            run(&args("completed --note done"), &env(Some(&i), &u), &mut &b""[..])
        })
        .await
        .unwrap();
        assert_eq!(code, 0);
        let status: String = st.db.lock().unwrap()
            .query_row("SELECT status FROM sessions WHERE id = ?1", [&id], |r| r.get(0)).unwrap();
        assert_eq!(status, "completed");
        let code = tokio::task::spawn_blocking(move || run(&args("completed"), &env(Some("gone"), &url), &mut &b""[..]))
            .await
            .unwrap();
        assert_eq!(code, 1, "unknown session by hand is an error");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --lib cli`
Expected: compile errors (module missing).

- [ ] **Step 3: Implement**

`src/cli/mod.rs`:

```rust
//! Subcommands on the daemon's binary: `tabsh status` (what a coding agent's
//! hooks run inside a tabsh terminal) and `tabsh setup` (the guide an agent
//! follows to wire its own hooks to it).

mod setup;
mod status;

const USAGE: &str = "usage:
  tabsh [port]                         start the daemon (default port 7681)
  tabsh status <status> [--note <text>] [--if-not <status>] [--hook]
                                       set this terminal's card status:
                                       backlog, in_progress, needs_input, completed, archived
  tabsh setup                          print the guide a coding agent follows to keep
                                       its card current (\"run `tabsh setup` and follow it\")";

/// Runs a subcommand and returns its exit code, or `None` when `args` (the
/// command line without the program name) means "start the daemon".
pub(crate) fn run(args: &[String]) -> Option<i32> {
    match args.first().map(String::as_str) {
        Some("status") => Some(status::run(&args[1..], &status::Env::from_process(), &mut std::io::stdin())),
        Some("setup") => Some(setup::run()),
        Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            Some(0)
        }
        _ => None,
    }
}
```

Until Task 5, create `src/cli/setup.rs` with only:

```rust
//! `tabsh setup`.

pub(super) fn run() -> i32 {
    eprintln!("tabsh setup: not implemented yet");
    1
}
```

`src/cli/status.rs`:

```rust
//! `tabsh status`: sets the card of the terminal it runs in. Hooks call it
//! with `--hook`, which must never disturb the agent: silent, always exit 0.

use crate::board::STATUSES;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

const TIMEOUT: Duration = Duration::from_millis(500);

/// What `tabsh status` reads from its surroundings.
pub(super) struct Env {
    pub(super) session: Option<String>,
    pub(super) url: String,
    pub(super) token: Option<String>,
}

impl Env {
    pub(super) fn from_process() -> Env {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        // The token sits next to the state database, as the daemon keeps it.
        let token_path = match var("TABSH_DB") {
            Some(db) => std::path::Path::new(&db).with_file_name("token"),
            None => std::path::Path::new(&var("HOME").unwrap_or_else(|| ".".into())).join(".tabsh/token"),
        };
        Env {
            session: var("TABSH_SESSION_ID"),
            url: var("TABSH_URL").unwrap_or_else(|| "http://127.0.0.1:7681".into()),
            token: std::fs::read_to_string(token_path).ok().map(|t| t.trim().to_owned()),
        }
    }
}

#[derive(Debug)]
pub(super) struct Parsed {
    pub(super) status: String,
    pub(super) note: Option<String>,
    pub(super) unless: Option<String>,
    pub(super) hook: bool,
}

pub(super) fn parse(args: &[String]) -> Result<Parsed, String> {
    let mut it = args.iter();
    let (mut status, mut note, mut unless, mut hook) = (None, None, None, false);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--hook" => hook = true,
            "--note" => note = Some(it.next().ok_or("--note needs a value")?.clone()),
            "--if-not" => unless = Some(it.next().ok_or("--if-not needs a status")?.clone()),
            s if !s.starts_with("--") && status.is_none() => status = Some(s.to_owned()),
            other => return Err(format!("unexpected argument '{other}'")),
        }
    }
    let status = status.ok_or("which status? backlog, in_progress, needs_input, completed or archived")?;
    for s in [Some(&status), unless.as_ref()].into_iter().flatten() {
        if !STATUSES.contains(&s.as_str()) {
            return Err(format!("unknown status '{s}' (use {})", STATUSES.join(", ")));
        }
    }
    Ok(Parsed { status, note, unless, hook })
}

/// The `message` of the hook event the agent writes on stdin (Claude Code's
/// and Gemini CLI's Notification payloads have one; other events don't).
pub(super) fn hook_message(stdin: &mut dyn Read) -> Option<String> {
    let mut buf = Vec::new();
    stdin.take(64 * 1024).read_to_end(&mut buf).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&buf).ok()?;
    v.get("message")?.as_str().map(String::from)
}

pub(super) fn run(args: &[String], env: &Env, stdin: &mut dyn Read) -> i32 {
    let hook = args.iter().any(|a| a == "--hook");
    match set(args, env, stdin) {
        Ok(()) => 0,
        Err(_) if hook => 0,
        Err(e) => {
            eprintln!("tabsh status: {e}");
            1
        }
    }
}

fn set(args: &[String], env: &Env, stdin: &mut dyn Read) -> Result<(), String> {
    let p = parse(args)?;
    let id = env.session.as_deref().ok_or("not inside a tabsh terminal (TABSH_SESSION_ID is not set)")?;
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("odd TABSH_SESSION_ID '{id}'"));
    }
    let note = p.note.or_else(|| if p.hook { hook_message(stdin) } else { None });
    let body = serde_json::json!({ "status": p.status, "note": note, "source": "hook", "unless": p.unless }).to_string();
    match patch(&env.url, env.token.as_deref(), id, &body)? {
        200 => Ok(()),
        404 => Err("this terminal's card no longer exists".into()),
        code => Err(format!("the daemon answered {code}")),
    }
}

/// A one-shot HTTP/1.1 PATCH over a plain socket: the daemon is on loopback
/// and this keeps the binary free of an HTTP client crate.
fn patch(url: &str, token: Option<&str>, id: &str, body: &str) -> Result<u16, String> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("TABSH_URL must start with http:// (got '{url}')"))?
        .split('/')
        .next()
        .unwrap_or_default();
    let unreachable = |e: std::io::Error| format!("can't reach the tabsh daemon at {url}: {e}");
    let addr = authority
        .to_socket_addrs()
        .map_err(unreachable)?
        .next()
        .ok_or_else(|| format!("can't resolve {authority}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(unreachable)?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(unreachable)?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(unreachable)?;
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    write!(
        stream,
        "PATCH /api/sessions/{id}/status HTTP/1.1\r\nHost: {authority}\r\n{auth}\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(unreachable)?;
    let mut head = [0u8; 12]; // "HTTP/1.1 200"
    stream.read_exact(&mut head).map_err(unreachable)?;
    std::str::from_utf8(&head[9..12])
        .ok()
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| "the daemon sent an odd answer".into())
}
```

`src/main.rs`: add `mod cli;` and split startup:

```rust
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = cli::run(&args) {
        std::process::exit(code);
    }
    daemon();
}

#[tokio::main]
async fn daemon() {
    // …the old body of `async fn main()`, unchanged…
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: all pass. Then smoke it by hand:

```bash
cargo build && ./target/debug/tabsh status completed; echo "exit=$?"
```

Expected: `tabsh status: not inside a tabsh terminal (TABSH_SESSION_ID is not set)` and `exit=1`. And `./target/debug/tabsh status completed --hook; echo "exit=$?"` → no output, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(cli): tabsh status sets the terminal's card"
```

---

### Task 5: `tabsh setup` and the agent setup guide

**Files:**
- Create: `src/cli/setup.md`
- Modify: `src/cli/setup.rs`

**Interfaces:**
- Consumes: `tabsh status` and its flags (Task 4).
- Produces: `setup::guide(exe: &str) -> String`; `setup::run() -> i32` (prints the guide, exit 0).

tabsh does not install anything. The guide is the whole integration: an agent reads it and wires
its own hooks to `tabsh status`. It is embedded in the binary so it always matches its version.

- [ ] **Step 1: Write the failing test** — `src/cli/setup.rs`:

```rust
//! `tabsh setup`: prints the guide a coding agent follows to keep its card on
//! the board current. tabsh never edits an agent's config itself: the agent
//! knows its own hooks better, and keeps knowing them when they change.

const GUIDE: &str = include_str!("setup.md");

/// The guide, with `{tabsh}` replaced by this binary, quoted for a shell.
pub(super) fn guide(exe: &str) -> String {
    todo!()
}

pub(super) fn run() -> i32 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_guide_names_this_binary_and_the_whole_contract() {
        let g = guide("/opt/my tabsh/tabsh");
        assert!(!g.contains("{tabsh}"));
        assert!(g.contains("'/opt/my tabsh/tabsh' status in_progress --hook"));
        assert!(g.contains("'/opt/my tabsh/tabsh' status needs_input --hook"));
        assert!(g.contains("status needs_input --hook --if-not completed --note 'Agent finished its turn'"));
        assert!(g.contains("status completed --note"));
        for must in ["Back up", "merge", "TABSH_SESSION_ID", "undo"] {
            assert!(g.contains(must), "guide must mention {must}");
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib cli::setup`
Expected: FAIL (`include_str!` can't find `setup.md`, then `todo!()` panics).

- [ ] **Step 3: Write the guide** — `src/cli/setup.md`:

````markdown
# Connect this coding agent to the tabsh board

You are a coding agent (Claude Code, Gemini CLI, Codex, …). The user runs you inside tabsh, where
every terminal is a card on a kanban board with the statuses backlog, in_progress, needs_input,
completed and archived. Set up your own hooks and instructions so you keep your card current.
tabsh does not know your config format; you do. Follow these steps and report back.

## The contract

Inside a tabsh terminal the environment has `TABSH_SESSION_ID`. These commands set that terminal's
card. With `--hook` they print nothing and always exit 0, even outside tabsh, so they are safe to
run from hooks that fire everywhere.

| When | Run |
|---|---|
| The user sends you a prompt | `{tabsh} status in_progress --hook` |
| You need permission or input from the user | `{tabsh} status needs_input --hook` |
| Your turn ends | `{tabsh} status needs_input --hook --if-not completed --note 'Agent finished its turn'` |
| The user's task is done (you decide; not a hook) | `{tabsh} status completed --note "<one line: what you did>"` |

`--hook` reads JSON on stdin and uses its `message` field as the card's note when there is one,
so a notification hook can pass its payload straight through. `--note` sets the note explicitly.

## Steps

1. **Find your mechanism.** Identify your own hook or notification system and its config file
   (for example Claude Code: `~/.claude/settings.json` hooks `UserPromptSubmit`, `Notification`,
   `Stop`; Gemini CLI: `~/.gemini/settings.json` hooks `BeforeAgent`, `Notification`,
   `AfterAgent`; Codex: `notify` in `~/.codex/config.toml`). Check your current documentation
   rather than trusting these examples.
2. **Back up** that config file next to itself with a `.bak` suffix before changing it.
3. **merge, never replace.** Add one entry per row of the contract that you have an event for.
   Keep every existing hook. If an entry that runs `tabsh status` is already there, update it
   instead of adding a second one, so running this setup again changes nothing.
4. **Map honestly.** If you have no event for a row (Codex, for example, has no "prompt sent"
   event), leave that row out. Never fake it with an event that means something else.
5. **Instruct yourself.** Add to your persistent instructions (a skill, `AGENTS.md`, `GEMINI.md`,
   or whatever you read at the start of every session) a short rule: when `TABSH_SESSION_ID` is
   set and the user's task is done (not paused, not waiting on them), run
   `{tabsh} status completed --note "<one line: what you did>"`; never set any other status
   yourself, because hooks handle those and archiving is the user's.
6. **Verify.** If `TABSH_SESSION_ID` is set, run `{tabsh} status needs_input --note "setup test"`
   and ask the user to confirm the card moved, then `{tabsh} status in_progress`. In any case run
   `env -u TABSH_SESSION_ID {tabsh} status needs_input --hook; echo $?` and check it prints `0`.
7. **Report** to the user: the file you changed and its backup path, which rows you wired to
   which events, which rows you could not wire and why, and how to undo it: remove the entries
   that run `tabsh status` and the instruction from step 5.
````

- [ ] **Step 4: Implement**

```rust
pub(super) fn guide(exe: &str) -> String {
    let quoted = format!("'{}'", exe.replace('\'', r"'\''"));
    GUIDE.replace("{tabsh}", &quoted)
}

pub(super) fn run() -> i32 {
    // The installed binary's own path, so hooks work even where `tabsh`
    // isn't on the PATH the agent's hooks run with.
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "tabsh".into());
    print!("{}", guide(&exe));
    0
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test && cargo clippy --all-targets -- -D warnings && cargo build && ./target/debug/tabsh setup | head -20`
Expected: all pass; the guide prints with this binary's absolute path in the table.

- [ ] **Step 6: Commit**

```bash
git add src/cli
git commit -m "feat(cli): tabsh setup prints the agent setup guide"
```

---

### Task 6: Board model (pure TypeScript)

**Files:**
- Create: `web/src/app/board/model.ts`, `web/src/app/board/model.test.ts`

**Interfaces:**
- Produces: `type Status`; `STATUSES: Status[]`; `COLUMNS: { status: Status; name: string }[]` (the four visible columns); `interface Card { status: Status; statusAt: number; note: string | null; cwd: string | null }`; `asStatus(v: unknown): Status`; `group<T extends { card: Card }>(items: T[]): Record<Status, T[]>`; `since(statusAt: number, nowSec: number): string`; `shortPath(p: string | null): string`; `recentFolders(items: { card: Card }[], limit?: number): string[]`; `dropOrder(items: { id: string; card: Card }[], movedId: string, status: Status, beforeId: string | null): string[]`.

- [ ] **Step 1: Write the failing test** — `web/src/app/board/model.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asStatus, type Card, dropOrder, group, recentFolders, shortPath, since } from './model.ts';

const card = (status: Card['status'], cwd: string | null = null, statusAt = 0): Card => ({
  status,
  statusAt,
  note: null,
  cwd,
});
const item = (id: string, status: Card['status'], cwd: string | null = null, statusAt = 0) => ({
  id,
  card: card(status, cwd, statusAt),
});

test('unknown statuses read as backlog', () => {
  assert.equal(asStatus('needs_input'), 'needs_input');
  assert.equal(asStatus('doing'), 'backlog');
  assert.equal(asStatus(undefined), 'backlog');
});

test('group keeps tab order within each status', () => {
  const g = group([item('a', 'completed'), item('b', 'backlog'), item('c', 'completed')]);
  assert.deepEqual(
    g.completed.map((x) => x.id),
    ['a', 'c'],
  );
  assert.deepEqual(g.archived, []);
});

test('since is short', () => {
  assert.equal(since(1000, 1030), 'now');
  assert.equal(since(1000, 1000 + 5 * 60), '5m');
  assert.equal(since(1000, 1000 + 3 * 3600), '3h');
  assert.equal(since(1000, 1000 + 2 * 86400), '2d');
  assert.equal(since(2000, 1000), 'now'); // clock skew
});

test('shortPath shortens home', () => {
  assert.equal(shortPath('/Users/jo/code/app'), '~/code/app');
  assert.equal(shortPath('/home/jo'), '~');
  assert.equal(shortPath('/tmp/x'), '/tmp/x');
  assert.equal(shortPath(null), '');
});

test('recent folders are unique, newest first', () => {
  const r = recentFolders([item('a', 'backlog', '/a', 1), item('b', 'backlog', '/b', 3), item('c', 'backlog', '/a', 5), item('d', 'backlog', null, 9)]);
  assert.deepEqual(r, ['/a', '/b']);
});

test('dropOrder puts the card before the target, or at the end of its column', () => {
  const items = [item('a', 'backlog'), item('b', 'in_progress'), item('c', 'backlog'), item('d', 'completed')];
  assert.deepEqual(dropOrder(items, 'd', 'backlog', 'c'), ['a', 'b', 'd', 'c']);
  assert.deepEqual(dropOrder(items, 'a', 'backlog', null), ['b', 'c', 'a', 'd']);
  assert.deepEqual(dropOrder(items, 'a', 'needs_input', null), ['b', 'c', 'd', 'a']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && node --test src/app/board/model.test.ts`
Expected: FAIL, cannot find module `./model.ts`.

- [ ] **Step 3: Implement** — `web/src/app/board/model.ts`:

```ts
// The board's data, with no DOM: statuses, columns, and the small
// calculations the view needs.

export type Status = 'backlog' | 'in_progress' | 'needs_input' | 'completed' | 'archived';
export const STATUSES: Status[] = ['backlog', 'in_progress', 'needs_input', 'completed', 'archived'];

// The board's columns; Archive is a collapsed extra at the end.
export const COLUMNS: { status: Status; name: string }[] = [
  { status: 'backlog', name: 'Backlog' },
  { status: 'in_progress', name: 'In progress' },
  { status: 'needs_input', name: 'Needs input' },
  { status: 'completed', name: 'Completed' },
];

export interface Card {
  status: Status;
  statusAt: number; // unix seconds
  note: string | null;
  cwd: string | null;
}

export const asStatus = (v: unknown): Status => (STATUSES.includes(v as Status) ? (v as Status) : 'backlog');

// Items by status, each list in the order given (the tab order).
export function group<T extends { card: Card }>(items: T[]): Record<Status, T[]> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, [] as T[]])) as Record<Status, T[]>;
  for (const x of items) out[x.card.status].push(x);
  return out;
}

// How long a card has been in its status: now, 5m, 3h, 2d.
export function since(statusAt: number, nowSec: number): string {
  const s = Math.max(0, nowSec - statusAt);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// A folder with the home directory written as ~.
export function shortPath(p: string | null): string {
  if (!p) return '';
  return p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~');
}

// The folders cards are in, most recently moved card first, without repeats.
export function recentFolders(items: { card: Card }[], limit = 8): string[] {
  const sorted = [...items].sort((a, b) => b.card.statusAt - a.card.statusAt);
  return [...new Set(sorted.map((x) => x.card.cwd).filter((c): c is string => !!c))].slice(0, limit);
}

// The whole tab order after dropping `movedId` into `status`'s column:
// before `beforeId`, or after that column's last card (at the very end when
// the column is empty).
export function dropOrder(
  items: { id: string; card: Card }[],
  movedId: string,
  status: Status,
  beforeId: string | null,
): string[] {
  const rest = items.filter((x) => x.id !== movedId);
  let at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
  if (at < 0) {
    const last = rest.map((x) => x.card.status).lastIndexOf(status);
    at = last < 0 ? rest.length : last + 1;
  }
  const ids = rest.map((x) => x.id);
  ids.splice(at, 0, movedId);
  return ids;
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npm test && npm run lint`
Expected: all pass (run `npm run format` first if biome reports formatting).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/board
git commit -m "feat(web): board model"
```

---

### Task 7: Card status on tabs and live events

**Files:**
- Create: `web/src/app/board/glyph.ts`, `web/src/app/board/status.ts`, `web/src/app/board/events.ts`
- Modify: `web/src/app/sessions/store.ts`, `web/src/app/sessions/terminal.ts`, `web/src/app/daemon/client.ts`, `web/src/app/main.ts`, `web/src/pages/app/index.astro`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: `model.ts` (Task 6); `PATCH /api/sessions/{id}/status`, `/api/board/events` (Task 2); `SessionInfo` fields (Task 1).
- Produces: `SessionInfo` gains `status: string; status_at: number; note: string | null; cwd: string | null`; `Session` gains `card: Card`; `glyphSvg(status: Status): string`; `cardOf(info: SessionInfo): Card`; `applyCard(s: Session, card: Card): void`; `onCardsChange(fn: () => void): void`; `setStatus(s: Session, status: Status): Promise<void>` (board drag, `source: 'user'`); `boardEventsUrl(): string`; `initBoardEvents(): void`.

- [ ] **Step 1: Implement the glyphs** — `web/src/app/board/glyph.ts`:

```ts
// Linear-style status glyphs, drawn in currentColor (needs input is coloured
// by CSS). Static markup only, never user text.
import type { Status } from './model.ts';

const svg = (body: string) =>
  `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">${body}</svg>`;
const ring = '<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"';

const GLYPHS: Record<Status, string> = {
  backlog: svg(`${ring} stroke-dasharray="2.2 2"/>`),
  in_progress: svg(`${ring}/><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>`),
  needs_input: svg('<circle cx="7" cy="7" r="6" fill="currentColor"/>'),
  completed: svg(
    '<circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M4.4 7.2l1.8 1.8 3.4-3.7" fill="none" stroke="var(--background)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  archived: svg(`${ring}/><path d="M4.5 7h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
};

export const glyphSvg = (status: Status): string => GLYPHS[status];

export const STATUS_NAMES: Record<Status, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  needs_input: 'Needs input',
  completed: 'Completed',
  archived: 'Archived',
};
```

- [ ] **Step 2: Implement card state** — `web/src/app/board/status.ts`:

```ts
// Each tab's card: its status on the tab (a glyph), archived tabs out of the
// strip, a bell when a card starts needing you, and listeners (the board).
import { api } from '../daemon/client.ts';
import { ring } from '../sessions/bell.ts';
import type { Session, SessionInfo } from '../sessions/store.ts';
import { glyphSvg, STATUS_NAMES } from './glyph.ts';
import { asStatus, type Card, type Status } from './model.ts';

const listeners: (() => void)[] = [];
export function onCardsChange(fn: () => void): void {
  listeners.push(fn);
}
export function cardsChanged(): void {
  for (const fn of listeners) fn();
}

export const cardOf = (info: SessionInfo): Card => ({
  status: asStatus(info.status),
  statusAt: info.status_at ?? 0,
  note: info.note ?? null,
  cwd: info.cwd ?? null,
});

export function applyCard(s: Session, card: Card): void {
  const before = s.card?.status;
  s.card = card;
  const glyph = s.tab.querySelector('.tab-status') as HTMLElement;
  if (glyph.dataset.status !== card.status) {
    glyph.dataset.status = card.status;
    glyph.innerHTML = glyphSvg(card.status); // static markup from glyph.ts
  }
  glyph.title = card.note ? `${STATUS_NAMES[card.status]}: ${card.note}` : STATUS_NAMES[card.status];
  s.tab.classList.toggle('archived', card.status === 'archived');
  if (before && before !== 'needs_input' && card.status === 'needs_input') ring(s);
  cardsChanged();
}

// A drag on the board: always applies.
export async function setStatus(s: Session, status: Status): Promise<void> {
  const info = await api<SessionInfo>('PATCH', `/${s.id}/status`, { status, source: 'user' });
  if (info) applyCard(s, cardOf(info));
}
```

- [ ] **Step 3: Implement the events socket** — add to `web/src/app/daemon/client.ts`:

```ts
// The socket telling the page when a card's status changes.
export function boardEventsUrl(): string {
  const token = getToken();
  const auth = token ? `?token=${token}` : '';
  return `${DAEMON.replace(/^http/, 'ws')}/api/board/events${auth}`;
}
```

`web/src/app/board/events.ts`:

```ts
// Card status changes pushed by the daemon (hooks, other browsers). A
// dropped socket reconnects and re-reads the list, so nothing is missed.
import { boardEventsUrl } from '../daemon/client.ts';
import { store, sync } from '../sessions/store.ts';
import { asStatus } from './model.ts';
import { applyCard } from './status.ts';

interface BoardEvent {
  id: string;
  status: string;
  status_at: number;
  note: string | null;
  resync?: boolean;
}

export function initBoardEvents(): void {
  const ws = new WebSocket(boardEventsUrl());
  ws.onopen = () => void sync().catch(() => {});
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data) as BoardEvent;
    if (ev.resync) return void sync().catch(() => {});
    const s = store.sessions.find((x) => x.id === ev.id);
    if (s) applyCard(s, { ...s.card, status: asStatus(ev.status), statusAt: ev.status_at, note: ev.note });
  };
  ws.onclose = () => setTimeout(initBoardEvents, 1000);
}
```

- [ ] **Step 4: Wire into sessions**

`web/src/pages/app/index.astro`, in `#tab-template` before `<span class="tab-name">`: `<i class="tab-status" aria-hidden="true"></i>` (an `<i>` so `.tab span` selectors still match only the name).

`web/src/app/sessions/store.ts`:
- `import type { Card } from '../board/model.ts';` and `import { applyCard, cardOf } from '../board/status.ts';`
- `Session` gains `card: Card;`. `SessionInfo` becomes:

```ts
export interface SessionInfo {
  id: string;
  name: string;
  status: string;
  status_at: number;
  note: string | null;
  cwd: string | null;
}
```

- `shown` becomes: `store.sessions.filter((s) => s === store.active || (!s.tab.hidden && s.card.status !== 'archived'));`
- In `sync`, `if (s) setName(s, info.name, false);` becomes `if (s) { setName(s, info.name, false); applyCard(s, cardOf(info)); }`.
- `openTab(body?: { cwd?: string; name?: string; prompt?: string; command?: string })` (widen the type; `newCard` in Task 9 uses it). Export it: `export async function openTab(…)`.

`web/src/app/sessions/terminal.ts`: build `s` with `card: cardOf(info)` and call `applyCard(s, s.card);` right after `labelTab(s);` (import from `../board/status.ts`). `openSession` receives the whole `info`: change its signature to `openSession(info: SessionInfo)` and destructure `const { id, name } = info;` inside.

`web/src/app/main.ts`: `import { initBoardEvents } from './board/events.ts';` and call `initBoardEvents();` inside the startup IIFE right after `await sync();`.

`web/src/styles/app.css` (append):

```css
/* The kanban board's one colour: a card that needs you. */
:root { --needs-input: #f59e0b; }
.tab-status { display: inline-flex; flex-shrink: 0; margin-right: .375rem; color: var(--muted-foreground); }
.tab-status[data-status="needs_input"] { color: var(--needs-input); }
.tab-status[data-status="in_progress"] svg { animation: status-pulse 1.6s ease-in-out infinite; }
@keyframes status-pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .tab-status svg { animation: none !important; } }
.tab.archived { display: none; }
```

- [ ] **Step 5: Check**

Run: `cd web && npm test && npm run check && npm run lint`
Expected: pass. Then `cargo build && ./target/debug/tabsh 7799` and open the printed local URL; in a tab run `tabsh status needs_input --note test` with `./target/debug/tabsh` (its path): the tab's glyph turns amber and the favicon badges; `… status archived` hides the tab after switching away.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): card status glyphs on tabs, live board events"
```

---

### Task 8: Board view

**Files:**
- Create: `web/src/app/board/view.ts`
- Modify: `web/src/app/settings/keys.ts`, `web/src/app/settings/schema.ts`, `web/src/app/palette/pages.ts`, `web/src/app/palette/palette.ts`, `web/src/app/main.ts`, `web/src/pages/app/index.astro`, `web/src/styles/app.css`

**Interfaces:**
- Consumes: `model.ts` (Task 6); `status.ts`, `glyph.ts` (Task 7); `store`, `activate`, `closeSession`, `sendSize`, `api` and `orderTabs`.
- Produces: `toggleBoard(open?: boolean): void`; `initBoard(): void`; `KeyId` gains `'keyToggleBoard'`; `Settings.keyToggleBoard: string`. Task 9 adds `openNewCard(status)`; until then the column `+` calls `newSession()`.

- [ ] **Step 1: Keybinding** — `settings/keys.ts`: add `| 'keyToggleBoard'` to `KeyId` and to `keybindings()`:

```ts
    keyToggleBoard: {
      name: 'Toggle board',
      keywords: 'kanban cards tasks overview status',
      presets: isMac ? ['meta+KeyB', 'meta+shift+KeyB'] : ['ctrl+shift+KeyB', 'alt+shift+KeyB'],
    },
```

`settings/schema.ts`: add `keyToggleBoard: string;` to `Settings`, `keyToggleBoard: keys.keyToggleBoard.presets[0],` to `defaults`, `keyToggleBoard: '',` to `chosen`, and `keyToggleBoard: key('keyToggleBoard'),` to the returned object.

Run: `cd web && npm test` — expected PASS (the "presets never repeat" test covers the new presets).

- [ ] **Step 2: Markup** — `index.astro`:
- First child of `.tabbar`:

```html
    <button type="button" class="btn" data-variant="ghost" data-size="icon-sm" aria-label="Board" title="Board" id="board-btn" aria-pressed="false">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v12"/><path d="M15 3v7"/></svg>
    </button>
```

- Inside `<div id="main">`, before `<div id="terms">`: `<section id="board" hidden aria-label="Board"></section>`

- [ ] **Step 3: View** — `web/src/app/board/view.ts`:

```ts
// The board: the terminals as cards in status columns. Clicking a card goes
// to its terminal; dragging one sets its status and its place in the tab
// order. Names and notes are user text: textContent only.
import { api } from '../daemon/client.ts';
import { activate, closeSession, newSession, type Session, sendSize, store } from '../sessions/store.ts';
import { orderTabs } from '../sessions/tabs.ts';
import { matchesKey } from '../settings/keys.ts';
import { current } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { glyphSvg } from './glyph.ts';
import { COLUMNS, dropOrder, group, type Status, shortPath, since } from './model.ts';
import { onCardsChange, setStatus } from './status.ts';

const board = () => document.getElementById('board') as HTMLElement;
const terms = () => document.getElementById('terms') as HTMLElement;
const button = () => document.getElementById('board-btn') as HTMLButtonElement;
let archiveOpen = false;
// Set by Task 9; until then a column's + opens a plain new terminal.
let newCard: (status: Status) => void = () => void newSession();
export function setNewCard(fn: (status: Status) => void): void {
  newCard = fn;
}

export const boardOpen = (): boolean => !board().hidden;

export function toggleBoard(open = !boardOpen()): void {
  board().hidden = !open;
  terms().hidden = open;
  button().setAttribute('aria-pressed', String(open));
  if (open) render();
  else if (store.active) {
    sendSize(store.active);
    store.active.term.focus();
  }
}

function glyph(status: Status): HTMLElement {
  const g = el('i', { className: 'status-glyph' });
  g.dataset.status = status;
  g.innerHTML = glyphSvg(status); // static markup from glyph.ts
  return g;
}

const FOLDER =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

function cardEl(s: Session, now: number): HTMLElement {
  const top = el('div', { className: 'card-top' }, el('span', { className: 'card-title', textContent: s.name }), glyph(s.card.status));
  const folder = el('div', { className: 'card-meta' });
  folder.innerHTML = FOLDER; // static icon
  folder.append(el('span', { textContent: shortPath(s.card.cwd) || '~' }));
  const kids: HTMLElement[] = [top, folder];
  if (s.card.note) kids.push(el('div', { className: 'card-note', textContent: s.card.note }));
  kids.push(el('div', { className: 'card-meta', textContent: since(s.card.statusAt, now) }));
  const card = el('article', { className: 'board-card', draggable: true, tabIndex: 0 }, ...kids);
  card.dataset.id = s.id;
  card.onclick = () => {
    toggleBoard(false);
    activate(s);
  };
  card.onkeydown = (e) => e.key === 'Enter' && card.click();
  card.ondragstart = (e) => {
    e.dataTransfer?.setData('text/plain', s.id);
    card.classList.add('dragging');
  };
  card.ondragend = () => card.classList.remove('dragging');
  return card;
}

// The card the pointer is above the middle of, in `list`: the drop goes
// before it (null: at the end).
function cardBefore(list: HTMLElement, y: number): HTMLElement | null {
  for (const c of list.querySelectorAll<HTMLElement>('.board-card:not(.dragging)')) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) return c;
  }
  return null;
}

function clearDropMarks(): void {
  for (const x of board().querySelectorAll('.drop-before, .drop-end')) x.classList.remove('drop-before', 'drop-end');
}

async function move(id: string, status: Status, beforeId: string | null): Promise<void> {
  const s = store.sessions.find((x) => x.id === id);
  if (!s) return;
  const ids = dropOrder(store.sessions, id, status, beforeId);
  orderTabs(ids);
  api('PUT', '/order', { ids }).catch(() => {});
  if (s.card.status !== status) await setStatus(s, status).catch(console.error);
  else render();
}

function column(status: Status, name: string, cards: Session[], now: number): HTMLElement {
  const add = el('button', { type: 'button', className: 'btn', title: `New card in ${name}`, textContent: '+' });
  add.dataset.variant = 'ghost';
  add.dataset.size = 'icon-xs';
  add.setAttribute('aria-label', `New card in ${name}`);
  add.onclick = () => newCard(status);
  const header = el(
    'header',
    {},
    glyph(status),
    el('span', { className: 'col-name', textContent: name }),
    el('span', { className: 'col-count', textContent: String(cards.length) }),
    add,
  );
  const list = el('div', { className: 'board-cards' }, ...cards.map((s) => cardEl(s, now)));
  const col = el('section', { className: 'board-col' }, header, list);
  col.dataset.status = status;
  col.ondragover = (e) => {
    e.preventDefault();
    clearDropMarks();
    const before = cardBefore(list, e.clientY);
    if (before) before.classList.add('drop-before');
    else list.classList.add('drop-end');
  };
  col.ondragleave = (e) => !col.contains(e.relatedTarget as Node) && clearDropMarks();
  col.ondrop = (e) => {
    e.preventDefault();
    clearDropMarks();
    const id = e.dataTransfer?.getData('text/plain');
    if (id) void move(id, status, cardBefore(list, e.clientY)?.dataset.id ?? null);
  };
  return col;
}

function archive(cards: Session[], now: number): HTMLElement {
  const toggle = el('button', {
    type: 'button',
    className: 'archive-toggle',
    textContent: `Archive ${cards.length} ${archiveOpen ? '▾' : '▸'}`,
  });
  toggle.onclick = () => {
    archiveOpen = !archiveOpen;
    render();
  };
  const col = el('section', { className: 'board-col archive' }, toggle);
  if (archiveOpen) {
    for (const s of cards) {
      const restore = el('button', { type: 'button', className: 'btn', textContent: 'Restore' });
      const del = el('button', { type: 'button', className: 'btn', textContent: 'Delete' });
      for (const b of [restore, del]) {
        b.dataset.variant = 'ghost';
        b.dataset.size = 'sm';
      }
      restore.onclick = (e) => {
        e.stopPropagation();
        void setStatus(s, 'backlog');
      };
      del.onclick = (e) => {
        e.stopPropagation();
        void closeSession(s);
      };
      const card = cardEl(s, now);
      card.draggable = false;
      card.append(el('div', { className: 'card-actions' }, restore, del));
      col.append(card);
    }
  }
  return col;
}

export function render(): void {
  if (!boardOpen()) return;
  const now = Math.floor(Date.now() / 1000);
  const g = group(store.sessions);
  board().replaceChildren(
    ...COLUMNS.map(({ status, name }) => column(status, name, g[status], now)),
    archive(g.archived, now),
  );
}

export function initBoard(): void {
  button().onclick = () => toggleBoard();
  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesKey(e, current.saved.keyToggleBoard) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      toggleBoard();
    },
    true,
  );
  onCardsChange(render);
  setInterval(render, 30_000); // keep "time in status" fresh
}
```

Also call `render()` after tabs are added or removed: in `sessions/store.ts` `removeSession`, and in `terminal.ts` `openSession`, they already end in `applyCard` (open) — for removal add `cardsChanged()` (import from `../board/status.ts`) at the end of `removeSession`.

- [ ] **Step 4: Palette item and startup** — `palette/pages.ts`: add `toggleBoard(): void;` to the `ctx` type, and to the `Tabs` group's `items`, first:

```ts
            {
              label: 'Toggle board',
              icon: ICONS.filter,
              hint: keyLabel(saved.keyToggleBoard, isMac),
              keywords: 'kanban cards tasks status overview',
              run: ctx.toggleBoard,
            },
```

`palette/palette.ts`: in the `pages({ … })` call add `toggleBoard: () => toggleBoard(),` (import from `../board/view.ts`). `main.ts`: `import { initBoard } from './board/view.ts';` and call `initBoard();` after `initExplorer();`.

- [ ] **Step 5: Styles** — append to `web/src/styles/app.css`:

```css
/* The board: Linear-style columns in the theme's own tokens. */
#board { flex: 1; min-height: 0; display: flex; gap: .75rem; padding: .75rem; overflow-x: auto; background: var(--background); }
#board[hidden] { display: none; }
.board-col { flex: 0 0 18rem; display: flex; flex-direction: column; min-height: 0; }
.board-col > header { display: flex; align-items: center; gap: .5rem; padding: .25rem .25rem .5rem; font-size: .8125rem; font-weight: 500; }
.board-col .col-count { color: var(--muted-foreground); font-weight: 400; }
.board-col > header .btn { margin-left: auto; color: var(--muted-foreground); }
.board-cards { flex: 1; min-height: 3rem; overflow-y: auto; display: flex; flex-direction: column; gap: .5rem; padding: .125rem; border-radius: var(--radius, .5rem); }
.board-card { background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: calc(var(--radius, .5rem) - 2px); padding: .625rem .75rem; display: flex; flex-direction: column; gap: .375rem; cursor: pointer; font-size: .8125rem; }
.board-card:hover, .board-card:focus-visible { background: var(--accent); outline: none; }
.board-card.dragging { opacity: .4; }
.board-card.drop-before { box-shadow: 0 -2px 0 var(--muted-foreground); }
.board-cards.drop-end::after { content: ''; display: block; height: 2px; background: var(--muted-foreground); border-radius: 1px; }
.card-top { display: flex; align-items: flex-start; gap: .5rem; }
.card-title { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.card-meta { display: flex; align-items: center; gap: .375rem; color: var(--muted-foreground); font-size: .75rem; min-width: 0; }
.card-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-note { color: var(--muted-foreground); font-size: .75rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-actions { display: flex; gap: .25rem; }
.status-glyph { display: inline-flex; flex-shrink: 0; color: var(--muted-foreground); }
.status-glyph[data-status="needs_input"] { color: var(--needs-input); }
.board-col.archive { flex: 0 0 auto; min-width: 8rem; }
.board-col.archive.archive:has(.board-card) { flex-basis: 18rem; }
.archive-toggle { align-self: flex-start; background: none; border: 0; color: var(--muted-foreground); font: inherit; font-size: .8125rem; padding: .25rem; cursor: pointer; }
.archive .board-card { margin-top: .5rem; cursor: default; }
```

- [ ] **Step 6: Check**

Run: `cd web && npm test && npm run check && npm run lint`
Expected: pass. Manually (daemon from Task 7's check): ⌘B opens the board with every tab as a card; dragging a card to Needs input turns its tab glyph amber; dragging within a column reorders the tab strip; clicking a card returns to its terminal; switch theme with ⌘K and confirm the board follows it.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(web): the board view"
```

---

### Task 9: New card dialog (with agent command)

**Files:**
- Create: `web/src/app/board/new-card.ts`
- Modify: `web/src/pages/app/index.astro`, `web/src/app/main.ts`, `web/src/styles/app.css`, `web/src/app/settings/schema.ts`, `web/src/app/settings/schema.test.ts`, `web/src/app/board/model.ts`, `web/src/app/board/model.test.ts`

**Interfaces:**
- Consumes: `openTab({ cwd?, name?, prompt?, command? })` (Task 7), `current` and `saveSetting(key, value)` from `settings/settings.ts`, `recentFolders` (Task 6), `setNewCard`, `toggleBoard` (Task 8), `setStatus` (Task 7).
- Produces: `initNewCard(): void`; `openNewCard(status: Status): void`; `Settings.agentCommands: string[]` (most recent first, at most 8, default `['claude {prompt}']`); `model.rememberCommand(list: string[], command: string): string[]`.

- [ ] **Step 0: Agent commands, test first**

Append to `web/src/app/board/model.test.ts` (and add `rememberCommand` to its import):

```ts
test('used agent commands move to the front, without repeats, at most 8', () => {
  assert.deepEqual(rememberCommand(['claude {prompt}'], 'gemini -i {prompt}'), ['gemini -i {prompt}', 'claude {prompt}']);
  assert.deepEqual(rememberCommand(['a', 'b'], ' b '), ['b', 'a']);
  assert.deepEqual(rememberCommand(['a'], '   '), ['a']);
  assert.equal(rememberCommand(['1', '2', '3', '4', '5', '6', '7', '8'], '9').length, 8);
});
```

Append to `web/src/app/settings/schema.test.ts`:

```ts
test('agent commands are kept as a short list of strings', () => {
  assert.deepEqual(defaults(true).agentCommands, ['claude {prompt}']);
  assert.deepEqual(cleanSettings({ agentCommands: ['codex', 3, '', 'codex'] }, true).agentCommands, ['codex']);
  assert.deepEqual(cleanSettings({ agentCommands: 'nope' }, true).agentCommands, ['claude {prompt}']);
});
```

Run: `cd web && npm test` — expected FAIL (`rememberCommand`, `agentCommands` missing).

`model.ts`:

```ts
export const DEFAULT_COMMAND = 'claude {prompt}';

// The agent commands offered in New card: the one just used first.
export function rememberCommand(list: string[], command: string): string[] {
  const c = command.trim();
  if (!c) return list;
  return [c, ...list.filter((x) => x !== c)].slice(0, 8);
}
```

`schema.ts`: add `agentCommands: string[];` to `Settings`; `agentCommands: ['claude {prompt}'],` to `defaults`; and to `cleanSettings`'s returned object:

```ts
    agentCommands: (() => {
      const list = Array.isArray(stored.agentCommands)
        ? [...new Set(stored.agentCommands.filter((c): c is string => typeof c === 'string' && !!c.trim()))].slice(0, 8)
        : [];
      return list.length ? list : d.agentCommands;
    })(),
```

Run: `cd web && npm test` — expected PASS.

- [ ] **Step 1: Markup** — `index.astro`, after the `#about` dialog:

```html
  <dialog id="new-card" class="dialog" aria-labelledby="new-card-title">
    <form method="dialog" id="new-card-form">
      <header><h2 id="new-card-title">New card</h2></header>
      <section class="new-card-fields">
        <label class="label">Title <input class="input" name="name" required maxlength="100" autocomplete="off"></label>
        <label class="label">Folder <input class="input" name="cwd" list="new-card-folders" placeholder="~/code/app" autocomplete="off" spellcheck="false"></label>
        <datalist id="new-card-folders"></datalist>
        <label class="label">First prompt <span class="mark">(optional, starts the agent)</span>
          <textarea class="textarea" name="prompt" rows="3"></textarea></label>
        <label class="label">Agent <span class="mark">({prompt} is replaced by the prompt)</span>
          <input class="input" name="command" list="new-card-commands" autocomplete="off" spellcheck="false"></label>
        <datalist id="new-card-commands"></datalist>
        <p class="new-card-error" hidden></p>
      </section>
      <footer>
        <button type="button" class="btn" data-variant="outline" value="cancel">Cancel</button>
        <button type="submit" class="btn">Create</button>
      </footer>
    </form>
  </dialog>
```

- [ ] **Step 2: Implement** — `web/src/app/board/new-card.ts`:

```ts
// New card: a title, a folder (recent ones offered), an optional first
// prompt and the agent command to start on it (recent ones offered). With a
// prompt the terminal starts that agent and the card is In progress; without
// one it's a plain shell in the column it came from.
import { openTab, store } from '../sessions/store.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { DEFAULT_COMMAND, rememberCommand, type Status, recentFolders } from './model.ts';
import { setStatus } from './status.ts';
import { setNewCard, toggleBoard } from './view.ts';

const dialog = () => document.getElementById('new-card') as HTMLDialogElement;
let column: Status = 'backlog';

// `~/x` is the home directory's x: the daemon only takes absolute paths, so
// it's expanded with the home folder seen in other cards' paths.
function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = store.sessions.map((s) => s.card.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean);
  return home ? home + p.slice(1) : p;
}

export function openNewCard(status: Status): void {
  column = status;
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  form.reset();
  (form.querySelector('.new-card-error') as HTMLElement).hidden = true;
  const folders = recentFolders(store.sessions);
  (document.getElementById('new-card-folders') as HTMLDataListElement).replaceChildren(
    ...folders.map((f) => el('option', { value: f })),
  );
  (form.elements.namedItem('cwd') as HTMLInputElement).value = folders[0] ?? '';
  const commands = current.saved.agentCommands;
  (document.getElementById('new-card-commands') as HTMLDataListElement).replaceChildren(
    ...commands.map((c) => el('option', { value: c })),
  );
  (form.elements.namedItem('command') as HTMLInputElement).value = commands[0] ?? DEFAULT_COMMAND;
  dialog().showModal();
}

export function initNewCard(): void {
  const form = document.getElementById('new-card-form') as HTMLFormElement;
  const error = form.querySelector('.new-card-error') as HTMLElement;
  (form.querySelector('[value="cancel"]') as HTMLButtonElement).onclick = () => dialog().close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const cwd = expandHome(String(data.get('cwd') ?? '').trim());
    const prompt = String(data.get('prompt') ?? '').trim();
    const command = String(data.get('command') ?? '').trim() || DEFAULT_COMMAND;
    try {
      await openTab({ name, ...(cwd && { cwd }), ...(prompt && { prompt, command }) });
    } catch {
      error.textContent = cwd ? `No folder at ${cwd}` : "Couldn't create the card";
      error.hidden = false;
      return;
    }
    dialog().close();
    if (prompt) {
      // The next card offers it first.
      saveSetting('agentCommands', rememberCommand(current.saved.agentCommands, command));
    }
    const s = store.active;
    if (s && !prompt && column !== 'backlog') await setStatus(s, column).catch(() => {});
    toggleBoard(false);
  });
  setNewCard(openNewCard);
}
```

`main.ts`: `import { initNewCard } from './board/new-card.ts';` and `initNewCard();` after `initBoard();`.

`app.css`:

```css
.new-card-fields { display: flex; flex-direction: column; gap: .75rem; }
.new-card-fields .label { display: flex; flex-direction: column; gap: .375rem; }
.new-card-error { color: var(--destructive, #ef4444); font-size: .8125rem; margin: 0; }
```

- [ ] **Step 3: Check**

Run: `cd web && npm run check && npm run lint && npm test`
Expected: pass. Manually: `+` on Completed with no prompt makes a Completed card; with a prompt `say hi` in an existing folder, a new tab opens there typing `claude 'say hi'` and the card is In progress; changing Agent to `echo {prompt}` types `echo 'say hi'` and the next New card offers `echo {prompt}` first; a bad folder shows "No folder at …" and keeps the dialog open.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): new card dialog"
```

---

### Task 10: Embedded app, e2e and docs

**Files:**
- Create: `web/e2e/board.spec.ts`
- Modify: `src/app.html`, `src/app-assets/` (generated), `docs/architecture.md`, `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the e2e spec** — `web/e2e/board.spec.ts`:

```ts
// The board, end to end (no prompt, so the real `claude` never starts; the
// prompt path is covered by the daemon's tests): a new card lands in Backlog;
// a status set through the daemon's API (as `tabsh status` does) moves it and
// colours its tab; dragging moves it on; a name with markup stays text.
import type { Page } from '@playwright/test';
import { expect, openApp, test, typeInTerminal } from './fixture.ts';

const card = (page: Page, name: string) => page.locator('.board-card').filter({ hasText: name });
const col = (page: Page, status: string) => page.locator(`.board-col[data-status="${status}"]`);

test('cards move through the board', async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  await page.locator('#board-btn').click();
  await col(page, 'backlog').locator('header .btn').click();
  await page.locator('#new-card input[name="name"]').fill('Fix login');
  await page.locator('#new-card input[name="cwd"]').fill(project);
  await page.locator('#new-card button[type="submit"]').click();

  // Back on the terminal; the board shows the card in Backlog.
  await page.locator('#board-btn').click();
  await expect(col(page, 'backlog').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();

  const id = await card(page, 'Fix login').getAttribute('data-id');
  const res = await page.request.patch(`${daemon.baseUrl}/api/sessions/${id}/status`, {
    headers: { Authorization: `Bearer ${daemon.token}` },
    data: { status: 'needs_input', note: 'Claude needs your permission to use Bash' },
  });
  expect(res.status()).toBe(200);
  await expect(col(page, 'needs_input').locator('.board-card').filter({ hasText: 'Fix login' })).toContainText(
    'needs your permission',
  );
  await expect(page.locator(`#tabs .tab:has-text("Fix login") .tab-status`)).toHaveAttribute(
    'data-status',
    'needs_input',
  );

  await card(page, 'Fix login').dragTo(col(page, 'completed').locator('.board-cards'));
  await expect(col(page, 'completed').locator('.board-card').filter({ hasText: 'Fix login' })).toBeVisible();
});

test('a card name with markup is shown as text', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, "printf '\\033]0;<b>bold</b>\\007'");
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab[aria-selected="true"] span')).toHaveText('<b>bold</b>');
  }).toPass({ timeout: 10_000 });
  await page.locator('#board-btn').click();
  await expect(card(page, '<b>bold</b>').locator('.card-title')).toHaveText('<b>bold</b>');
  await expect(page.locator('.board-card b')).toHaveCount(0);
});
```

(`typeInTerminal` clicks `.term.active`; the second test opens no board before typing.)

- [ ] **Step 2: Build the embedded app and the daemon**

Run: `cd web && npm run build && cd .. && cargo build --locked`
Expected: `src/app.html` and `src/app-assets/` regenerated; build succeeds.

- [ ] **Step 3: Run all e2e specs**

Run: `cd web && npm run test:e2e`
Expected: `board.spec.ts` passes, and every existing spec still passes (in particular `smoke` and `tab-filter`, whose selectors use `.tab … span`).

- [ ] **Step 4: Docs** — `docs/architecture.md`:
- Daemon table: add rows
  - `| \`board/\` | The kanban board: card status columns and their migration (\`mod.rs\`), \`PATCH /api/sessions/{id}/status\` and \`launch_line\` (a new card's agent command and first prompt), \`rules.rs\` (hooks never touch archived cards; \`unless\`), \`events.rs\` (\`/api/board/events\`: status changes pushed to pages) |`
  - `| \`cli/\` | Subcommands on the same binary: \`status.rs\` (\`tabsh status\`, a one-shot loopback PATCH; \`--hook\` is silent and always exits 0), \`setup.rs\` and \`setup.md\` (\`tabsh setup\`: the guide an agent follows to wire its own hooks to \`tabsh status\`; tabsh never edits agent config) |`
- `main.rs` row: "Startup only: CLI dispatch (`cli::run`), then environment, …".
- `sessions/` row: append "; shells get `TABSH_SESSION_ID` and `TABSH_URL` (`pty::shell_env`) and type a card's pending first prompt once started".
- App table: add `| \`board/\` | \`model.ts\` (statuses, columns, grouping, drop order, no DOM), \`glyph.ts\`, \`status.ts\` (a tab's card: glyph, archived tabs hidden, bell on needs input), \`events.ts\` (the board events socket), \`view.ts\` (the board, drag and drop, ⌘B), \`new-card.ts\` (the New card dialog, with recent agent commands) |`

`README.md`: after the Features table add:

```markdown
## The board

Every terminal is a card on a kanban board (⌘B): Backlog, In progress,
Needs input, Completed, and a collapsed Archive. Drag cards to change their
status; click one to go to its terminal.

Let your coding agent keep the board current. Tell Claude Code, Gemini CLI,
Codex or any agent with hooks:

> Run `tabsh setup` and follow it.

It wires its own hooks to `tabsh status`: a prompt moves the card to In
progress, the agent stopping or asking permission moves it to Needs input,
and the agent marks it Completed when the task is done. Outside tabsh the
hooks do nothing. The agent reports what it changed and how to undo it.

New card (`+`) can start an agent on a first prompt: `claude {prompt}` by
default, or any command, such as `gemini -i {prompt}`.

`tabsh status <status> [--note <text>]` sets the card by hand.
```

- [ ] **Step 5: Full check and commit**

Run: `cargo test && cargo clippy --all-targets -- -D warnings && cd web && npm test && npm run check && npm run lint`
Expected: all pass.

```bash
git add src/app.html src/app-assets web/e2e/board.spec.ts docs/architecture.md README.md
git commit -m "feat: embed the board in the app; e2e and docs"
```

- [ ] **Step 6: Manual check with a real agent** (needs the user's Claude login)

```bash
cargo install --path . && tabsh
```

In a tabsh terminal, ask Claude Code: "Run `tabsh setup` and follow it." Check its report (file
changed, backup path, rows wired). Then in a new card with a prompt, confirm: In progress while
Claude works → Needs input with the permission text when it asks → Needs input "Agent finished
its turn" when it stops → Completed with Claude's note when it reports the task done. Optionally
repeat with Gemini CLI. Report results honestly, including any step that did not behave.
