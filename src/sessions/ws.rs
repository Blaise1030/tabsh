//! The WebSocket a browser tab attaches to a running shell through.

use super::{Event, Output, Session, pty};
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
    let session = match pty::open(st, id.clone()).await {
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

/// What a client attaching gets: the history to replay, and the live output
/// that follows it with nothing missed or repeated.
struct Replay {
    history: Vec<u8>,
    exited: bool,
    rx: broadcast::Receiver<Event>,
}

impl Output {
    /// Taken under the `output` lock, which the shell's reader also needs
    /// for every chunk, so it only copies.
    fn replay(&self) -> Replay {
        let mut history = self.trimmed_modes.replay_prefix();
        history.extend_from_slice(&self.scrollback_bytes());
        Replay {
            history,
            exited: self.exited,
            rx: self.tx.subscribe(),
        }
    }
}

async fn attach(socket: WebSocket, session: &Session) -> Result<(), BoxError> {
    let (mut sink, mut stream) = socket.split();

    // The lock is let go before anything is sent: a slow client never
    // holds up the shell's output.
    let Replay {
        history,
        exited,
        mut rx,
    } = session.output.lock().unwrap().replay();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::{Output, SCROLLBACK_BYTES};
    use axum::body::Bytes;
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    // A scrollback that's full and wrapped around in its ring buffer, as a
    // busy shell's is.
    fn full() -> Output {
        let mut out = Output::new(VecDeque::new());
        for _ in 0..SCROLLBACK_BYTES / 4096 + 10 {
            out.append(Bytes::from(vec![b'x'; 4096]));
        }
        out
    }

    // Relative to a byte-by-byte walk over the same buffer, so the bound
    // holds on any machine. Only a debug build tells the two apart: release
    // optimises the walk into a copy too, so there it's not checked.
    #[test]
    fn a_replay_holds_the_output_lock_briefly() {
        if !cfg!(debug_assertions) {
            return;
        }
        let output = Mutex::new(full());
        // Best of a few, so a busy machine's one slow run doesn't count.
        let best = |f: &dyn Fn() -> usize| {
            (0..5)
                .map(|_| {
                    let t = Instant::now();
                    assert!(f() >= SCROLLBACK_BYTES);
                    t.elapsed()
                })
                .min()
                .unwrap()
        };
        let held = best(&|| output.lock().unwrap().replay().history.len());
        let walk = best(&|| {
            let out = output.lock().unwrap();
            out.scrollback.iter().copied().collect::<Vec<u8>>().len()
        });
        // The producer waits on this lock for every chunk it reads.
        assert!(held * 4 < walk, "held {held:?}, a byte walk {walk:?}");
    }

    #[test]
    fn a_replay_is_bounded_by_the_scrollback() {
        let mut out = full();
        out.append(Bytes::from_static(b"\x1b[?1049h"));
        for _ in 0..64 {
            out.append(Bytes::from(vec![b'y'; 8192]));
        }
        let replay = out.replay();
        assert!(
            replay.history.starts_with(b"\x1b[?1049h"),
            "trimmed modes first"
        );
        assert_eq!(
            replay.history.len(),
            SCROLLBACK_BYTES + b"\x1b[?1049h".len()
        );
        assert!(
            replay.history.ends_with(&[b'y'; 8192]),
            "the newest bytes last"
        );
    }

    // The seam between replay and live output: a client attaching while the
    // shell writes gets every chunk exactly once, either in its history or
    // on its receiver, in order.
    #[test]
    fn attaching_mid_stream_sees_every_chunk_once() {
        let output = Arc::new(Mutex::new(Output::new(VecDeque::new())));
        let producer = {
            let output = output.clone();
            std::thread::spawn(move || {
                // Fewer chunks than the channel holds, so no receiver lags.
                for i in 0..1000u32 {
                    let chunk = Bytes::from(format!("<{i}>"));
                    output.lock().unwrap().append(chunk);
                    std::thread::sleep(Duration::from_micros(50));
                }
            })
        };
        let mut attaches = Vec::new();
        while !producer.is_finished() {
            attaches.push(output.lock().unwrap().replay());
            std::thread::sleep(Duration::from_micros(200));
        }
        producer.join().unwrap();
        assert!(attaches.len() > 2, "attached while the shell wrote");
        for Replay {
            history, mut rx, ..
        } in attaches
        {
            let mut seen = history;
            while let Ok(Event::Output(data)) = rx.try_recv() {
                seen.extend_from_slice(&data);
            }
            let text = String::from_utf8(seen).unwrap();
            let ticks: Vec<u32> = text
                .split('<')
                .filter_map(|t| t.strip_suffix('>')?.parse().ok())
                .collect();
            assert_eq!(*ticks.last().unwrap(), 999, "live output up to the end");
            for w in ticks.windows(2) {
                assert_eq!(w[1], w[0] + 1, "no gap or repeat at {}", w[0]);
            }
        }
    }
}
