//! The kanban board: every session is a card with a status, set by the
//! coding agent's hooks (through `tabsh status`) and by dragging cards on the board.

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
use rusqlite::{Connection, OptionalExtension, params};
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
    let source = if body.source.as_deref() == Some("user") {
        Source::User
    } else {
        Source::Hook
    };
    let note: Option<String> = body
        .note
        .map(|n| n.trim().chars().take(NOTE_CHARS).collect::<String>())
        .filter(|n| !n.is_empty());
    let db = st.db.lock().unwrap();
    let current: Option<String> = db
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
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
    let info = store::info(&db, &id)
        .map_err(internal_error)?
        .ok_or(StatusCode::NOT_FOUND)?;
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

/// Every status a card can have, in board order.
pub(crate) const STATUSES: [&str; 5] = [
    "backlog",
    "in_progress",
    "needs_input",
    "completed",
    "archived",
];

/// Adds the card columns to a `sessions` table that lacks them. SQLite can't
/// add a column with a non-constant default, so `status_at` starts at 0 and
/// is set to now for those rows.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('sessions')")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for (name, ddl) in [
        (
            "status",
            "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'",
        ),
        (
            "status_at",
            "ALTER TABLE sessions ADD COLUMN status_at INTEGER NOT NULL DEFAULT 0",
        ),
        ("note", "ALTER TABLE sessions ADD COLUMN note TEXT"),
        (
            "pending_input",
            "ALTER TABLE sessions ADD COLUMN pending_input TEXT",
        ),
    ] {
        if !cols.iter().any(|c| c == name) {
            conn.execute(ddl, [])?;
        }
    }
    conn.execute(
        "UPDATE sessions SET status_at = unixepoch() WHERE status_at = 0",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sessions::store::insert_session, state::router, test_support::test_state};
    use axum::http::{Method, Request, StatusCode};
    use tower::ServiceExt;

    async fn patch(
        st: &AppState,
        id: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
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
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    fn new_card(st: &AppState) -> String {
        insert_session(&st.db.lock().unwrap(), None).unwrap().id
    }

    #[tokio::test]
    async fn a_hook_moves_a_card_and_the_board_hears_it() {
        let st = test_state();
        let id = new_card(&st);
        let mut rx = st.events.subscribe();
        let (code, body) = patch(
            &st,
            &id,
            serde_json::json!({"status": "needs_input", "note": "  needs Bash  "}),
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body["status"], "needs_input");
        assert_eq!(body["note"], "needs Bash");
        let ev = rx.try_recv().unwrap();
        assert_eq!(
            (ev.id.as_str(), ev.status.as_str()),
            (id.as_str(), "needs_input")
        );
    }

    #[tokio::test]
    async fn bad_status_is_400_and_unknown_session_is_404() {
        let st = test_state();
        let id = new_card(&st);
        assert_eq!(
            patch(&st, &id, serde_json::json!({"status": "doing"}))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            patch(&st, "nope", serde_json::json!({"status": "backlog"}))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn hooks_skip_archived_and_unless_but_the_board_does_not() {
        let st = test_state();
        let id = new_card(&st);
        patch(
            &st,
            &id,
            serde_json::json!({"status": "archived", "source": "user"}),
        )
        .await;
        let mut rx = st.events.subscribe();
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "in_progress"})).await;
        assert_eq!(body["status"], "archived");
        assert!(rx.try_recv().is_err(), "no event when nothing changed");

        patch(
            &st,
            &id,
            serde_json::json!({"status": "completed", "source": "user"}),
        )
        .await;
        let (_, body) = patch(
            &st,
            &id,
            serde_json::json!({"status": "needs_input", "unless": "completed"}),
        )
        .await;
        assert_eq!(body["status"], "completed");
    }

    #[tokio::test]
    async fn status_at_only_moves_when_the_status_changes() {
        let st = test_state();
        let id = new_card(&st);
        st.db
            .lock()
            .unwrap()
            .execute("UPDATE sessions SET status_at = 5 WHERE id = ?1", [&id])
            .unwrap();
        let (_, body) = patch(
            &st,
            &id,
            serde_json::json!({"status": "backlog", "note": "x"}),
        )
        .await;
        assert_eq!(body["status_at"], 5);
        assert_eq!(body["note"], "x");
        let (_, body) = patch(&st, &id, serde_json::json!({"status": "in_progress"})).await;
        assert_ne!(body["status_at"], 5);
        assert_eq!(
            body["note"],
            serde_json::Value::Null,
            "a change without a note clears it"
        );
    }
}
