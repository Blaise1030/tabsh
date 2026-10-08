//! The WebSocket a browser tab attaches to a running shell through.

use super::{Event, Session, pty::get_or_spawn};
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

    let (history, exited, mut rx) = {
        let out = session.output.lock().unwrap();
        let mut history = out.trimmed_modes.replay_prefix();
        history.extend(out.scrollback.iter());
        (history, out.exited, out.tx.subscribe())
    };
    // Always sent, even empty: the page treats the first binary message as
    // replayed history (e.g. to skip old bells in it).
    sink.send(Message::Binary(history.into())).await?;
    if exited {
        sink.send(Message::Text(r#"{"exit":true}"#.into())).await?;
        return Ok(());
    }

    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(Event::Output(data)) => sink.send(Message::Binary(data)).await?,
                // The daemon replaced this shell (its card's first prompt
                // changed): the tab reattaches to the replacement.
                Ok(Event::Restart) => {
                    sink.send(Message::Text(r#"{"restart":true}"#.into())).await?;
                    break;
                }
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
