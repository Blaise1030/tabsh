//! The WebSocket a browser tab attaches to a running shell through.

use super::{Activity, Event, Output, Session, pty::get_or_spawn};
use crate::{AppState, error::BoxError};
use axum::{
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use std::collections::HashMap;
use tokio::sync::broadcast;

pub(super) async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    State(st): State<AppState>,
) -> Response {
    // Browsers let any site open a WebSocket to localhost and always send
    // Origin when they do; `guard` has checked it is a hosted UI with the
    // token. Without one this isn't a browser we can vouch for.
    if !headers.contains_key(header::ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let id = params.get("id").cloned().unwrap_or_default();
    let session = match get_or_spawn(&st, &id) {
        Ok(Some(s)) => s,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            eprintln!("failed to start session {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = attach(socket, &session).await {
            eprintln!("session {id} error: {e}");
        }
    })
}

async fn attach(socket: WebSocket, session: &Session) -> Result<(), BoxError> {
    let (mut sink, mut stream) = socket.split();

    // The lock spans reading the scrollback and subscribing, so a new client
    // sees everything exactly once: replayed history, then live events.
    let (intro, exited, mut rx) = {
        let out = session.output.lock().unwrap();
        (opening(&out), out.exited, out.tx.subscribe())
    };
    for msg in intro {
        sink.send(msg).await?;
    }
    if exited {
        return Ok(());
    }

    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(Event::Output(data)) => sink.send(Message::Binary(data)).await?,
                Ok(Event::Activity(state)) => sink.send(activity_frame(state)).await?,
                Ok(Event::Exit) | Err(broadcast::error::RecvError::Closed) => {
                    sink.send(Message::Text(r#"{"exit":true}"#.into())).await?;
                    break;
                }
                // This client fell too far behind to stay consistent; drop it
                // and let it reconnect, which replays the scrollback cleanly.
                Err(broadcast::error::RecvError::Lagged(_)) => break,
            },
            msg = stream.next() => match msg {
                Some(Ok(Message::Binary(data))) => session.input.send(data)?,
                // Text frames carry control messages: {"cols": N, "rows": N} resizes.
                Some(Ok(Message::Text(text))) => {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                        continue;
                    };
                    if let (Some(cols), Some(rows)) = (v["cols"].as_u64(), v["rows"].as_u64()) {
                        let _ = session.master.lock().unwrap().resize(PtySize {
                            rows: rows as u16,
                            cols: cols as u16,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                }
                // The browser went away; the shell keeps running for a reattach.
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }

    let _ = sink.close().await;
    Ok(())
}

/// What a client is told when it attaches: the replayed history, then —
/// unless the session is idle (every tab's default, unspoken) — the agent
/// activity in effect, so a reloading page shows the right marker at once.
/// An exited session is told so and nothing more.
fn opening(out: &Output) -> Vec<Message> {
    // The history is always sent, even empty: the page treats the first
    // binary message as replayed (e.g. to skip old bells in it).
    let mut history = out.trimmed_modes.replay_prefix();
    history.extend(out.scrollback.iter());
    let mut msgs = vec![Message::Binary(history.into())];
    if out.exited {
        msgs.push(Message::Text(r#"{"exit":true}"#.into()));
    } else if out.activity != Activity::Idle {
        msgs.push(activity_frame(out.activity));
    }
    msgs
}

/// The text frame for an activity change, beside `{"exit":true}`.
fn activity_frame(state: Activity) -> Message {
    Message::Text(format!(r#"{{"activity":"{}"}}"#, state.as_str()).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::{Activity, Output, modes::ModeTracker};
    use std::collections::VecDeque;

    /// An `Output` whose scrollback says "hi", with the given activity.
    fn output(activity: Activity, exited: bool) -> Output {
        Output {
            scrollback: VecDeque::from(b"hi".to_vec()),
            trimmed_modes: ModeTracker::default(),
            tx: broadcast::channel(16).0,
            exited,
            activity,
            dirty: false,
        }
    }

    #[test]
    fn a_fresh_client_gets_the_history_then_the_current_activity() {
        let msgs = opening(&output(Activity::NeedsInput, false));
        assert_eq!(msgs.len(), 2);
        assert!(matches!(&msgs[0], Message::Binary(b) if b.as_ref() == b"hi"));
        assert!(
            matches!(&msgs[1], Message::Text(t) if t.as_str() == r#"{"activity":"needs-input"}"#)
        );
    }

    #[test]
    fn an_idle_session_says_nothing_about_activity_on_attach() {
        // Idle is every tab's default; sending it would clear markers a
        // reloading page hasn't thought about yet.
        let msgs = opening(&output(Activity::Idle, false));
        assert_eq!(msgs.len(), 1);
        assert!(matches!(&msgs[0], Message::Binary(_)));
    }

    #[test]
    fn an_exited_session_is_told_so_and_nothing_else() {
        let msgs = opening(&output(Activity::Running, true));
        assert_eq!(msgs.len(), 2);
        assert!(matches!(&msgs[1], Message::Text(t) if t.as_str() == r#"{"exit":true}"#));
    }
}
