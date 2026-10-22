//! Per-card ACP lifecycle: at most one live ACP agent per UI card.
//!
//! Starting a chat while that card's agent PTY is live is refused (409),
//! and the PTY start path refuses while a chat is live — see
//! `sessions::pty::get_or_spawn`. A UI card moved to In progress starts
//! here with its `pending_prompt` as the first ACP prompt; no PTY launch
//! line is ever typed for it.
//!
//! Mutual exclusion is one atomic claim, not two check-then-act
//! sequences: the chat entries and the PTY claims live behind the same
//! lock, so reserving either surface is a single locked step. A chat
//! claim is its map entry (`Starting` or `Live`); a PTY claim is an id
//! in `pty` from `try_claim_pty` until the shell's exit or close
//! releases it (`release_pty`). Whoever claims first wins — the loser
//! gets a conflict, never a second live surface.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{OptionalExtension, params};
use tokio::sync::{broadcast, watch};

use super::{
    acp::AcpClient,
    normalize::{UiChunk, to_chunks},
    transcript,
};
use crate::AppState;

#[derive(Debug)]
pub(crate) enum ChatError {
    Invalid(String),
    NotLive,
    /// The card's other agent surface (its PTY) holds the claim.
    Conflict(String),
    Failed(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::Invalid(m) | ChatError::Conflict(m) | ChatError::Failed(m) => {
                write!(f, "{m}")
            }
            ChatError::NotLive => write!(f, "no live chat for this session"),
        }
    }
}

impl std::error::Error for ChatError {}

type ChatResult<T> = std::result::Result<T, ChatError>;

/// How long an agent gets to answer `initialize` / `session/new`.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

struct LiveChat {
    client: Arc<AcpClient>,
    acp_session_id: String,
    tx: broadcast::Sender<UiChunk>,
    history: Mutex<Vec<UiChunk>>,
    data_dir: PathBuf,
    card_id: String,
}

impl LiveChat {
    /// One chunk, in order: kept for SSE replay, written to the
    /// transcript, then sent to live subscribers.
    fn record(&self, chunk: UiChunk) {
        if let Err(e) = transcript::append(&self.data_dir, &self.card_id, &chunk) {
            eprintln!("chat: failed to write transcript of {}: {e}", self.card_id);
        }
        // Push and broadcast under the history lock: `subscribe` clones
        // the history and subscribes under the same lock, so a chunk is
        // always in exactly one of a subscriber's replay or live stream.
        let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
        history.push(chunk.clone());
        let _ = self.tx.send(chunk);
    }
}

/// A start in flight: its handshake runs outside every lock, waiters
/// park on `done` until the live chat (or the failure) is published.
struct Starting {
    done: watch::Sender<bool>,
}

enum Entry {
    Live(Arc<LiveChat>),
    Starting(Arc<Starting>),
}

/// Both agent surfaces' claims, under one lock so claiming either is
/// atomic against claiming the other.
#[derive(Default)]
struct Surfaces {
    chats: HashMap<String, Entry>,
    /// Cards whose PTY surface is claimed: starting, live, or between
    /// a restart and its replacement shell.
    pty: HashSet<String>,
}

struct Inner {
    surfaces: Mutex<Surfaces>,
    data_dir: PathBuf,
}

/// The outcome of a PTY surface claim (`ChatManager::try_claim_pty`).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PtyClaim {
    /// This caller now holds the card's one agent-surface claim.
    Acquired,
    /// A PTY claim is already held for this card (a shell starting,
    /// live, or restarting): this PTY start may proceed under it.
    AlreadyPty,
    /// A chat is starting or live for this card: no PTY may start.
    BlockedByChat,
}

/// Every live chat, keyed by tabsh session (card) id. Clones share the
/// same chats, like the rest of `AppState`.
#[derive(Clone)]
pub(crate) struct ChatManager {
    inner: Arc<Inner>,
}

/// The ACP command as argv: the provider string (e.g. `cursor-agent acp`)
/// split on whitespace. Quoting is not supported in v1.
fn split_command(acp_command: &str) -> ChatResult<(String, Vec<String>)> {
    let mut parts = acp_command.split_whitespace();
    let cmd = parts
        .next()
        .ok_or_else(|| ChatError::Invalid("empty ACP command".into()))?;
    Ok((cmd.to_string(), parts.map(str::to_string).collect()))
}

impl ChatManager {
    pub(crate) fn new(data_dir: PathBuf) -> ChatManager {
        ChatManager {
            inner: Arc::new(Inner {
                surfaces: Mutex::new(Surfaces::default()),
                data_dir,
            }),
        }
    }

    /// The manager for a daemon whose database is at `db_path`:
    /// transcripts live beside it. An in-memory database (tests) gets a
    /// fresh temp dir instead.
    pub(crate) fn from_db_path(db_path: &str) -> ChatManager {
        let data_dir = if db_path == ":memory:" {
            let unique = crate::auth::random_hex(8).unwrap_or_else(|_| "test".into());
            std::env::temp_dir().join(format!("tabsh-chats-{unique}"))
        } else {
            Path::new(db_path)
                .parent()
                .map(Path::to_path_buf)
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| PathBuf::from("."))
        };
        ChatManager::new(data_dir)
    }

    // Used by tests to pin the on-disk transcript location.
    #[allow(dead_code)]
    pub(crate) fn transcript_path(&self, session_id: &str) -> PathBuf {
        transcript::path(&self.inner.data_dir, session_id)
    }

    pub(crate) fn is_live(&self, session_id: &str) -> bool {
        self.live(session_id).is_some()
    }

    /// Live, or a start is handshaking (tests assert on the
    /// reservation; the PTY path uses the atomic `try_claim_pty`).
    #[cfg(test)]
    pub(crate) fn is_live_or_starting(&self, session_id: &str) -> bool {
        self.inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chats
            .contains_key(session_id)
    }

    /// Atomically claims the card's PTY surface: succeeds only when no
    /// chat is starting or live for it. The claim holds until
    /// `release_pty`, so a chat starting at any point during the PTY's
    /// life — spawn included — loses to it, with no check-then-act gap.
    pub(crate) fn try_claim_pty(&self, session_id: &str) -> PtyClaim {
        let mut surfaces = self
            .inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if surfaces.chats.contains_key(session_id) {
            PtyClaim::BlockedByChat
        } else if !surfaces.pty.insert(session_id.to_string()) {
            PtyClaim::AlreadyPty
        } else {
            PtyClaim::Acquired
        }
    }

    /// Releases a PTY claim (`try_claim_pty`): a chat may start after.
    pub(crate) fn release_pty(&self, session_id: &str) {
        self.inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pty
            .remove(session_id);
    }

    /// Whether a PTY claim is held for the card (tests).
    #[cfg(test)]
    pub(crate) fn pty_claimed(&self, session_id: &str) -> bool {
        self.inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pty
            .contains(session_id)
    }

    fn live(&self, session_id: &str) -> Option<Arc<LiveChat>> {
        self.inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chats
            .get(session_id)
            .and_then(|e| match e {
                Entry::Live(live) => Some(live.clone()),
                Entry::Starting(_) => None,
            })
    }

    /// Starts the card's ACP agent and, when `initial_prompt` is
    /// non-empty, sends it as a prompt. The first caller reserves the
    /// card before handshaking; concurrent callers wait for that one
    /// agent, then dispatch their own prompt to it exactly once. A
    /// failed handshake clears the reservation, and a waiter retries
    /// as the new starter.
    pub(crate) async fn start(
        &self,
        session_id: &str,
        acp_command: &str,
        cwd: &Path,
        initial_prompt: Option<&str>,
    ) -> ChatResult<()> {
        let (live, _won) = self.start_inner(session_id, acp_command, cwd).await?;
        if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            self.dispatch(&live, prompt);
        }
        Ok(())
    }

    /// Starts the chat unless it is already live (or starting): only
    /// the caller that actually starts the agent sends the prompt, so
    /// a repeated board launch never replays it.
    pub(crate) async fn ensure_started(
        &self,
        session_id: &str,
        acp_command: &str,
        cwd: &Path,
        initial_prompt: Option<&str>,
    ) -> ChatResult<()> {
        let (live, won) = self.start_inner(session_id, acp_command, cwd).await?;
        if won && let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            self.dispatch(&live, prompt);
        }
        Ok(())
    }

    /// The one agent for the card: `(live, this call started it)`.
    async fn start_inner(
        &self,
        session_id: &str,
        acp_command: &str,
        cwd: &Path,
    ) -> ChatResult<(Arc<LiveChat>, bool)> {
        enum Action {
            Existing(Arc<LiveChat>),
            Wait(Arc<Starting>),
            Reserve(Arc<Starting>),
            BlockedByPty,
        }
        let starting = loop {
            let action = {
                let mut surfaces = self
                    .inner
                    .surfaces
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                match surfaces.chats.get(session_id) {
                    Some(Entry::Live(live)) => Action::Existing(live.clone()),
                    Some(Entry::Starting(s)) => Action::Wait(s.clone()),
                    // The chat claim and the PTY claim are taken under
                    // this one lock: a PTY claimed first (starting or
                    // live) blocks the reservation outright, with no
                    // window for a PTY to claim in between either.
                    None if surfaces.pty.contains(session_id) => Action::BlockedByPty,
                    None => {
                        let s = Arc::new(Starting {
                            done: watch::channel(false).0,
                        });
                        surfaces
                            .chats
                            .insert(session_id.to_string(), Entry::Starting(s.clone()));
                        Action::Reserve(s)
                    }
                }
            };
            match action {
                Action::Existing(live) => return Ok((live, false)),
                Action::Wait(s) => {
                    let mut rx = s.done.subscribe();
                    // Err only means the starter is gone; loop to retry.
                    let _ = rx.wait_for(|done| *done).await;
                }
                Action::Reserve(s) => break s,
                Action::BlockedByPty => {
                    return Err(ChatError::Conflict(format!(
                        "a PTY is live for session {session_id}"
                    )));
                }
            }
        };

        let handshake = tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
            let (cmd, args) = split_command(acp_command)?;
            let client = AcpClient::spawn(&cmd, &args, cwd)
                .await
                .map_err(|e| ChatError::Failed(e.to_string()))?;
            client
                .initialize()
                .await
                .map_err(|e| ChatError::Failed(e.to_string()))?;
            let acp_session_id = client
                .session_new(cwd)
                .await
                .map_err(|e| ChatError::Failed(e.to_string()))?;
            Ok::<_, ChatError>((client, acp_session_id))
        })
        .await
        .map_err(|_| ChatError::Failed("ACP agent handshake timed out".into()))
        .and_then(|r| r);

        let (client, acp_session_id) = match handshake {
            Ok(pair) => pair,
            Err(e) => {
                let mut surfaces = self
                    .inner
                    .surfaces
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if matches!(surfaces.chats.get(session_id), Some(Entry::Starting(s)) if Arc::ptr_eq(s, &starting))
                {
                    surfaces.chats.remove(session_id);
                }
                drop(surfaces);
                let _ = starting.done.send(true);
                return Err(e);
            }
        };

        let client = Arc::new(client);
        let mut rx = client.event_stream();
        let live = Arc::new(LiveChat {
            client,
            acp_session_id,
            tx: broadcast::channel(256).0,
            history: Mutex::new(transcript::load(&self.inner.data_dir, session_id)),
            data_dir: self.inner.data_dir.clone(),
            card_id: session_id.to_string(),
        });
        {
            let mut surfaces = self
                .inner
                .surfaces
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            surfaces
                .chats
                .insert(session_id.to_string(), Entry::Live(live.clone()));
        }

        // Drain agent events concurrently so chunks reach the transcript
        // and subscribers before the turn ends.
        let weak = Arc::downgrade(&live);
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let Some(live) = weak.upgrade() else { break };
                for chunk in to_chunks(&ev) {
                    live.record(chunk);
                }
            }
        });
        // Publish only once the live chat is in the map: waiters that
        // wake now find it and dispatch onto the one agent.
        let _ = starting.done.send(true);
        Ok((live, true))
    }

    /// Records `text` as the user's chunk and runs it as an ACP prompt on
    /// a spawned task; the turn's chunks arrive through the event pump.
    fn dispatch(&self, live: &Arc<LiveChat>, text: &str) {
        live.record(UiChunk::UserText {
            session_id: live.acp_session_id.clone(),
            text: text.to_string(),
        });
        let client = live.client.clone();
        let acp_session_id = live.acp_session_id.clone();
        let text = text.to_string();
        tokio::spawn(async move {
            if let Err(e) = client.prompt(&acp_session_id, &text).await {
                eprintln!("chat: ACP prompt failed: {e}");
            }
        });
    }

    pub(crate) async fn send_message(&self, session_id: &str, text: &str) -> ChatResult<()> {
        let live = self.live(session_id).ok_or(ChatError::NotLive)?;
        self.dispatch(&live, text);
        Ok(())
    }

    pub(crate) async fn cancel(&self, session_id: &str) -> ChatResult<()> {
        let live = self.live(session_id).ok_or(ChatError::NotLive)?;
        live.client
            .cancel(&live.acp_session_id)
            .await
            .map_err(|e| ChatError::Failed(e.to_string()))
    }

    /// Drops the live chat, if any; the agent process dies with its last
    /// client reference (`kill_on_drop`).
    pub(crate) fn forget(&self, session_id: &str) {
        let mut surfaces = self
            .inner
            .surfaces
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // A start in flight is not forgotten: it publishes (or clears)
        // its own reservation when its handshake settles.
        if matches!(surfaces.chats.get(session_id), Some(Entry::Live(_))) {
            surfaces.chats.remove(session_id);
        }
    }

    /// The assembled transcript: the live history when a chat is running,
    /// else what the transcript file holds.
    pub(crate) fn history(&self, session_id: &str) -> Vec<UiChunk> {
        match self.live(session_id) {
            Some(live) => live
                .history
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            None => transcript::load(&self.inner.data_dir, session_id),
        }
    }

    /// History to replay plus a subscription for what comes next.
    pub(crate) fn subscribe(
        &self,
        session_id: &str,
    ) -> (Vec<UiChunk>, Option<broadcast::Receiver<UiChunk>>) {
        match self.live(session_id) {
            Some(live) => {
                // Clone and subscribe under the history lock: `record`
                // pushes and broadcasts under the same lock, so no chunk
                // can fall between the replay snapshot and the receiver.
                let history = live.history.lock().unwrap_or_else(|e| e.into_inner());
                let rx = live.tx.subscribe();
                (history.clone(), Some(rx))
            }
            None => (transcript::load(&self.inner.data_dir, session_id), None),
        }
    }
}

/// Starts a UI card's chat from its stored row: the board's launch for
/// `mode == "ui"` cards. Fire-and-forget — the agent comes up in the
/// background, exactly as a PTY launch does not block the status change.
pub(crate) fn launch_ui(st: &AppState, id: &str) {
    let st = st.clone();
    let id = id.to_string();
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(async move { launch_ui_async(st, id).await });
        }
        Err(_) => {
            std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                if let Ok(rt) = rt {
                    rt.block_on(launch_ui_async(st, id));
                }
            });
        }
    }
}

async fn launch_ui_async(st: AppState, id: String) {
    let row = st
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT mode, acp_command, pending_prompt, cwd FROM sessions WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let Some((mode, acp_command, pending_prompt, cwd)) = row else {
        return;
    };
    if mode != "ui" {
        return;
    }
    let Some(acp) = acp_command.filter(|c| !c.trim().is_empty()) else {
        eprintln!("chat: UI card {id} has no ACP command stored");
        return;
    };
    if st.chats.is_live(&id) {
        return;
    }
    // One active agent surface per card: never over a live agent PTY.
    if st.live.lock().unwrap().contains_key(&id) {
        eprintln!("chat: refusing to start over the live PTY of {id}");
        return;
    }
    let cwd = cwd.map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    match st
        .chats
        .ensure_started(&id, &acp, &cwd, pending_prompt.as_deref())
        .await
    {
        Ok(()) => {
            // The prompt has been handed to the agent; it is no longer
            // pending. `acp_command` stays, so later messages can restart
            // the chat after a daemon restart.
            if let Err(e) = st.db.lock().unwrap().execute(
                "UPDATE sessions SET pending_input = NULL, pending_prompt = NULL,
                     pending_command = NULL WHERE id = ?1",
                params![id],
            ) {
                eprintln!("chat: failed to clear pending prompt of {id}: {e}");
            }
        }
        Err(e) => eprintln!("chat: failed to start UI card {id}: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_acp_command() -> String {
        let (cmd, args) = crate::chat::acp::fake_agent();
        format!("{cmd} {}", args.join(" "))
    }

    fn test_manager() -> ChatManager {
        let unique = crate::auth::random_hex(8).unwrap_or_else(|_| "test".into());
        ChatManager::new(std::env::temp_dir().join(format!("tabsh-chats-test-{unique}")))
    }

    fn user_texts(chunks: &[UiChunk]) -> Vec<String> {
        chunks
            .iter()
            .filter_map(|c| match c {
                UiChunk::UserText { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    fn all_text(chunks: &[UiChunk]) -> String {
        chunks
            .iter()
            .filter_map(|c| serde_json::to_value(c).ok())
            .filter_map(|v| v["text"].as_str().map(str::to_string))
            .collect()
    }

    #[tokio::test]
    async fn concurrent_starts_spawn_one_agent_and_dispatch_both_prompts() {
        let chats = test_manager();
        let cmd = fake_acp_command();
        let cwd = Path::new("/tmp");
        let (a, b) = tokio::join!(
            chats.start("card-1", &cmd, cwd, Some("one")),
            chats.start("card-1", &cmd, cwd, Some("two")),
        );
        a.unwrap();
        b.unwrap();
        assert!(chats.is_live("card-1"));

        // Both prompts answered by the one agent; neither dropped, neither doubled.
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            let history = chats.history("card-1");
            let text = all_text(&history);
            if text.contains("fake reply: one") && text.contains("fake reply: two") {
                let mut sent = user_texts(&history);
                sent.sort();
                assert_eq!(sent, vec!["one".to_string(), "two".to_string()]);
                break;
            }
            assert!(std::time::Instant::now() < deadline, "history: {text}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        chats.forget("card-1");
    }

    #[tokio::test]
    async fn pty_claim_blocks_chat_start_until_released() {
        let chats = test_manager();
        assert_eq!(chats.try_claim_pty("card-p"), PtyClaim::Acquired);
        assert_eq!(chats.try_claim_pty("card-p"), PtyClaim::AlreadyPty);
        let cmd = fake_acp_command();
        let err = chats
            .start("card-p", &cmd, Path::new("/tmp"), Some("hi"))
            .await
            .unwrap_err();
        assert!(matches!(err, ChatError::Conflict(_)), "start: {err}");
        assert!(!chats.is_live_or_starting("card-p"), "no chat reserved");
        chats.release_pty("card-p");
        assert!(!chats.pty_claimed("card-p"));
        chats
            .start("card-p", &cmd, Path::new("/tmp"), Some("hi"))
            .await
            .unwrap();
        assert!(chats.is_live("card-p"));
        // And while the chat is live, the PTY claim loses.
        assert_eq!(chats.try_claim_pty("card-p"), PtyClaim::BlockedByChat);
        chats.forget("card-p");
        assert_eq!(chats.try_claim_pty("card-p"), PtyClaim::Acquired);
        chats.release_pty("card-p");
    }

    // The race itself: a PTY claim and a chat start released at the
    // same instant must produce exactly one winner, every time.
    #[tokio::test]
    async fn concurrent_pty_claim_and_chat_start_have_one_winner() {
        let chats = test_manager();
        let cmd = fake_acp_command();
        for n in 0..16 {
            let id = format!("race-{n}");
            let barrier = Arc::new(tokio::sync::Barrier::new(2));
            let claim = {
                let chats = chats.clone();
                let barrier = barrier.clone();
                let id = id.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    chats.try_claim_pty(&id)
                })
            };
            let start = {
                let chats = chats.clone();
                let barrier = barrier.clone();
                let cmd = cmd.clone();
                let id = id.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    chats.start(&id, &cmd, Path::new("/tmp"), None).await
                })
            };
            let claim = claim.await.unwrap();
            let started = start.await.unwrap();
            match claim {
                PtyClaim::Acquired | PtyClaim::AlreadyPty => {
                    assert!(
                        matches!(started, Err(ChatError::Conflict(_))),
                        "PTY claimed {id} but chat also started: {started:?}"
                    );
                    assert!(!chats.is_live(&id));
                    chats.release_pty(&id);
                }
                PtyClaim::BlockedByChat => {
                    started.unwrap_or_else(|e| panic!("chat won {id} but failed: {e}"));
                    assert!(chats.is_live(&id));
                    chats.forget(&id);
                }
            }
            assert!(!chats.is_live_or_starting(&id) && !chats.pty_claimed(&id));
        }
    }

    #[tokio::test]
    async fn failed_start_clears_the_reservation() {
        let chats = test_manager();
        assert!(
            chats
                .start(
                    "card-x",
                    "/nonexistent-agent-xyz acp",
                    Path::new("/tmp"),
                    Some("hi")
                )
                .await
                .is_err()
        );
        assert!(!chats.is_live_or_starting("card-x"));
        // A later start with a working command succeeds on the same card.
        let cmd = fake_acp_command();
        chats
            .start("card-x", &cmd, Path::new("/tmp"), Some("hi"))
            .await
            .unwrap();
        assert!(chats.is_live("card-x"));
        chats.forget("card-x");
    }
}
