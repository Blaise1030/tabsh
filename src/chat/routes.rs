//! Chat HTTP routes: history, SSE stream, message, stop, approve.
//!
//! All routes sit behind the daemon guard (merged only in
//! `state::router()` and listed in `every_route_is_guarded`). The browser
//! never speaks ACP; it renders the `UiChunk`s these routes serve.

use std::{collections::VecDeque, convert::Infallible, path::PathBuf};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{get, post},
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::{manager::ChatError, normalize::UiChunk};
use crate::AppState;

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/sessions/{id}/chat", get(history))
        .route("/api/sessions/{id}/chat/stream", get(stream))
        .route("/api/sessions/{id}/chat/message", post(message))
        .route("/api/sessions/{id}/chat/stop", post(stop))
        .route("/api/sessions/{id}/chat/approve", post(approve))
}

/// What the chat handlers need of a card row.
struct CardRow {
    mode: String,
    acp_command: Option<String>,
    cwd: Option<String>,
}

fn card_row(st: &AppState, id: &str) -> Option<CardRow> {
    st.db
        .lock()
        .unwrap()
        .query_row(
            "SELECT mode, acp_command, cwd FROM sessions WHERE id = ?1",
            params![id],
            |r| {
                Ok(CardRow {
                    mode: r.get(0)?,
                    acp_command: r.get(1)?,
                    cwd: r.get(2)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
}

fn chat_error(err: ChatError) -> Response {
    match err {
        ChatError::Invalid(_) => StatusCode::BAD_REQUEST.into_response(),
        // 409 keeps its status and an empty body. The page's own copy
        // ("This card already has a terminal running.") is the message.
        ChatError::NotLive | ChatError::Conflict(_) => StatusCode::CONFLICT.into_response(),
        ChatError::Failed(e) => {
            eprintln!("chat error: {e}");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"message": e})),
            )
                .into_response()
        }
    }
}

#[derive(Serialize)]
struct History {
    messages: Vec<UiChunk>,
}

async fn history(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<History>, StatusCode> {
    if card_row(&st, &id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(History {
        messages: st.chats.history(&id),
    }))
}

struct StreamState {
    st: AppState,
    id: String,
    replay: VecDeque<UiChunk>,
    rx: Option<tokio::sync::broadcast::Receiver<UiChunk>>,
    /// Chunks already sent: a resubscribe's replay skips this many, so
    /// a chat started after this stream opened arrives gap-free and
    /// without duplicates (`subscribe` snapshots under the history lock).
    seen: usize,
    /// A start failure already written on this connection. It is not a
    /// history chunk, so it does not count toward `seen`.
    told: Option<String>,
}

async fn stream(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    if card_row(&st, &id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    let (replay, rx) = st.chats.subscribe(&id);
    let state = StreamState {
        st,
        id,
        replay: replay.into(),
        rx,
        seen: 0,
        told: None,
    };
    let stream = futures_util::stream::unfold(state, |mut state| async {
        loop {
            if let Some(chunk) = state.replay.pop_front() {
                state.seen += 1;
                let data = serde_json::to_string(&chunk).unwrap_or_default();
                return Some((Ok(Event::default().data(data)), state));
            }
            // A launch that never became a live chat has no broadcast.
            // Hand the failure string over once; it is not part of `seen`,
            // so the later replay of a successful start is not shifted.
            if state.rx.is_none()
                && let Some(message) = state.st.chats.failure(&state.id)
                && state.told.as_deref() != Some(message.as_str())
            {
                state.told = Some(message.clone());
                let data = serde_json::json!({"type": "error", "message": message}).to_string();
                return Some((Ok(Event::default().data(data)), state));
            }
            match &mut state.rx {
                Some(rx) => match rx.recv().await {
                    Ok(chunk) => {
                        state.seen += 1;
                        let data = serde_json::to_string(&chunk).unwrap_or_default();
                        return Some((Ok(Event::default().data(data)), state));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                },
                // No chat is live yet: poll until one starts, then take
                // its replay (past what we already sent) plus receiver.
                None => {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    let (history, rx) = state.st.chats.subscribe(&state.id);
                    if rx.is_some() {
                        state.replay = history.into_iter().skip(state.seen).collect();
                        state.rx = rx;
                    }
                }
            }
        }
    });
    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}

#[derive(Deserialize)]
struct Message {
    text: String,
}

async fn message(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Message>,
) -> Result<StatusCode, Response> {
    let Some(card) = card_row(&st, &id) else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    if body.text.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    if st.chats.is_live(&id) {
        st.chats
            .send_message(&id, &body.text)
            .await
            .map_err(chat_error)?;
        return Ok(StatusCode::ACCEPTED);
    }
    // One active agent surface per card: a live agent PTY refuses chat.
    if st.live.lock().unwrap().contains_key(&id) {
        return Err(StatusCode::CONFLICT.into_response());
    }
    if card.mode != "ui" {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let Some(acp) = card.acp_command.filter(|c| !c.trim().is_empty()) else {
        return Err(StatusCode::BAD_REQUEST.into_response());
    };
    let cwd = card
        .cwd
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    st.chats
        .start(&id, &acp, &cwd, None)
        .await
        .map_err(chat_error)?;
    st.chats
        .send_message(&id, &body.text)
        .await
        .map_err(chat_error)?;
    Ok(StatusCode::ACCEPTED)
}

async fn stop(State(st): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, Response> {
    if card_row(&st, &id).is_none() {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    if st.chats.is_live(&id) {
        st.chats.cancel(&id).await.map_err(chat_error)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Approve {
    #[serde(rename = "requestId", alias = "request_id")]
    request_id: String,
    allow: bool,
}

/// Answers the pending `session/request_permission`. An unknown id still
/// acknowledges, matching a click that arrived after the agent moved on.
async fn approve(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Approve>,
) -> Result<StatusCode, Response> {
    if card_row(&st, &id).is_none() {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    if st.chats.is_live(&id) {
        st.chats
            .answer(&id, &body.request_id, body.allow)
            .await
            .map_err(chat_error)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::http::{Method, Request};
    use tower::ServiceExt;

    fn fake_acp_command() -> String {
        let (cmd, args) = crate::chat::acp::fake_agent();
        format!("{cmd} {}", args.join(" "))
    }

    async fn req(
        st: &AppState,
        method: Method,
        uri: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer [REDACTED]")
            .header("Content-Type", "application/json")
            .extension(crate::test_support::loopback_peer())
            .body(axum::body::Body::from(body.to_string()))
            .unwrap();
        let res = crate::state::router(st.clone()).oneshot(req).await.unwrap();
        let code = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (code, serde_json::from_slice(&bytes).unwrap_or_default())
    }

    async fn create_ui_card(st: &AppState, prompt: &str) -> String {
        let (code, body) = req(
            st,
            Method::POST,
            "/api/sessions",
            serde_json::json!({
                "cwd": "/tmp", "mode": "ui", "prompt": prompt,
                "acp_command": fake_acp_command(),
            }),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "create: {body}");
        assert_eq!(body["mode"], "ui");
        body["id"].as_str().unwrap().to_string()
    }

    async fn move_in_progress(st: &AppState, id: &str) {
        let (code, body) = req(
            st,
            Method::PATCH,
            &format!("/api/sessions/{id}/status"),
            serde_json::json!({"status": "in_progress", "source": "user"}),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "status: {body}");
    }

    async fn chat_text(st: &AppState, id: &str) -> String {
        let (code, body) = req(
            st,
            Method::GET,
            &format!("/api/sessions/{id}/chat"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::OK, "history: {body}");
        body["messages"]
            .as_array()
            .map(|msgs| {
                msgs.iter()
                    .filter_map(|m| m["text"].as_str().map(str::to_string))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default()
    }

    async fn wait_for_text(st: &AppState, id: &str, needle: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            if chat_text(st, id).await.contains(needle) {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {needle:?} in chat of {id}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    async fn wait_live(st: &AppState, id: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !st.chats.is_live(id) {
            assert!(
                std::time::Instant::now() < deadline,
                "chat never went live for {id}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    #[tokio::test]
    async fn chat_message_round_trip_with_fake_acp() {
        let st = test_state();
        let id = create_ui_card(&st, "hi").await;

        // acp_command is stored on the session at create, like pending_command.
        let stored: Option<String> = st
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT acp_command FROM sessions WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stored.is_some_and(|c| c.contains("python3")));

        let (code, _) = req(
            &st,
            Method::GET,
            "/api/sessions/nope/chat",
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::NOT_FOUND);

        move_in_progress(&st, &id).await;
        wait_live(&st, &id).await;
        // The pending prompt is the first ACP prompt.
        wait_for_text(&st, &id, "fake reply: hi").await;

        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/message"),
            serde_json::json!({"text": "again"}),
        )
        .await;
        assert_eq!(code, StatusCode::ACCEPTED);
        wait_for_text(&st, &id, "fake reply: again").await;

        // The user message is in the transcript too.
        let (_, body) = req(
            &st,
            Method::GET,
            &format!("/api/sessions/{id}/chat"),
            serde_json::Value::Null,
        )
        .await;
        assert!(
            body["messages"].as_array().is_some_and(|msgs| msgs
                .iter()
                .any(|m| m["type"] == "user_text" && m["text"] == "again")),
            "messages: {body}"
        );

        // Transcript jsonl at {data_dir}/chats/{session_id}.jsonl.
        let path = st.chats.transcript_path(&id);
        assert!(path.exists(), "transcript missing at {}", path.display());
        let lines = std::fs::read_to_string(&path).unwrap();
        assert!(lines.contains("fake reply: again"), "transcript: {lines}");

        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/stop"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);
        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/approve"),
            serde_json::json!({"requestId": "1", "allow": true}),
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);

        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn chat_stream_replays_history_then_stays_open() {
        use futures_util::StreamExt;
        let st = test_state();
        let (code, _) = req(
            &st,
            Method::GET,
            "/api/sessions/nope/chat/stream",
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::NOT_FOUND);

        let id = create_ui_card(&st, "hi").await;
        move_in_progress(&st, &id).await;
        wait_live(&st, &id).await;
        wait_for_text(&st, &id, "fake reply: hi").await;

        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("/api/sessions/{id}/chat/stream"))
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer [REDACTED]")
            .extension(crate::test_support::loopback_peer())
            .body(axum::body::Body::empty())
            .unwrap();
        let res = crate::state::router(st.clone())
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert!(
            res.headers()["content-type"]
                .to_str()
                .unwrap()
                .starts_with("text/event-stream")
        );
        let mut stream = Box::pin(res.into_body().into_data_stream());
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
            .await
            .expect("SSE replay timed out")
            .expect("SSE stream ended early")
            .unwrap();
        let text = String::from_utf8_lossy(&first);
        assert!(text.contains("data:"), "first SSE bytes: {text}");
        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn chat_stream_before_start_receives_later_chunks() {
        use futures_util::StreamExt;
        let st = test_state();
        let id = create_ui_card(&st, "early-bird").await;
        assert!(!st.chats.is_live(&id));

        // Subscribe before any chat exists for the card.
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("/api/sessions/{id}/chat/stream"))
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer [REDACTED]")
            .extension(crate::test_support::loopback_peer())
            .body(axum::body::Body::empty())
            .unwrap();
        let res = crate::state::router(st.clone())
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let mut stream = Box::pin(res.into_body().into_data_stream());

        // The chat only starts now; its chunks must reach this stream.
        move_in_progress(&st, &id).await;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut received = String::new();
        while !received.contains("fake reply: early-bird") {
            assert!(
                std::time::Instant::now() < deadline,
                "pre-live SSE subscriber never saw the chat; got: {received}"
            );
            let next = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
                .await
                .expect("SSE stream stalled before the chat started")
                .expect("SSE stream ended before the chat started")
                .unwrap();
            received.push_str(&String::from_utf8_lossy(&next));
        }
        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn ui_card_in_progress_does_not_open_pty() {
        let st = test_state();
        let id = create_ui_card(&st, "hello").await;
        move_in_progress(&st, &id).await;
        wait_live(&st, &id).await;
        wait_for_text(&st, &id, "fake reply: hello").await;
        assert!(
            !st.live.lock().unwrap().contains_key(&id),
            "a UI card must never open an agent PTY"
        );
        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn chat_start_conflicts_with_live_pty() {
        let st = test_state();
        // A TUI card with a live agent PTY refuses a chat start.
        let (code, body) = req(
            &st,
            Method::POST,
            "/api/sessions",
            serde_json::json!({"cwd": "/tmp", "prompt": "hi"}),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "create: {body}");
        let tui_id = body["id"].as_str().unwrap().to_string();
        {
            let st = st.clone();
            let id = tui_id.clone();
            tokio::task::spawn_blocking(move || crate::sessions::pty::get_or_spawn(&st, &id))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        }
        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{tui_id}/chat/message"),
            serde_json::json!({"text": "hi"}),
        )
        .await;
        assert_eq!(code, StatusCode::CONFLICT, "chat over a live PTY");
        let (code, _) = req(
            &st,
            Method::DELETE,
            &format!("/api/sessions/{tui_id}"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);

        // Reverse: a live chat refuses a PTY start for the same card.
        let id = create_ui_card(&st, "hi").await;
        move_in_progress(&st, &id).await;
        wait_live(&st, &id).await;
        let started = {
            let st = st.clone();
            let id = id.clone();
            tokio::task::spawn_blocking(move || crate::sessions::pty::get_or_spawn(&st, &id))
                .await
                .unwrap()
        };
        assert!(started.is_err(), "PTY start must refuse a live chat");
        crate::sessions::launch(&st, &id);
        assert!(
            !st.live.lock().unwrap().contains_key(&id),
            "PTY launch must not open a shell under a live chat"
        );
        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn chat_message_spawn_failure_body_is_the_error() {
        let st = test_state();
        let (code, body) = req(
            &st,
            Method::POST,
            "/api/sessions",
            serde_json::json!({
                "cwd": "/tmp",
                "mode": "ui",
                "acp_command": "/no/such/tabsh-acp-agent",
            }),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "create: {body}");
        let id = body["id"].as_str().unwrap();
        let (code, body) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/message"),
            serde_json::json!({"text": "hi"}),
        )
        .await;
        assert_eq!(code, StatusCode::BAD_GATEWAY, "{body}");
        let message = body["message"].as_str().unwrap_or("");
        assert!(
            message.contains("spawn") && message.contains("tabsh-acp-agent"),
            "502 body must be the spawn error, got {body}"
        );
    }

    #[tokio::test]
    async fn launch_ui_failure_reaches_the_chat_stream() {
        use futures_util::StreamExt;
        let st = test_state();
        let (code, body) = req(
            &st,
            Method::POST,
            "/api/sessions",
            serde_json::json!({
                "cwd": "/tmp",
                "mode": "ui",
                "prompt": "hi",
                "acp_command": "/no/such/tabsh-acp-agent",
            }),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "create: {body}");
        let id = body["id"].as_str().unwrap().to_string();
        move_in_progress(&st, &id).await;

        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("/api/sessions/{id}/chat/stream"))
            .header("Host", "127.0.0.1:7681")
            .header("Authorization", "Bearer [REDACTED]")
            .extension(crate::test_support::loopback_peer())
            .body(axum::body::Body::empty())
            .unwrap();
        let res = crate::state::router(st.clone())
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let mut stream = Box::pin(res.into_body().into_data_stream());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut received = String::new();
        while !received.contains("tabsh-acp-agent") {
            assert!(
                std::time::Instant::now() < deadline,
                "launch failure never reached the stream; got: {received}"
            );
            let next = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
                .await
                .expect("SSE stalled")
                .expect("SSE ended")
                .unwrap();
            received.push_str(&String::from_utf8_lossy(&next));
        }
        assert!(
            received.contains("\"type\":\"error\"") || received.contains("\"type\": \"error\""),
            "stream must carry an error chunk: {received}"
        );
    }

    async fn messages(st: &AppState, id: &str) -> Vec<serde_json::Value> {
        let (code, body) = req(
            st,
            Method::GET,
            &format!("/api/sessions/{id}/chat"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::OK, "history: {body}");
        body["messages"].as_array().cloned().unwrap_or_default()
    }

    fn chunk_text(msgs: &[serde_json::Value]) -> String {
        msgs.iter().filter_map(|m| m["text"].as_str()).collect()
    }

    fn stop_reasons(msgs: &[serde_json::Value]) -> Vec<String> {
        msgs.iter()
            .filter(|m| m["type"] == "turn_end")
            .filter_map(|m| m["stop_reason"].as_str().map(str::to_string))
            .collect()
    }

    fn card_status(st: &AppState, id: &str) -> String {
        st.db
            .lock()
            .unwrap()
            .query_row("SELECT status FROM sessions WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
    }

    async fn wait_messages(
        st: &AppState,
        id: &str,
        ready: impl Fn(&[serde_json::Value]) -> bool,
    ) -> Vec<serde_json::Value> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            let msgs = messages(st, id).await;
            if ready(&msgs) {
                return msgs;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out; messages: {msgs:?}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
    }

    /// Stop must end the turn even when the agent never answers `session/cancel`,
    /// so the composer can unlock. A cancel is not the user waiting, so the
    /// card stays In progress.
    #[tokio::test]
    async fn stop_ends_a_turn_the_agent_never_finishes() {
        let st = test_state();
        let id = create_ui_card(&st, "stuck").await;
        move_in_progress(&st, &id).await;
        wait_for_text(&st, &id, "stuck started").await;

        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/stop"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);

        let msgs = wait_messages(&st, &id, |m| {
            stop_reasons(m).iter().any(|r| r == "cancelled")
        })
        .await;
        assert_eq!(stop_reasons(&msgs), vec!["cancelled".to_string()]);
        assert_eq!(card_status(&st, &id), "in_progress");
        st.chats.forget(&id);
    }

    /// The agent blocks on `session/request_permission` until approve.
    /// Deny selects the reject option; the chunk the stream replays is
    /// `type: permission` with the JSON-RPC id.
    #[tokio::test]
    async fn approve_deny_is_what_the_agent_receives() {
        let st = test_state();
        let id = create_ui_card(&st, "needs permission").await;
        move_in_progress(&st, &id).await;
        let msgs = wait_messages(&st, &id, |m| {
            m.iter()
                .any(|c| c["type"] == "permission" && c["request_id"] == "9000")
        })
        .await;
        assert!(
            !chunk_text(&msgs).contains("permission outcome"),
            "agent answered before approve: {msgs:?}"
        );

        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/approve"),
            serde_json::json!({"requestId": "9000", "allow": false}),
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);
        wait_for_text(&st, &id, "permission outcome: selected:deny").await;
        st.chats.forget(&id);
    }

    #[tokio::test]
    async fn approve_allow_is_what_the_agent_receives() {
        let st = test_state();
        let id = create_ui_card(&st, "needs permission").await;
        move_in_progress(&st, &id).await;
        let msgs = wait_messages(&st, &id, |m| {
            m.iter()
                .any(|c| c["type"] == "permission" && c["request_id"] == "9000")
        })
        .await;
        assert!(
            !chunk_text(&msgs).contains("permission outcome"),
            "agent answered before approve: {msgs:?}"
        );

        let (code, _) = req(
            &st,
            Method::POST,
            &format!("/api/sessions/{id}/chat/approve"),
            serde_json::json!({"requestId": "9000", "allow": true}),
        )
        .await;
        assert_eq!(code, StatusCode::NO_CONTENT);
        wait_for_text(&st, &id, "permission outcome: selected:allow").await;
        st.chats.forget(&id);
    }

    /// An idle `end_turn` is the user waiting; the card leaves In progress.
    #[tokio::test]
    async fn idle_end_turn_moves_the_card_to_needs_input() {
        let st = test_state();
        let id = create_ui_card(&st, "hi").await;
        move_in_progress(&st, &id).await;
        wait_messages(&st, &id, |m| {
            stop_reasons(m).iter().any(|r| r == "end_turn")
        })
        .await;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while card_status(&st, &id) != "needs_input" {
            assert!(
                std::time::Instant::now() < deadline,
                "status stayed {}",
                card_status(&st, &id)
            );
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
        st.chats.forget(&id);
    }

    /// Completed only when the agent sends a session-end update. The
    /// following `end_turn` must not pull the card back to Needs input.
    #[tokio::test]
    async fn session_end_moves_the_card_to_completed() {
        let st = test_state();
        let id = create_ui_card(&st, "end session").await;
        move_in_progress(&st, &id).await;
        wait_messages(&st, &id, |m| {
            stop_reasons(m).iter().any(|r| r == "end_turn")
        })
        .await;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while card_status(&st, &id) != "completed" {
            assert!(
                std::time::Instant::now() < deadline,
                "status stayed {}",
                card_status(&st, &id)
            );
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
        st.chats.forget(&id);
    }

    /// A hook that already moved the card wins over the idle-turn mapping.
    #[tokio::test]
    async fn a_hook_status_survives_the_turn_end() {
        let st = test_state();
        let id = create_ui_card(&st, "hold").await;
        move_in_progress(&st, &id).await;
        wait_for_text(&st, &id, "holding").await;
        let (code, body) = req(
            &st,
            Method::PATCH,
            &format!("/api/sessions/{id}/status"),
            serde_json::json!({"status": "completed", "source": "hook"}),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "hook status: {body}");
        wait_messages(&st, &id, |m| {
            stop_reasons(m).iter().any(|r| r == "end_turn")
        })
        .await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(card_status(&st, &id), "completed");
        st.chats.forget(&id);
    }
}
