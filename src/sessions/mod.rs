//! Shells that run in PTYs and outlive the browser tabs attached to them.

mod modes;
pub(crate) mod pty;
pub(crate) mod store;
mod ws;

use crate::{AppState, error::internal_error};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
};
use modes::ModeTracker;
use portable_pty::{ChildKiller, MasterPty};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, path::PathBuf, sync::Mutex, time::Duration};
use store::insert_session;
use tokio::sync::broadcast;

pub(crate) use pty::SHUTTING_DOWN;
pub(crate) use store::{flush, open_db};

/// The tab list and the socket each tab attaches through.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route(
            "/api/sessions/{id}",
            patch(rename_session).delete(delete_session),
        )
        .route("/ws", get(ws::ws_handler))
}

/// A session's working directory: its shell's live one, else the last one
/// saved.
pub(crate) fn cwd(st: &AppState, id: &str) -> Option<PathBuf> {
    let pid = st.live.lock().unwrap().get(id).and_then(|s| s.pid);
    pid.and_then(pty::process_cwd)
        .or_else(|| {
            st.db
                .lock()
                .unwrap()
                .query_row("SELECT cwd FROM sessions WHERE id = ?1", params![id], |r| {
                    r.get::<_, Option<String>>(0)
                })
                .optional()
                .ok()
                .flatten()
                .flatten()
        })
        .map(PathBuf::from)
}

/// Running shells and all sessions, for the About dialog.
pub(crate) fn counts(st: &AppState) -> rusqlite::Result<(usize, i64)> {
    let running = st.live.lock().unwrap().len();
    let total = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?;
    Ok((running, total))
}

/// Output kept per session so a reconnecting client can redraw its screen.
const SCROLLBACK_BYTES: usize = 512 * 1024;
/// How often changed scrollback and cwd are written to the database.
pub(crate) const FLUSH_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone)]
enum Event {
    Output(Bytes),
    Exit,
}

/// A shell running in a PTY. It outlives any single WebSocket so a browser
/// reload can reattach; it ends when the shell exits or a client kills it.
pub(crate) struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: std::sync::mpsc::Sender<Bytes>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    // Scrollback and broadcast are updated under one lock so a new subscriber
    // sees every byte exactly once: replayed history, then live output.
    output: Mutex<Output>,
}

struct Output {
    scrollback: VecDeque<u8>,
    /// Terminal modes in effect where the scrollback starts, i.e. set by
    /// output that has since been trimmed off the front.
    trimmed_modes: ModeTracker,
    tx: broadcast::Sender<Event>,
    exited: bool,
    /// Scrollback changed since the last flush to the database.
    dirty: bool,
}

#[derive(Serialize)]
struct SessionInfo {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct Rename {
    name: String,
}

#[derive(Deserialize, Default)]
struct NewSession {
    cwd: Option<String>,
}

async fn list_sessions(State(st): State<AppState>) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let db = st.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, name FROM sessions ORDER BY position")
        .map_err(internal_error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionInfo {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(internal_error)?;
    Ok(Json(rows))
}

async fn create_session(
    State(st): State<AppState>,
    body: Option<Json<NewSession>>,
) -> Result<Json<SessionInfo>, StatusCode> {
    let cwd = body.as_ref().and_then(|b| b.cwd.as_deref());
    if let Some(cwd_path) = cwd
        && !std::path::Path::new(cwd_path).is_dir()
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let db = st.db.lock().unwrap();
    insert_session(&db, cwd).map(Json).map_err(internal_error)
}

async fn rename_session(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Rename>,
) -> StatusCode {
    let name: String = body.name.trim().chars().take(100).collect();
    if name.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    match st.db.lock().unwrap().execute(
        "UPDATE sessions SET name = ?1 WHERE id = ?2",
        params![name, id],
    ) {
        Ok(0) => StatusCode::NOT_FOUND,
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) => internal_error(e),
    }
}

/// Close a tab. A running shell is killed and its reader thread removes the
/// row (and tells attached clients); a not-yet-restored one is just deleted.
async fn delete_session(State(st): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let live = st.live.lock().unwrap();
    if let Some(session) = live.get(&id) {
        let _ = session.killer.lock().unwrap().kill();
        return StatusCode::NO_CONTENT;
    }
    match st
        .db
        .lock()
        .unwrap()
        .execute("DELETE FROM sessions WHERE id = ?1", params![id])
    {
        Ok(0) => StatusCode::NOT_FOUND,
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) => internal_error(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;

    #[test]
    fn cwd_falls_back_to_the_saved_column() {
        let st = test_state();
        let info = insert_session(&st.db.lock().unwrap(), Some("/tmp")).unwrap();
        assert_eq!(cwd(&st, &info.id), Some(PathBuf::from("/tmp")));
        assert_eq!(cwd(&st, "missing"), None);
    }
}
