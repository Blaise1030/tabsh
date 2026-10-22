//! Hand-rolled ACP client: newline-delimited JSON-RPC 2.0 over stdio.
//!
//! Methods (ACP current names): client→agent `initialize`, `session/new`,
//! `session/prompt`, `session/cancel` (notification); agent→client
//! `session/update` (notification) and `session/request_permission`
//! (request, answered from the UI via `answer_permission`).

// Consumers (manager/routes) land in Tasks 4/6; tests exercise this now.
#![allow(dead_code)]
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex as AsyncMutex, mpsc, oneshot},
};

use crate::error::BoxError;

pub(crate) type Result<T> = std::result::Result<T, BoxError>;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeResult {
    pub(crate) protocol_version: Value,
    #[serde(default)]
    pub(crate) agent_capabilities: Value,
    #[serde(default)]
    pub(crate) agent_info: Option<Value>,
    #[serde(default)]
    pub(crate) auth_methods: Vec<Value>,
}

/// An agent→client occurrence, buffered while a prompt turn runs.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AcpEvent {
    AgentMessageChunk {
        session_id: String,
        text: String,
    },
    AgentThoughtChunk {
        session_id: String,
        text: String,
    },
    UserMessageChunk {
        session_id: String,
        text: String,
    },
    ToolCall {
        session_id: String,
        update: Value,
    },
    ToolCallUpdate {
        session_id: String,
        update: Value,
    },
    Plan {
        session_id: String,
        update: Value,
    },
    /// The agent said this session is over (`sessionUpdate: session_end`).
    /// Stable ACP does not require this; we honor it when an agent sends it.
    SessionEnded {
        session_id: String,
    },
    PermissionRequest {
        session_id: String,
        request_id: String,
        tool_call: Value,
        options: Value,
    },
    /// Synthesised from the `session/prompt` response.
    PromptEnded {
        session_id: String,
        stop_reason: String,
    },
    Unknown {
        session_id: String,
        update: Value,
    },
}

struct RpcWait {
    pending: HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>,
    /// The `session/prompt` request still in flight, if any.
    prompt: Option<u64>,
}

struct OpenPermission {
    rpc_id: Value,
    options: Value,
}

/// All request/notify methods take `&self` (ids and the event receiver use
/// interior mutability, stdin/pending are already shared), so a caller can
/// hold the client in an `Arc` and `cancel` while a `prompt` is in flight.
pub(crate) struct AcpClient {
    child: Child,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    rpc: Arc<Mutex<RpcWait>>,
    permissions: Arc<Mutex<HashMap<String, OpenPermission>>>,
    events: mpsc::UnboundedSender<AcpEvent>,
    event_rx: Mutex<Option<mpsc::UnboundedReceiver<AcpEvent>>>,
    reader: tokio::task::JoinHandle<()>,
    next_id: AtomicU64,
}

fn chunk_text(update: &Value) -> String {
    let content = update.get("content").cloned().unwrap_or(Value::Null);
    match content.get("text").and_then(Value::as_str) {
        Some(text) => text.to_string(),
        None if content.is_string() => content.as_str().unwrap_or_default().to_string(),
        None => String::new(),
    }
}

fn parse_update(session_id: &str, update: &Value) -> AcpEvent {
    let session_id = session_id.to_string();
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => AcpEvent::AgentMessageChunk {
            text: chunk_text(update),
            session_id,
        },
        Some("agent_thought_chunk") => AcpEvent::AgentThoughtChunk {
            text: chunk_text(update),
            session_id,
        },
        Some("user_message_chunk") => AcpEvent::UserMessageChunk {
            text: chunk_text(update),
            session_id,
        },
        Some("tool_call") => AcpEvent::ToolCall {
            update: update.clone(),
            session_id,
        },
        Some("tool_call_update") => AcpEvent::ToolCallUpdate {
            update: update.clone(),
            session_id,
        },
        Some("plan") => AcpEvent::Plan {
            update: update.clone(),
            session_id,
        },
        Some("session_end") => AcpEvent::SessionEnded { session_id },
        _ => AcpEvent::Unknown {
            update: update.clone(),
            session_id,
        },
    }
}

async fn write_line(stdin: &Arc<AsyncMutex<ChildStdin>>, msg: &Value) -> Result<()> {
    let mut line = serde_json::to_string(msg)?;
    line.push('\n');
    // One writer at a time (client or the reader task answering a
    // permission request), so lines never interleave.
    let mut guard = stdin.lock().await;
    guard.write_all(line.as_bytes()).await?;
    guard.flush().await?;
    Ok(())
}

/// Allow selects `allow_once` / `allow_always`; deny selects a reject
/// option. No matching option cancels the request.
fn permission_outcome(allow: bool, options: &Value) -> Value {
    let kinds: &[&str] = if allow {
        &["allow_once", "allow_always"]
    } else {
        &["reject_once", "reject_always"]
    };
    let option_id = options.as_array().and_then(|opts| {
        opts.iter()
            .find(|o| {
                o.get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kinds.contains(&kind))
            })
            .and_then(|o| o.get("optionId").cloned())
    });
    match option_id {
        Some(option_id) => json!({"outcome": "selected", "optionId": option_id}),
        None => json!({"outcome": "cancelled"}),
    }
}

impl AcpClient {
    pub(crate) async fn spawn(cmd: &str, args: &[String], cwd: &Path) -> Result<AcpClient> {
        let mut child = Command::new(cmd)
            .args(args)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn ACP agent `{cmd}`: {e}"))?;
        let stdin = Arc::new(AsyncMutex::new(
            child.stdin.take().ok_or("ACP agent has no stdin")?,
        ));
        let stdout = child.stdout.take().ok_or("ACP agent has no stdout")?;
        let rpc = Arc::new(Mutex::new(RpcWait {
            pending: HashMap::new(),
            prompt: None,
        }));
        let permissions: Arc<Mutex<HashMap<String, OpenPermission>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (events, event_rx) = mpsc::unbounded_channel();
        let reader = {
            let stdin = stdin.clone();
            let rpc = rpc.clone();
            let permissions = permissions.clone();
            let events = events.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        continue; // not JSON-RPC: agent noise, skip the line
                    };
                    let method = msg.get("method").and_then(Value::as_str);
                    let id = msg.get("id").cloned().unwrap_or(Value::Null);
                    match method {
                        Some("session/update") => {
                            let params = msg.get("params").cloned().unwrap_or(Value::Null);
                            let sid = params
                                .get("sessionId")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let update = params.get("update").cloned().unwrap_or(Value::Null);
                            let _ = events.send(parse_update(sid, &update));
                        }
                        Some("session/request_permission") if !id.is_null() => {
                            let params = msg.get("params").cloned().unwrap_or(Value::Null);
                            let sid = params
                                .get("sessionId")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let options = params.get("options").cloned().unwrap_or(Value::Null);
                            let tool_call = params.get("toolCall").cloned().unwrap_or(Value::Null);
                            let request_id = match &id {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            permissions
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .insert(
                                    request_id.clone(),
                                    OpenPermission {
                                        rpc_id: id,
                                        options: options.clone(),
                                    },
                                );
                            // The UI answers; the reader must keep going so
                            // a cancel can still be written and read.
                            let _ = events.send(AcpEvent::PermissionRequest {
                                session_id: sid,
                                request_id,
                                tool_call,
                                options,
                            });
                        }
                        Some(_) if !id.is_null() => {
                            let _ = write_line(
                                &stdin,
                                &json!({"jsonrpc": "2.0", "id": id, "error":
                                        {"code": -32601, "message": "method not found"}}),
                            )
                            .await;
                        }
                        _ if !id.is_null() => {
                            if let Some(id_num) = id.as_u64() {
                                let tx = rpc
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .pending
                                    .remove(&id_num);
                                if let Some(tx) = tx {
                                    let result = match msg.get("error") {
                                        Some(err) => Err(format!("ACP error: {err}")),
                                        None => {
                                            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                                        }
                                    };
                                    let _ = tx.send(result);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                // Agent exited: fail every call still waiting on it.
                let mut guard = rpc.lock().unwrap_or_else(|e| e.into_inner());
                for (_, tx) in guard.pending.drain() {
                    let _ = tx.send(Err("ACP agent exited".to_string()));
                }
            })
        };
        Ok(AcpClient {
            child,
            stdin,
            rpc,
            permissions,
            events,
            event_rx: Mutex::new(Some(event_rx)),
            reader,
            next_id: AtomicU64::new(1),
        })
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.call(method, params, false).await
    }

    /// `prompt` marks the id so `cancel` can finish the turn without waiting
    /// for an agent that never answers `session/cancel`.
    async fn call(&self, method: &str, params: Value, prompt: bool) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut rpc = self.rpc.lock().unwrap_or_else(|e| e.into_inner());
            rpc.pending.insert(id, tx);
            if prompt {
                rpc.prompt = Some(id);
            }
        }
        if let Err(e) = write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
        )
        .await
        {
            let mut rpc = self.rpc.lock().unwrap_or_else(|e| e.into_inner());
            rpc.pending.remove(&id);
            if rpc.prompt == Some(id) {
                rpc.prompt = None;
            }
            return Err(e);
        }
        let result = match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(e)) => Err(e.into()),
            Err(_) => Err("ACP agent exited".into()),
        };
        if prompt {
            let mut rpc = self.rpc.lock().unwrap_or_else(|e| e.into_inner());
            if rpc.prompt == Some(id) {
                rpc.prompt = None;
            }
        }
        result
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        )
        .await
    }

    pub(crate) async fn initialize(&self) -> Result<InitializeResult> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {},
                    "clientInfo": {"name": "tabsh", "version": env!("CARGO_PKG_VERSION")},
                }),
            )
            .await?;
        Ok(serde_json::from_value(result)?)
    }

    pub(crate) async fn session_new(&self, cwd: &Path) -> Result<String> {
        let result = self
            .request(
                "session/new",
                json!({"cwd": cwd.to_string_lossy(), "mcpServers": []}),
            )
            .await?;
        result
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "ACP session/new gave no sessionId".into())
    }

    /// Sends the prompt and waits for the turn to finish; `session/update`
    /// events meanwhile are buffered for `event_stream`, and a synthesised
    /// `PromptEnded` (from the response `stopReason`) closes the turn.
    pub(crate) async fn prompt(&self, session_id: &str, text: &str) -> Result<()> {
        let result = self
            .call(
                "session/prompt",
                json!({"sessionId": session_id,
                       "prompt": [{"type": "text", "text": text}]}),
                true,
            )
            .await?;
        let stop_reason = result
            .get("stopReason")
            .and_then(Value::as_str)
            .unwrap_or("end_turn")
            .to_string();
        let _ = self.events.send(AcpEvent::PromptEnded {
            session_id: session_id.to_string(),
            stop_reason,
        });
        Ok(())
    }

    /// `allow` picks an allow option; otherwise a reject option. With no
    /// matching option the request is cancelled. An unknown id is a no-op
    /// so a repeated approve still acknowledges.
    pub(crate) async fn answer_permission(&self, request_id: &str, allow: bool) -> Result<()> {
        let pending = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id);
        let Some(pending) = pending else {
            return Ok(());
        };
        let outcome = permission_outcome(allow, &pending.options);
        write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "id": pending.rpc_id,
                    "result": {"outcome": outcome}}),
        )
        .await
    }

    pub(crate) async fn cancel(&self, session_id: &str) -> Result<()> {
        // Unblock an agent sitting in `session/request_permission` before
        // the cancel notification, or it would read that line as the answer.
        let pending: Vec<OpenPermission> = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .map(|(_, permission)| permission)
            .collect();
        for permission in pending {
            write_line(
                &self.stdin,
                &json!({"jsonrpc": "2.0", "id": permission.rpc_id,
                        "result": {"outcome": {"outcome": "cancelled"}}}),
            )
            .await?;
        }
        self.notify("session/cancel", json!({"sessionId": session_id}))
            .await?;
        // Finish the turn locally so the composer unlocks even when the
        // agent never answers the prompt.
        let tx = {
            let mut rpc = self.rpc.lock().unwrap_or_else(|e| e.into_inner());
            rpc.prompt.take().and_then(|id| rpc.pending.remove(&id))
        };
        if let Some(tx) = tx {
            let _ = tx.send(Ok(json!({"stopReason": "cancelled"})));
        }
        Ok(())
    }

    /// Takes the buffered event receiver (once). Events are queued from
    /// spawn, so events from a finished `prompt` are still delivered.
    pub(crate) fn event_stream(&self) -> mpsc::UnboundedReceiver<AcpEvent> {
        self.event_rx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .expect("event_stream is taken only once")
    }

    pub(crate) async fn shutdown(mut self) -> Result<()> {
        self.reader.abort();
        self.child.kill().await?;
        let _ = self.child.wait().await;
        Ok(())
    }
}

/// The fake agent is a test-only Python script tests write to a temp file
/// and spawn through the real `AcpClient` stdio path — no extra binary
/// target ships in the daemon. Shared by the chat manager/route tests.
#[cfg(test)]
pub(crate) const FAKE_AGENT_PY: &str = r#"
import json, sys, time

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def update(session_id, upd):
    send({"jsonrpc": "2.0", "method": "session/update",
          "params": {"sessionId": session_id, "update": upd}})

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")
    mid = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": 1, "agentCapabilities": {},
            "agentInfo": {"name": "fake-agent", "version": "0.1.0"},
            "authMethods": []}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": "fake-session-1"}})
    elif method == "session/prompt":
        sid = params.get("sessionId", "")
        text = "".join(c.get("text", "") for c in params.get("prompt", [])
                       if c.get("type") == "text")
        if "stuck" in text:
            update(sid, {"sessionUpdate": "agent_message_chunk",
                         "content": {"type": "text", "text": "stuck started"}})
            while True:
                nxt = sys.stdin.readline()
                if not nxt:
                    break
            continue
        if "hold" in text:
            update(sid, {"sessionUpdate": "agent_message_chunk",
                         "content": {"type": "text", "text": "holding"}})
            time.sleep(0.4)
            send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
            continue
        if "end session" in text:
            update(sid, {"sessionUpdate": "session_end"})
        if "slow" in text:
            update(sid, {"sessionUpdate": "agent_message_chunk",
                         "content": {"type": "text", "text": "slow started"}})
            cancelled = False
            while True:
                nxt = sys.stdin.readline()
                if not nxt:
                    break
                if json.loads(nxt).get("method") == "session/cancel":
                    cancelled = True
                    break
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "stopReason": "cancelled" if cancelled else "end_turn"}})
            continue
        if "permission" in text:
            if "no_allow" in text:
                opts = [{"optionId": "deny", "name": "Deny", "kind": "reject_once"}]
            else:
                opts = [{"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                        {"optionId": "deny", "name": "Deny", "kind": "reject_once"}]
            send({"jsonrpc": "2.0", "id": 9000,
                  "method": "session/request_permission",
                  "params": {"sessionId": sid,
                             "toolCall": {"toolCallId": "tc-1", "title": "Fake tool"},
                             "options": opts}})
            resp = json.loads(sys.stdin.readline())  # permission response
            outcome = (resp.get("result") or {}).get("outcome") or {}
            if outcome.get("outcome") == "selected":
                outcome_text = "selected:" + str(outcome.get("optionId"))
            else:
                outcome_text = str(outcome.get("outcome", "unknown"))
            update(sid, {"sessionUpdate": "agent_message_chunk",
                         "content": {"type": "text",
                                     "text": "permission outcome: " + outcome_text}})
        update(sid, {"sessionUpdate": "agent_message_chunk",
                     "content": {"type": "text", "text": "fake reply: " + text}})
        update(sid, {"sessionUpdate": "agent_message_chunk",
                     "content": {"type": "text", "text": " (done)"}})
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
    elif method == "session/cancel":
        pass
    elif mid is not None:
        send({"jsonrpc": "2.0", "id": mid,
              "error": {"code": -32601, "message": "unknown method"}})
"#;

#[cfg(test)]
pub(crate) fn fake_agent() -> (String, Vec<String>) {
    let path = std::env::temp_dir().join(format!(
        "tabsh-fake-acp-{}-{}.py",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(&path, FAKE_AGENT_PY).unwrap();
    (
        "python3".to_string(),
        vec![path.to_string_lossy().into_owned()],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::normalize::{UiChunk, to_chunks};

    #[tokio::test]
    async fn acp_client_prompt_receives_session_update() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let client = AcpClient::spawn(&cmd, &args, &cwd).await.unwrap();

        let init = client.initialize().await.unwrap();
        assert_eq!(init.protocol_version, serde_json::json!(1));

        let session_id = client.session_new(&cwd).await.unwrap();
        assert_eq!(session_id, "fake-session-1");

        client.prompt(&session_id, "hi").await.unwrap();

        let mut chunks: Vec<UiChunk> = Vec::new();
        let mut rx = client.event_stream();
        while let Some(ev) = rx.recv().await {
            let is_end = matches!(ev, AcpEvent::PromptEnded { .. });
            chunks.extend(to_chunks(&ev));
            if is_end {
                break;
            }
        }
        client.shutdown().await.unwrap();

        let text: String = chunks
            .iter()
            .filter_map(|c| match c {
                UiChunk::TextDelta { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(text.contains("fake reply: hi"), "chunks: {chunks:?}");
        assert!(
            matches!(chunks.last(), Some(UiChunk::TurnEnd { stop_reason, .. }) if stop_reason == "end_turn"),
            "chunks: {chunks:?}"
        );
    }

    async fn prompt_and_answer(
        client: &Arc<AcpClient>,
        session_id: &str,
        text: &str,
        allow: bool,
    ) -> String {
        let mut rx = client.event_stream();
        let worker = client.clone();
        let sid = session_id.to_string();
        let text = text.to_string();
        let prompt = tokio::spawn(async move { worker.prompt(&sid, &text).await });
        let mut request_id = None;
        let mut body = String::new();
        while let Some(ev) = rx.recv().await {
            match ev {
                AcpEvent::PermissionRequest { request_id: id, .. } => {
                    request_id = Some(id);
                    break;
                }
                AcpEvent::AgentMessageChunk { text, .. } => body.push_str(&text),
                AcpEvent::PromptEnded { .. } => break,
                _ => {}
            }
        }
        let request_id = request_id.expect("permission request");
        client.answer_permission(&request_id, allow).await.unwrap();
        while let Some(ev) = rx.recv().await {
            let ended = matches!(ev, AcpEvent::PromptEnded { .. });
            if let AcpEvent::AgentMessageChunk { text, .. } = &ev {
                body.push_str(text);
            }
            if ended {
                break;
            }
        }
        prompt.await.unwrap().unwrap();
        body
    }

    #[tokio::test]
    async fn acp_client_allow_answers_permission_with_the_allow_option() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let client = Arc::new(AcpClient::spawn(&cmd, &args, &cwd).await.unwrap());
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        let text = prompt_and_answer(&client, &session_id, "needs permission", true).await;
        Arc::try_unwrap(client)
            .unwrap_or_else(|_| panic!("prompt task still holds the client"))
            .shutdown()
            .await
            .unwrap();
        assert!(
            text.contains("permission outcome: selected:allow"),
            "events text: {text}"
        );
    }

    #[tokio::test]
    async fn acp_client_cancel_during_in_flight_prompt() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let client = Arc::new(AcpClient::spawn(&cmd, &args, &cwd).await.unwrap());
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        let mut rx = client.event_stream();

        // Prompt runs on another task; cancel must work through `&self`
        // while that prompt future is still in flight.
        let prompt_client = client.clone();
        let prompt_sid = session_id.clone();
        let prompt_task =
            tokio::spawn(async move { prompt_client.prompt(&prompt_sid, "slow please").await });

        // Wait until the fake agent confirms the slow turn has started.
        let mut started = false;
        while let Some(ev) = rx.recv().await {
            if matches!(&ev, AcpEvent::AgentMessageChunk { text, .. } if text == "slow started") {
                started = true;
                break;
            }
        }
        assert!(started);

        client.cancel(&session_id).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), prompt_task)
            .await
            .expect("prompt did not finish after cancel")
            .unwrap()
            .unwrap();

        let mut stop_reason = None;
        while let Some(ev) = rx.recv().await {
            if let AcpEvent::PromptEnded { stop_reason: r, .. } = ev {
                stop_reason = Some(r);
                break;
            }
        }
        assert_eq!(stop_reason.as_deref(), Some("cancelled"));

        Arc::try_unwrap(client)
            .unwrap_or_else(|_| panic!("prompt task still holds the client"))
            .shutdown()
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn acp_client_permission_without_allow_option_is_cancelled() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let client = Arc::new(AcpClient::spawn(&cmd, &args, &cwd).await.unwrap());
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        let text =
            prompt_and_answer(&client, &session_id, "no_allow permission please", true).await;
        Arc::try_unwrap(client)
            .unwrap_or_else(|_| panic!("prompt task still holds the client"))
            .shutdown()
            .await
            .unwrap();
        assert!(
            text.contains("permission outcome: cancelled"),
            "events text: {text}"
        );
    }

    #[tokio::test]
    async fn acp_client_cancel_is_accepted() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let client = AcpClient::spawn(&cmd, &args, &cwd).await.unwrap();
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        client.cancel(&session_id).await.unwrap();
        client.shutdown().await.unwrap();
    }
}
