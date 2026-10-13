//! `/api/board/events`: every card status change, pushed to open pages so
//! tab glyphs and the board update without a reload.

use crate::{
    AppState,
    auth::Credential,
    remote::{admit, closed_for, policy_close},
};
use axum::{
    Extension,
    extract::{
        ConnectInfo, State,
        ws::{Message, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;
use tokio::sync::broadcast::error::RecvError;

pub(super) async fn events(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    credential: Option<Extension<Credential>>,
    State(st): State<AppState>,
) -> Response {
    let Some((mut closed, holder)) = admit(&st, peer, credential) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let mut rx = st.events.subscribe();
    ws.on_upgrade(move |mut socket| async move {
        loop {
            tokio::select! {
                () = closed_for(&mut closed, &holder) => {
                    let _ = socket.send(policy_close()).await;
                    break;
                }
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
