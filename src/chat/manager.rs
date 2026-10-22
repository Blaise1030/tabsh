//! Per-card ACP lifecycle: at most one live ACP agent per UI card.
//!
//! Starting a chat while that card's agent PTY is live is refused (409),
//! and the PTY start path refuses while a chat is live — see
//! `sessions::pty::get_or_spawn`. A UI card moved to In progress starts
//! here with its `pending_prompt` as the first ACP prompt; no PTY launch
//! line is ever typed for it.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{OptionalExtension, params};
use tokio::sync::broadcast;

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
    Failed(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::Invalid(m) | ChatError::Failed(m) => write!(f, "{m}"),
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
        self.history
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(chunk.clone());
        let _ = self.tx.send(chunk);
    }
}

struct Inner {
    live: Mutex<HashMap<String, Arc<LiveChat>>>,
    data_dir: PathBuf,
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
                live: Mutex::new(HashMap::new()),
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
        self.inner
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(session_id)
    }

    fn live(&self, session_id: &str) -> Option<Arc<LiveChat>> {
        self.inner
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
    }

    /// Starts the card's ACP agent (idempotent) and, when
    /// `initial_prompt` is non-empty, sends it as the first prompt.
    pub(crate) async fn start(
        &self,
        session_id: &str,
        acp_command: &str,
        cwd: &Path,
        initial_prompt: Option<&str>,
    ) -> ChatResult<()> {
        if self.is_live(session_id) {
            return Ok(());
        }
        let (cmd, args) = split_command(acp_command)?;
        let (client, acp_session_id) = tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
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
        .map_err(|_| ChatError::Failed("ACP agent handshake timed out".into()))??;

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
            let mut map = self.inner.live.lock().unwrap_or_else(|e| e.into_inner());
            if map.contains_key(session_id) {
                // Another start won the race; this agent dies on drop.
                return Ok(());
            }
            map.insert(session_id.to_string(), live.clone());
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

        if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            self.dispatch(&live, prompt);
        }
        Ok(())
    }

    /// Starts the chat unless it is already live.
    pub(crate) async fn ensure_started(
        &self,
        session_id: &str,
        acp_command: &str,
        cwd: &Path,
        initial_prompt: Option<&str>,
    ) -> ChatResult<()> {
        self.start(session_id, acp_command, cwd, initial_prompt)
            .await
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
        self.inner
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(session_id);
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
                let history = live
                    .history
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                (history, Some(live.tx.subscribe()))
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
