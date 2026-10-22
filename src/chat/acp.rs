//! Hand-rolled ACP client: newline-delimited JSON-RPC 2.0 over stdio.
//!
//! Methods (ACP current names): client→agent `initialize`, `session/new`,
//! `session/prompt`, `session/cancel` (notification); agent→client
//! `session/update` (notification) and `session/request_permission`
//! (request, auto-allowed here — Task 7 answers from the UI instead).

// Consumers (manager/routes) land in Tasks 4/6; tests exercise this now.
#![allow(dead_code)]
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
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

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>>;

pub(crate) struct AcpClient {
    child: Child,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    pending: Pending,
    events: mpsc::UnboundedSender<AcpEvent>,
    event_rx: Option<mpsc::UnboundedReceiver<AcpEvent>>,
    reader: tokio::task::JoinHandle<()>,
    next_id: u64,
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
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (events, event_rx) = mpsc::unbounded_channel();
        let reader = {
            let stdin = stdin.clone();
            let pending = pending.clone();
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
                            let _ = events.send(AcpEvent::PermissionRequest {
                                session_id: sid,
                                request_id: match &id {
                                    Value::String(s) => s.clone(),
                                    other => other.to_string(),
                                },
                                tool_call,
                                options: options.clone(),
                            });
                            // Task 3 auto-allows; Task 7 answers from the UI.
                            let allow = options
                                .as_array()
                                .and_then(|opts| {
                                    opts.iter()
                                        .find(|o| {
                                            matches!(
                                                o.get("kind").and_then(Value::as_str),
                                                Some("allow_once" | "allow_always")
                                            )
                                        })
                                        .or_else(|| opts.first())
                                })
                                .and_then(|o| o.get("optionId").cloned());
                            let outcome = match allow {
                                Some(option_id) => {
                                    json!({"outcome": "selected", "optionId": option_id})
                                }
                                None => json!({"outcome": "cancelled"}),
                            };
                            let _ = write_line(
                                &stdin,
                                &json!({"jsonrpc": "2.0", "id": id,
                                        "result": {"outcome": outcome}}),
                            )
                            .await;
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
                                let tx = pending
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
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
                let mut guard = pending.lock().unwrap_or_else(|e| e.into_inner());
                for (_, tx) in guard.drain() {
                    let _ = tx.send(Err("ACP agent exited".to_string()));
                }
            })
        };
        Ok(AcpClient {
            child,
            stdin,
            pending,
            events,
            event_rx: Some(event_rx),
            reader,
            next_id: 1,
        })
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        if let Err(e) = write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
        )
        .await
        {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err(e);
        }
        match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(e)) => Err(e.into()),
            Err(_) => Err("ACP agent exited".into()),
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        )
        .await
    }

    pub(crate) async fn initialize(&mut self) -> Result<InitializeResult> {
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

    pub(crate) async fn session_new(&mut self, cwd: &Path) -> Result<String> {
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
    pub(crate) async fn prompt(&mut self, session_id: &str, text: &str) -> Result<()> {
        let result = self
            .request(
                "session/prompt",
                json!({"sessionId": session_id,
                       "prompt": [{"type": "text", "text": text}]}),
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

    pub(crate) async fn cancel(&mut self, session_id: &str) -> Result<()> {
        self.notify("session/cancel", json!({"sessionId": session_id}))
            .await
    }

    /// Takes the buffered event receiver (once). Events are queued from
    /// spawn, so events from a finished `prompt` are still delivered.
    pub(crate) fn event_stream(&mut self) -> mpsc::UnboundedReceiver<AcpEvent> {
        self.event_rx
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::normalize::{UiChunk, to_chunks};

    /// The fake agent is a test-only Python script this test writes to a
    /// temp file and spawns through the real `AcpClient` stdio path — no
    /// extra binary target ships in the daemon.
    const FAKE_AGENT_PY: &str = r#"
import json, sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def update(session_id, upd):
    send({"jsonrpc": "2.0", "method": "session/update",
          "params": {"sessionId": session_id, "update": upd}})

for line in sys.stdin:
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
        if "permission" in text:
            send({"jsonrpc": "2.0", "id": 9000,
                  "method": "session/request_permission",
                  "params": {"sessionId": sid,
                             "toolCall": {"toolCallId": "tc-1", "title": "Fake tool"},
                             "options": [
                                 {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                                 {"optionId": "deny", "name": "Deny", "kind": "reject_once"}]}})
            sys.stdin.readline()  # the client's permission response
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

    fn fake_agent() -> (String, Vec<String>) {
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

    #[tokio::test]
    async fn acp_client_prompt_receives_session_update() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let mut client = AcpClient::spawn(&cmd, &args, &cwd).await.unwrap();

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

    #[tokio::test]
    async fn acp_client_auto_allows_permission_request() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let mut client = AcpClient::spawn(&cmd, &args, &cwd).await.unwrap();
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        client
            .prompt(&session_id, "needs permission")
            .await
            .unwrap();

        let mut saw_permission = false;
        let mut rx = client.event_stream();
        while let Some(ev) = rx.recv().await {
            if matches!(ev, AcpEvent::PermissionRequest { .. }) {
                saw_permission = true;
            }
            if matches!(ev, AcpEvent::PromptEnded { .. }) {
                break;
            }
        }
        client.shutdown().await.unwrap();
        assert!(saw_permission);
    }

    #[tokio::test]
    async fn acp_client_cancel_is_accepted() {
        let (cmd, args) = fake_agent();
        let cwd = std::env::temp_dir();
        let mut client = AcpClient::spawn(&cmd, &args, &cwd).await.unwrap();
        client.initialize().await.unwrap();
        let session_id = client.session_new(&cwd).await.unwrap();
        client.cancel(&session_id).await.unwrap();
        client.shutdown().await.unwrap();
    }
}
