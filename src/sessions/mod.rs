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
    routing::{get, patch, post},
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
        .route("/api/sessions/{id}/activity", post(set_activity))
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
    Activity(Activity),
}

/// A tab's agent activity, as `tabsh hook <state>` reports it. Held in
/// memory on the running session only: after a daemon restart every tab
/// starts idle.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Activity {
    Idle,
    Running,
    NeedsInput,
}

impl Activity {
    fn parse(state: &str) -> Option<Self> {
        match state {
            "idle" => Some(Self::Idle),
            "running" => Some(Self::Running),
            "needs-input" => Some(Self::NeedsInput),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::NeedsInput => "needs-input",
        }
    }
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

impl Session {
    /// Sets the tab's agent activity, telling attached clients when it
    /// actually changed.
    fn set_activity(&self, activity: Activity) {
        let mut out = self.output.lock().unwrap();
        if out.activity == activity {
            return;
        }
        out.activity = activity;
        let _ = out.tx.send(Event::Activity(activity));
    }
}

struct Output {
    scrollback: VecDeque<u8>,
    /// Terminal modes in effect where the scrollback starts, i.e. set by
    /// output that has since been trimmed off the front.
    trimmed_modes: ModeTracker,
    tx: broadcast::Sender<Event>,
    exited: bool,
    /// The tab's agent activity (`tabsh hook`, cli/hook.rs).
    activity: Activity,
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

/// `tabsh hook <state>` (cli/hook.rs): set a tab's agent activity. The
/// state lives on the running session, so a tab whose shell isn't running
/// is unknown here; an unparseable or unknown state is the caller's
/// mistake to see.
async fn set_activity(
    State(st): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> StatusCode {
    let state = serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| {
            v.get("state")
                .and_then(|s| s.as_str())
                .and_then(Activity::parse)
        });
    let Some(state) = state else {
        return StatusCode::BAD_REQUEST;
    };
    let Some(session) = st.live.lock().unwrap().get(&id).cloned() else {
        return StatusCode::NOT_FOUND;
    };
    session.set_activity(state);
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::http::{Method, Request, StatusCode};
    use tower::ServiceExt;

    #[test]
    fn cwd_falls_back_to_the_saved_column() {
        let st = test_state();
        let info = insert_session(&st.db.lock().unwrap(), Some("/tmp")).unwrap();
        assert_eq!(cwd(&st, &info.id), Some(PathBuf::from("/tmp")));
        assert_eq!(cwd(&st, "missing"), None);
    }

    /// POSTs `body` to the activity route through the full router.
    async fn post_activity(
        st: &AppState,
        id: &str,
        body: &str,
        headers: &[(&str, &str)],
    ) -> StatusCode {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(format!("/api/sessions/{id}/activity"))
            .header("Host", "127.0.0.1:7681");
        for &(name, value) in headers {
            builder = builder.header(name, value);
        }
        let req = builder
            .body(axum::body::Body::from(body.to_owned()))
            .unwrap();
        crate::state::router(st.clone())
            .oneshot(req)
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn activity_route_sets_the_state_and_validates() {
        let st = test_state();
        let info = insert_session(&st.db.lock().unwrap(), None).unwrap();
        let s = pty::get_or_spawn(&st, &info.id).unwrap().unwrap();
        let auth = ("Authorization", "Bearer t0k3n");

        // A known state on a running session: 204, and the session now has it.
        assert_eq!(
            post_activity(&st, &info.id, r#"{"state":"running"}"#, &[auth]).await,
            StatusCode::NO_CONTENT
        );
        assert_eq!(s.output.lock().unwrap().activity, Activity::Running);

        // Unknown or malformed bodies: 400.
        for body in [r#"{"state":"stopped"}"#, r#"{"state":"running"#, r#"{}"#] {
            assert_eq!(
                post_activity(&st, &info.id, body, &[auth]).await,
                StatusCode::BAD_REQUEST,
                "{body}"
            );
        }

        // Unknown session, or one whose shell isn't running: 404.
        assert_eq!(
            post_activity(&st, "missing", r#"{"state":"idle"}"#, &[auth]).await,
            StatusCode::NOT_FOUND
        );
        let row = insert_session(&st.db.lock().unwrap(), None).unwrap();
        assert_eq!(
            post_activity(&st, &row.id, r#"{"state":"idle"}"#, &[auth]).await,
            StatusCode::NOT_FOUND
        );

        let _ = s.killer.lock().unwrap().kill();
    }

    #[tokio::test]
    async fn activity_route_is_refused_without_credentials() {
        let st = test_state();
        let info = insert_session(&st.db.lock().unwrap(), None).unwrap();
        let s = pty::get_or_spawn(&st, &info.id).unwrap().unwrap();

        // Without an Origin a local program must present the token.
        assert_eq!(
            post_activity(&st, &info.id, r#"{"state":"idle"}"#, &[]).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post_activity(
                &st,
                &info.id,
                r#"{"state":"idle"}"#,
                &[("Authorization", "Bearer wrong")]
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
        // A browser page with a foreign Origin is refused outright.
        assert_eq!(
            post_activity(
                &st,
                &info.id,
                r#"{"state":"idle"}"#,
                &[("Origin", "https://evil.example")]
            )
            .await,
            StatusCode::FORBIDDEN
        );

        let _ = s.killer.lock().unwrap().kill();
    }

    #[test]
    fn setting_the_same_activity_broadcasts_once() {
        let st = test_state();
        let info = insert_session(&st.db.lock().unwrap(), None).unwrap();
        let s = pty::get_or_spawn(&st, &info.id).unwrap().unwrap();
        let mut rx = s.output.lock().unwrap().tx.subscribe();

        s.set_activity(Activity::NeedsInput);
        s.set_activity(Activity::NeedsInput); // unchanged: not sent again
        s.set_activity(Activity::Running);

        assert!(matches!(
            rx.try_recv(),
            Ok(Event::Activity(Activity::NeedsInput))
        ));
        assert!(matches!(
            rx.try_recv(),
            Ok(Event::Activity(Activity::Running))
        ));
        assert!(matches!(
            rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));

        let _ = s.killer.lock().unwrap().kill();
    }
}
