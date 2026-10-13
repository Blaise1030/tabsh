//! The WebSocket a browser tab attaches to a running shell through.

use super::{Event, Output, Session, pty};
use crate::{
    AppState,
    auth::Credential,
    error::BoxError,
    remote::{Closed, Holder, admit, closed_for, policy_close},
};
use axum::{
    Extension,
    extract::{
        ConnectInfo, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use std::{collections::HashMap, net::SocketAddr};
use tokio::sync::broadcast;

pub(super) async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    credential: Option<Extension<Credential>>,
    State(st): State<AppState>,
) -> Response {
    // Before the shell is opened, so a revoke in between is not missed.
    let Some((closed, holder)) = admit(&st, peer, credential) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    // Browsers let any site open a WebSocket to localhost and always send
    // Origin when they do; `guard` has checked it is a hosted UI with the
    // token. Without one this isn't a browser we can vouch for.
    if !headers.contains_key(header::ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let id = params.get("id").cloned().unwrap_or_default();
    let resume = params.get("resume").and_then(|v| resume_param(v));
    let session = match pty::open(st, id.clone()).await {
        Ok(Some(s)) => s,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            eprintln!("failed to start session {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = attach(socket, &session, resume, (closed, holder)).await {
            eprintln!("session {id} error: {e}");
        }
    })
}

/// What a client attaching gets: the history to replay, and the live output
/// that follows it with nothing missed or repeated. A client that kept its
/// screen gets, as `resumed` history, only the bytes it missed.
struct Replay {
    history: Vec<u8>,
    resumed: bool,
    epoch: String,
    /// The output's byte count where the history ends.
    at: u64,
    exited: bool,
    rx: broadcast::Receiver<Event>,
}

/// `resume=<epoch>:<offset>`: the count a page has seen of an output.
fn resume_param(v: &str) -> Option<(String, u64)> {
    let (epoch, at) = v.split_once(':')?;
    Some((epoch.to_owned(), at.parse().ok()?))
}

impl Output {
    /// Taken under the `output` lock, which the shell's reader also needs
    /// for every chunk, so it only copies. A resume is honoured only within
    /// the same count and while its bytes are still in the scrollback.
    fn replay(&self, resume: Option<(&str, u64)>) -> Replay {
        let start = self.total - self.scrollback.len() as u64;
        let from = resume
            .filter(|&(epoch, at)| epoch == self.epoch && (start..=self.total).contains(&at))
            .map(|(_, at)| at);
        let history = match from {
            Some(at) => self.scrollback_from((at - start) as usize),
            None => {
                let mut history = self.trimmed_modes.replay_prefix();
                history.extend_from_slice(&self.scrollback_bytes());
                history
            }
        };
        Replay {
            history,
            resumed: from.is_some(),
            epoch: self.epoch.clone(),
            at: self.total,
            exited: self.exited,
            rx: self.tx.subscribe(),
        }
    }
}

async fn attach(
    socket: WebSocket,
    session: &Session,
    resume: Option<(String, u64)>,
    (mut closed, holder): (broadcast::Receiver<Closed>, Holder),
) -> Result<(), BoxError> {
    let (mut sink, mut stream) = socket.split();

    // The lock is let go before anything is sent: a slow client never
    // holds up the shell's output.
    let Replay {
        history,
        resumed,
        epoch,
        at,
        exited,
        mut rx,
    } = session
        .output
        .lock()
        .unwrap()
        .replay(resume.as_ref().map(|(e, at)| (e.as_str(), *at)));
    // Before the history, so the page knows whether to clear its screen,
    // and the count to resume from next time.
    let stream_info = serde_json::json!({ "stream": { "epoch": epoch, "at": at, "resumed": resumed } });
    sink.send(Message::Text(stream_info.to_string().into())).await?;
    // Always sent, even empty: the page treats the first binary message as
    // replayed history (e.g. to skip old bells in it).
    sink.send(Message::Binary(history.into())).await?;
    if exited {
        sink.send(Message::Text(r#"{"exit":true}"#.into())).await?;
        return Ok(());
    }

    loop {
        tokio::select! {
            () = closed_for(&mut closed, &holder) => {
                sink.send(policy_close()).await?;
                break;
            }
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
                Some(Ok(Message::Text(text))) => match control(&text) {
                    Control::Resize { cols, rows } => {
                        let _ = session.master.lock().unwrap().resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    Control::Reply(reply) => sink.send(Message::Text(reply.into())).await?,
                    Control::Ignore => {}
                },
                // The browser went away; the shell keeps running for a reattach.
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }

    let _ = sink.close().await;
    Ok(())
}

/// What a text frame from the page asks for.
#[derive(Debug, PartialEq)]
enum Control {
    Resize {
        cols: u16,
        rows: u16,
    },
    /// Sent straight back: `{"ping": n}` gets `{"pong": n}`, so a page can
    /// tell a live socket from one a phone's sleep left for dead.
    Reply(String),
    Ignore,
}

fn control(text: &str) -> Control {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return Control::Ignore;
    };
    if let (Some(cols), Some(rows)) = (v["cols"].as_u64(), v["rows"].as_u64()) {
        return Control::Resize {
            cols: cols as u16,
            rows: rows as u16,
        };
    }
    if !v["ping"].is_null() {
        return Control::Reply(serde_json::json!({ "pong": v["ping"] }).to_string());
    }
    Control::Ignore
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
        let held = best(&|| output.lock().unwrap().replay(None).history.len());
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
        let replay = out.replay(None);
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
            attaches.push(output.lock().unwrap().replay(None));
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

    // A page that kept its screen asks for what came after the bytes it saw.
    #[test]
    fn a_resume_sends_only_the_bytes_missed() {
        let mut out = Output::new(VecDeque::from(b"old ".to_vec()));
        out.append(Bytes::from_static(b"seen "));
        let at = out.replay(None).at;
        out.append(Bytes::from_static(b"missed"));
        let epoch = out.epoch.clone();

        let resumed = out.replay(Some((&epoch, at)));
        assert!(resumed.resumed);
        assert_eq!(resumed.history, b"missed");
        assert_eq!(resumed.at, at + 6);

        let caught_up = out.replay(Some((&epoch, resumed.at)));
        assert!(caught_up.resumed);
        assert!(caught_up.history.is_empty());
    }

    // Anything it can't vouch for gets the whole scrollback again: another
    // shell's (or daemon's) count, bytes since trimmed off, or a count ahead.
    #[test]
    fn a_resume_it_cannot_honour_replays_everything() {
        let out = full();
        let epoch = out.epoch.clone();
        let whole = out.replay(None);
        assert!(!whole.resumed);
        for resume in [
            ("other", whole.at),
            (epoch.as_str(), 0),
            (epoch.as_str(), whole.at + 1),
        ] {
            let replay = out.replay(Some(resume));
            assert!(!replay.resumed, "{resume:?}");
            assert_eq!(replay.history.len(), whole.history.len(), "{resume:?}");
        }
        assert_ne!(
            Output::new(VecDeque::new()).epoch,
            epoch,
            "each shell counts afresh"
        );
    }

    #[test]
    fn a_resume_names_an_epoch_and_an_offset() {
        assert_eq!(resume_param("ab-1:42"), Some(("ab-1".into(), 42)));
        assert_eq!(resume_param("ab-1"), None);
        assert_eq!(resume_param("ab-1:x"), None);
    }

    #[test]
    fn a_text_frame_is_a_resize_a_ping_or_nothing() {
        assert_eq!(
            control(r#"{"cols":80,"rows":24}"#),
            Control::Resize { cols: 80, rows: 24 }
        );
        assert_eq!(
            control(r#"{"ping":7}"#),
            Control::Reply(r#"{"pong":7}"#.into())
        );
        assert_eq!(control("not json"), Control::Ignore);
        assert_eq!(control(r#"{"cols":80}"#), Control::Ignore);
    }
}
