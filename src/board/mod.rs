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

/// The agent a new card starts when the page names none.
pub(crate) const DEFAULT_COMMAND: &str = "claude {prompt}";

/// The short line typed into a new card's shell to start its agent. The
/// prompt itself travels in the shell's environment as `TABSH_PROMPT` (a PTY
/// in canonical mode cuts a typed line at 1024 bytes on macOS), so `command`
/// (the agent's launch template) gets `"$TABSH_PROMPT"` where `{prompt}` is,
/// or appended when it has none. That double-quoted expansion is one literal
/// argument in POSIX shells and fish alike. All on one line (a newline would
/// submit early) and free of control characters (which the PTY would take as
/// keystrokes), then Enter.
pub(crate) fn launch_line(command: &str) -> String {
    let command = one_line(command);
    let command = if command.is_empty() {
        DEFAULT_COMMAND.to_owned()
    } else {
        command
    };
    let line = if command.contains("{prompt}") {
        command.replace("{prompt}", PROMPT_ARG)
    } else {
        format!("{command} {PROMPT_ARG}")
    };
    format!("{line}\r")
}

const PROMPT_ARG: &str = "\"$TABSH_PROMPT\"";

/// A card's title made from its prompt: the first line with text, its
/// whitespace collapsed and control characters dropped, cut at
/// `PROMPT_TITLE_CHARS` with an ellipsis. `None` when nothing is left.
pub(crate) fn prompt_title(prompt: &str) -> Option<String> {
    let line = prompt.lines().map(one_line).find(|l| !l.is_empty())?;
    if line.chars().count() <= PROMPT_TITLE_CHARS {
        return Some(line);
    }
    let cut: String = line.chars().take(PROMPT_TITLE_CHARS - 1).collect();
    Some(format!("{}…", cut.trim_end()))
}

const PROMPT_TITLE_CHARS: usize = 60;

/// A command as one line of plain words: whitespace runs (newlines too)
/// become one space and control characters are dropped.
pub(crate) fn one_line(command: &str) -> String {
    command
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// How a card made without a provider's resume command resumes a Claude
/// Code agent run in it by hand.
const CLAUDE_RESUME: &str = "claude --resume {session}";

/// The line that reopens an agent's conversation in a fresh shell after tabsh
/// restarts, once the agent's hooks have reported in. `template` is the
/// card's resume command (its provider's), whose `{session}` becomes the
/// conversation id the hook named; without one, an agent known by `agent`
/// gets its usual command. `None` when nothing fits, and whenever `{session}`
/// is wanted but the id isn't a plain token: the line is typed into a shell.
pub(crate) fn resume_line(
    template: Option<&str>,
    agent: Option<&str>,
    session: Option<&str>,
) -> Option<String> {
    let template = match template.filter(|t| !t.is_empty()) {
        Some(t) => t,
        None if agent == Some("claude") => CLAUDE_RESUME,
        None => return None,
    };
    if !template.contains("{session}") {
        return Some(format!("{template}\r"));
    }
    let session = session.filter(|s| {
        (1..=128).contains(&s.len())
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    })?;
    Some(format!("{}\r", template.replace("{session}", session)))
}

/// A card's status changed; sent to every open page.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct BoardEvent {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) status_at: i64,
    pub(crate) note: Option<String>,
    /// Who changed it: "user" (the board) or "hook" (the agent, through
    /// `tabsh status`). Pages notify only for a hook's change.
    pub(crate) source: &'static str,
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
    /// The agent the hook runs under and its conversation, so a restart can
    /// resume it.
    agent: Option<String>,
    agent_session: Option<String>,
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
    let row: Option<(String, Option<String>)> = db
        .query_row(
            "SELECT status, resume_command FROM sessions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(internal_error)?;
    let Some((current, template)) = row else {
        return Err(StatusCode::NOT_FOUND);
    };
    // A hook means an agent is running in the card: a restart resumes it.
    let resume = (source == Source::Hook)
        .then(|| {
            resume_line(
                template.as_deref(),
                body.agent.as_deref(),
                body.agent_session.as_deref(),
            )
        })
        .flatten();
    if let Some(line) = resume {
        db.execute(
            "UPDATE sessions SET resume_input = ?1 WHERE id = ?2",
            params![line, id],
        )
        .map_err(internal_error)?;
    }
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
    if apply && rules::launches(&body.status, source) {
        crate::sessions::launch(&st, &id);
    }
    if apply {
        let _ = st.events.send(BoardEvent {
            id: info.id.clone(),
            status: info.status.clone(),
            status_at: info.status_at,
            note: info.note.clone(),
            source: match source {
                Source::User => "user",
                Source::Hook => "hook",
            },
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
        (
            "pending_prompt",
            "ALTER TABLE sessions ADD COLUMN pending_prompt TEXT",
        ),
        (
            "pinned",
            "ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "resume_command",
            "ALTER TABLE sessions ADD COLUMN resume_command TEXT",
        ),
        (
            "resume_input",
            "ALTER TABLE sessions ADD COLUMN resume_input TEXT",
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
            (ev.id.as_str(), ev.status.as_str(), ev.source),
            (id.as_str(), "needs_input", "hook")
        );
    }

    #[tokio::test]
    async fn the_board_hears_who_moved_a_card() {
        let st = test_state();
        let id = new_card(&st);
        let mut rx = st.events.subscribe();
        patch(
            &st,
            &id,
            serde_json::json!({"status": "completed", "source": "user"}),
        )
        .await;
        assert_eq!(rx.try_recv().unwrap().source, "user");
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

    #[test]
    fn launch_line_is_short_and_reads_the_prompt_from_the_environment() {
        assert_eq!(launch_line(DEFAULT_COMMAND), "claude \"$TABSH_PROMPT\"\r");
        assert_eq!(
            launch_line("gemini -i {prompt}"),
            "gemini -i \"$TABSH_PROMPT\"\r"
        );
        assert_eq!(
            launch_line("codex"),
            "codex \"$TABSH_PROMPT\"\r",
            "appended when there's no {{prompt}}"
        );
        assert_eq!(
            launch_line("  "),
            "claude \"$TABSH_PROMPT\"\r",
            "blank means the default"
        );
        assert_eq!(
            launch_line("a {prompt} b {prompt}"),
            "a \"$TABSH_PROMPT\" b \"$TABSH_PROMPT\"\r"
        );
    }

    #[test]
    fn a_prompt_title_is_its_first_line_cut_short() {
        assert_eq!(
            prompt_title("\n  Fix the\tlogin   bug\nthen tests").as_deref(),
            Some("Fix the login bug")
        );
        assert_eq!(prompt_title(" \n\u{1b}\n").as_deref(), None);
        let long = prompt_title(&"word ".repeat(40)).unwrap();
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with("word…"), "{long}");
    }

    #[test]
    fn launch_line_drops_control_characters_and_newlines() {
        assert_eq!(
            launch_line("claude\n--x {prompt}"),
            "claude --x \"$TABSH_PROMPT\"\r"
        );
        assert_eq!(
            launch_line("\u{1b}[A\u{3}claude\u{7f} {prompt}"),
            "[Aclaude \"$TABSH_PROMPT\"\r"
        );
    }

    #[test]
    fn resume_line_fills_in_plain_session_ids_only() {
        let codex = Some("codex resume {session}");
        assert_eq!(
            resume_line(codex, None, Some("3f1c-9a_B")).as_deref(),
            Some("codex resume 3f1c-9a_B\r")
        );
        assert_eq!(resume_line(codex, None, None), None);
        assert_eq!(resume_line(codex, None, Some("")), None);
        assert_eq!(resume_line(codex, None, Some("a; rm -rf ~")), None);
        assert_eq!(resume_line(codex, None, Some("a\rb")), None);
        assert_eq!(resume_line(codex, None, Some(&"a".repeat(129))), None);
        assert_eq!(
            resume_line(Some("codex resume --last"), None, None).as_deref(),
            Some("codex resume --last\r"),
            "a command without {{session}} needs no id"
        );
    }

    #[test]
    fn without_a_resume_command_only_claude_code_resumes() {
        assert_eq!(
            resume_line(None, Some("claude"), Some("s-1")).as_deref(),
            Some("claude --resume s-1\r")
        );
        assert_eq!(
            resume_line(Some(""), Some("claude"), Some("s-1")).as_deref(),
            Some("claude --resume s-1\r")
        );
        assert_eq!(resume_line(None, None, Some("s-1")), None);
        assert_eq!(resume_line(None, Some("vim"), Some("s-1")), None);
    }

    fn resume_input(st: &AppState, id: &str) -> Option<String> {
        st.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT resume_input FROM sessions WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[tokio::test]
    async fn a_hook_fills_in_the_cards_resume_command() {
        let st = test_state();
        let id = crate::sessions::store::insert_card(
            &st.db.lock().unwrap(),
            &crate::sessions::store::NewCard {
                resume: Some("gemini --resume {session}"),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        patch(
            &st,
            &id,
            serde_json::json!({"status": "in_progress", "source": "user"}),
        )
        .await;
        assert_eq!(resume_input(&st, &id), None, "a drag isn't the agent");
        patch(
            &st,
            &id,
            serde_json::json!({"status": "needs_input", "agent_session": "g-7"}),
        )
        .await;
        assert_eq!(
            resume_input(&st, &id).as_deref(),
            Some("gemini --resume g-7\r")
        );
    }

    #[tokio::test]
    async fn a_hook_that_names_its_conversation_makes_the_card_resumable() {
        let st = test_state();
        let id = new_card(&st);
        patch(&st, &id, serde_json::json!({"status": "in_progress"})).await;
        assert_eq!(resume_input(&st, &id), None);
        let (code, _) = patch(
            &st,
            &id,
            serde_json::json!({"status": "in_progress", "agent": "claude", "agent_session": "s-1"}),
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(
            resume_input(&st, &id).as_deref(),
            Some("claude --resume s-1\r")
        );
        patch(
            &st,
            &id,
            serde_json::json!({"status": "in_progress", "agent": "claude", "agent_session": "$(x)"}),
        )
        .await;
        assert_eq!(
            resume_input(&st, &id).as_deref(),
            Some("claude --resume s-1\r"),
            "an odd id is ignored, not stored"
        );
    }
}
