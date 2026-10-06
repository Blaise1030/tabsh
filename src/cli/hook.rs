//! `tabsh hook`: tell the daemon this tab's agent activity. Agent hooks run
//! it, so it must never fail, block or print: every error is swallowed and
//! the exit code is always 0.
//!
//! - `tabsh hook <state>` posts the state directly, for plugins and
//!   notification commands.
//! - `tabsh hook` reads an agent's hook JSON from stdin and maps its event
//!   to a state ([`map_hook_json`]).

use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::{Duration, Instant},
};

/// How long the whole attempt may take: a hook must not slow the agent.
const TIMEOUT: Duration = Duration::from_secs(1);

/// The fields an agent's hook JSON may carry its event name in, in the
/// order they're tried: whichever holds the event, it is found.
const EVENT_FIELDS: [&str; 4] = ["hook_event_name", "event", "hookName", "agent_action_name"];

/// Posts the session's activity to the daemon at `TABSH_URL`, reading the
/// token from `TABSH_TOKEN_FILE` (never the environment, which every child
/// of the shell would inherit). Missing any of them — i.e. outside a tabsh
/// tab — there is nothing to do.
pub(crate) fn run(state: Option<&str>) {
    let (Some(session), Some(url), Some(token_file)) = (
        std::env::var("TABSH_SESSION").ok(),
        std::env::var("TABSH_URL").ok(),
        std::env::var("TABSH_TOKEN_FILE").ok(),
    ) else {
        return;
    };
    let Ok(token) = std::fs::read_to_string(token_file) else {
        return;
    };
    // One deadline for everything: reading stdin, connecting and the
    // exchange each get only what's left of it.
    let deadline = Instant::now() + TIMEOUT;
    let state = match state {
        Some(state) => Some(state),
        None => read_input(std::io::stdin(), deadline).and_then(|json| map_hook_json(&json)),
    };
    if let Some(state) = state {
        let _ = send(&url, &session, token.trim(), state, deadline);
    }
}

/// A hook event to the activity state it reports, or `None` when nothing
/// should be sent: unknown events, ignored notifications, subagent events
/// and anything unparseable. The table is the agent-activity design's
/// section 3 (docs/superpowers/specs/2026-10-04-agent-activity-design.md).
fn map_hook_json(text: &str) -> Option<&'static str> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let name = EVENT_FIELDS
        .into_iter()
        .find_map(|field| value.get(field).and_then(|v| v.as_str()))?;
    match normalise(name).as_str() {
        // Starting a turn, starting or finishing a tool call is working;
        // finishing one also moves a tab back from needs-input once a
        // permission is granted.
        "userpromptsubmit"
        | "userpromptsubmitted"
        | "beforesubmitprompt"
        | "beforeagent"
        | "pretooluse"
        | "posttooluse"
        | "posttoolusefailure"
        | "beforetool"
        | "aftertool" => Some("running"),
        "permissionrequest" | "elicitation" => Some("needs-input"),
        "notification" => notification_state(&value),
        "stop" | "stopfailure" | "agentstop" | "afteragent" | "sessionend" | "interrupt" => {
            Some("idle")
        }
        // Anything else — unknown events, and subagent events such as
        // SubagentStop, which must not speak for the main agent — sends
        // nothing: the tab's state stands.
        _ => None,
    }
}

/// A `Notification`'s own type decides: a permission or an ask for input
/// needs you; `idle_prompt`, the reminder after a turn ends, changes
/// nothing, so a ✓ stays a ✓.
fn notification_state(value: &serde_json::Value) -> Option<&'static str> {
    let kind = value
        .get("notification_type")
        .or_else(|| value.get("type"))
        .and_then(|v| v.as_str())?;
    match normalise(kind).as_str() {
        "permissionprompt" | "elicitationdialog" | "agentneedsinput" | "toolpermission" => {
            Some("needs-input")
        }
        _ => None,
    }
}

/// `PreToolUse`, `preToolUse` and `pre_tool_use` are one name: case and
/// `_` are ignored.
fn normalise(name: &str) -> String {
    name.chars()
        .filter(|c| *c != '_')
        .flat_map(char::to_lowercase)
        .collect()
}

/// Reads the hook JSON to EOF, giving up at `deadline`: a producer that
/// never closes its pipe must not hold the hook open.
fn read_input<R: Read + Send + 'static>(mut input: R, deadline: Instant) -> Option<String> {
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        // A read that fails holds no event; send what there is.
        let _ = input.read_to_string(&mut text);
        let _ = sent.send(text);
    });
    received.recv_timeout(remaining(deadline)?).ok()
}

/// One minimal HTTP/1.1 POST over a plain `TcpStream`: the hook runs
/// wherever the agent does and must not grow dependencies.
fn send(
    url: &str,
    session: &str,
    token: &str,
    state: &str,
    deadline: Instant,
) -> std::io::Result<()> {
    let Some(authority) = authority(url) else {
        return Ok(());
    };
    let Some(addr) = authority.to_socket_addrs()?.next() else {
        return Ok(());
    };
    let Some(connect) = remaining(deadline) else {
        return Ok(());
    };
    let mut stream = TcpStream::connect_timeout(&addr, connect)?;
    let Some(read) = remaining(deadline) else {
        return Ok(());
    };
    stream.set_read_timeout(Some(read))?;
    let Some(write) = remaining(deadline) else {
        return Ok(());
    };
    stream.set_write_timeout(Some(write))?;
    let body = format!("{{\"state\":\"{state}\"}}");
    let request = format!(
        "POST /api/sessions/{session}/activity HTTP/1.1\r\n\
         Host: {authority}\r\n\
         Authorization: Bearer {token}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len()
    );
    stream.write_all(request.as_bytes())?;
    // Drained so the daemon sees a complete request; the answer is ignored.
    let _ = stream.read(&mut [0u8; 512]);
    Ok(())
}

/// The `host:port` a URL points at. The daemon always writes a literal
/// `http://…` URL, so that scheme is stripped — once — and a scheme-less
/// URL is taken as-is; `https`, which this minimal client cannot speak, is
/// refused.
fn authority(url: &str) -> Option<&str> {
    if let Some(rest) = url.strip_prefix("http://") {
        Some(rest.split('/').next().unwrap_or_default())
    } else if url.starts_with("https://") {
        None
    } else {
        Some(url.split('/').next().unwrap_or_default())
    }
}

/// What's left of the budget, or `None` once it's spent.
fn remaining(deadline: Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::scratch;
    use std::{
        io::{Cursor, Read, Write},
        net::{TcpListener, TcpStream},
        sync::Mutex,
        time::{Duration, Instant},
    };

    /// These tests set process-wide environment variables, so they take
    /// turns (cargo test runs them in parallel threads). A poisoned lock
    /// just means the other test failed; take it anyway.
    static ENV: Mutex<()> = Mutex::new(());
    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        ENV.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads one HTTP request: the header block, then Content-Length bytes.
    fn read_request(stream: &mut TcpStream) -> String {
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];
        while !buf.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            buf.push(byte[0]);
        }
        let headers = String::from_utf8(buf.clone()).unwrap();
        let len: usize = headers
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0);
        let mut body = vec![0u8; len];
        stream.read_exact(&mut body).unwrap();
        buf.extend(body);
        String::from_utf8(buf).unwrap()
    }

    /// One fixture of real hook JSON per agent with command hooks (the
    /// design's section 3 table), each mapped to the state its event
    /// reports. `None` is "send nothing".
    #[test]
    fn agent_hook_json_fixtures_map_to_states() {
        let cases: &[(&str, Option<&str>)] = &[
            // Claude Code: Claude's event names in `hook_event_name`.
            (
                include_str!("tests/hook-json/claude-code/pre-tool-use.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/claude-code/notification-permission-prompt.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/claude-code/notification-elicitation-dialog.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/claude-code/notification-idle-prompt.json"),
                None,
            ),
            (
                include_str!("tests/hook-json/claude-code/stop.json"),
                Some("idle"),
            ),
            (
                include_str!("tests/hook-json/claude-code/subagent-stop.json"),
                None,
            ),
            // Codex: Claude's names.
            (
                include_str!("tests/hook-json/codex/user-prompt-submit.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/codex/notification-permission-prompt.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/codex/session-end.json"),
                Some("idle"),
            ),
            // Gemini CLI: its own event names.
            (
                include_str!("tests/hook-json/gemini-cli/before-submit-prompt.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/gemini-cli/before-agent.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/gemini-cli/before-tool.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/gemini-cli/after-tool.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/gemini-cli/elicitation.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/gemini-cli/after-agent.json"),
                Some("idle"),
            ),
            // Copilot CLI, PascalCase mode; then camelCase mode.
            (
                include_str!("tests/hook-json/copilot-cli/post-tool-use-failure.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/copilot-cli/pre-tool-use.camelcase.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/copilot-cli/agent-stop.json"),
                Some("idle"),
            ),
            // Qwen Code: Claude's names, plus the idle_prompt reminder.
            (
                include_str!("tests/hook-json/qwen-code/user-prompt-submitted.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/qwen-code/notification-idle-prompt.json"),
                None,
            ),
            (
                include_str!("tests/hook-json/qwen-code/interrupt.json"),
                Some("idle"),
            ),
            // Factory Droid: Claude's names.
            (
                include_str!("tests/hook-json/factory-droid/post-tool-use.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/factory-droid/notification-idle-prompt.json"),
                None,
            ),
            (
                include_str!("tests/hook-json/factory-droid/stop-failure.json"),
                Some("idle"),
            ),
            // Continue `cn`: Claude's names.
            (
                include_str!("tests/hook-json/continue-cn/pre-tool-use.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/continue-cn/permission-request.json"),
                Some("needs-input"),
            ),
            // Kimi: Claude's names; the type in either field.
            (
                include_str!("tests/hook-json/kimi/notification-agent-needs-input.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/kimi/notification-tool-permission.json"),
                Some("needs-input"),
            ),
            // Goose: Claude's names in `event`.
            (
                include_str!("tests/hook-json/goose/pre-tool-use.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/goose/notification-permission-prompt.json"),
                Some("needs-input"),
            ),
            (
                include_str!("tests/hook-json/goose/stop.json"),
                Some("idle"),
            ),
            // Augment Auggie: Claude's names.
            (
                include_str!("tests/hook-json/augment-auggie/user-prompt-submit.json"),
                Some("running"),
            ),
            (
                include_str!("tests/hook-json/augment-auggie/stop.json"),
                Some("idle"),
            ),
            // Crush: `event`, and only PreToolUse.
            (
                include_str!("tests/hook-json/crush/pre-tool-use.json"),
                Some("running"),
            ),
            // Kiro CLI's candidate fields: `hookName`, `agent_action_name`.
            (
                include_str!("tests/hook-json/kiro/pre-tool-use.json"),
                Some("running"),
            ),
            (include_str!("tests/hook-json/kiro/stop.json"), Some("idle")),
            (
                include_str!("tests/hook-json/kiro/user-prompt-submit.snakecase.json"),
                Some("running"),
            ),
        ];
        for (json, expected) in cases {
            assert_eq!(map_hook_json(json), *expected, "mapping {json}");
        }
    }

    /// The mapping table, whole: every event of every state, so a name
    /// dropping out of the table is caught even if no agent's fixture
    /// carries it.
    #[test]
    fn every_event_in_the_mapping_table_maps() {
        let cases: &[(&str, &str)] = &[
            (r#"{"hook_event_name":"UserPromptSubmit"}"#, "running"),
            (r#"{"hook_event_name":"UserPromptSubmitted"}"#, "running"),
            (r#"{"hook_event_name":"BeforeSubmitPrompt"}"#, "running"),
            (r#"{"hook_event_name":"BeforeAgent"}"#, "running"),
            (r#"{"hook_event_name":"PreToolUse"}"#, "running"),
            (r#"{"hook_event_name":"PostToolUse"}"#, "running"),
            (r#"{"hook_event_name":"PostToolUseFailure"}"#, "running"),
            (r#"{"hook_event_name":"BeforeTool"}"#, "running"),
            (r#"{"hook_event_name":"AfterTool"}"#, "running"),
            (r#"{"hook_event_name":"PermissionRequest"}"#, "needs-input"),
            (r#"{"hook_event_name":"Elicitation"}"#, "needs-input"),
            (r#"{"hook_event_name":"Stop"}"#, "idle"),
            (r#"{"hook_event_name":"StopFailure"}"#, "idle"),
            (r#"{"hook_event_name":"AgentStop"}"#, "idle"),
            (r#"{"hook_event_name":"AfterAgent"}"#, "idle"),
            (r#"{"hook_event_name":"SessionEnd"}"#, "idle"),
            (r#"{"hook_event_name":"Interrupt"}"#, "idle"),
        ];
        for (json, expected) in cases {
            assert_eq!(map_hook_json(json), Some(*expected), "mapping {json}");
        }
    }

    /// The event name is found wherever the agent put it — every field, in
    /// the documented order — and whatever its spelling.
    #[test]
    fn the_event_name_is_found_in_every_field_and_spelling() {
        for field in EVENT_FIELDS {
            let json = format!(r#"{{"{field}":"PreToolUse"}}"#);
            assert_eq!(map_hook_json(&json), Some("running"), "in {field}");
        }
        for spelling in ["PreToolUse", "preToolUse", "pre_tool_use", "Pre_Tool_Use"] {
            let json = format!(r#"{{"hook_event_name":"{spelling}"}}"#);
            assert_eq!(map_hook_json(&json), Some("running"), "as {spelling}");
        }
        // The first present field wins, whatever the others say.
        assert_eq!(
            map_hook_json(r#"{"hook_event_name":"Stop","event":"PreToolUse"}"#),
            Some("idle")
        );
        assert_eq!(
            map_hook_json(r#"{"event":"Stop","hookName":"PreToolUse"}"#),
            Some("idle")
        );
        assert_eq!(
            map_hook_json(r#"{"hookName":"Stop","agent_action_name":"PreToolUse"}"#),
            Some("idle")
        );
    }

    /// A `Notification`'s own type decides; `idle_prompt` never turns a ✓
    /// back into "needs you".
    #[test]
    fn notification_types_decide_the_state() {
        for kind in [
            "permission_prompt",
            "elicitation_dialog",
            "agent_needs_input",
            "ToolPermission",
        ] {
            assert_eq!(
                map_hook_json(&format!(
                    r#"{{"hook_event_name":"Notification","notification_type":"{kind}"}}"#
                )),
                Some("needs-input"),
                "notification_type {kind}"
            );
            assert_eq!(
                map_hook_json(&format!(r#"{{"event":"Notification","type":"{kind}"}}"#)),
                Some("needs-input"),
                "type {kind}"
            );
        }
        for spelling in ["idle_prompt", "IdlePrompt", "IDLE_PROMPT"] {
            assert_eq!(
                map_hook_json(&format!(
                    r#"{{"hook_event_name":"Notification","notification_type":"{spelling}"}}"#
                )),
                None,
                "idle_prompt as {spelling}"
            );
        }
        // No type, or one nothing maps to, sends nothing; and
        // `notification_type` wins over `type`.
        assert_eq!(map_hook_json(r#"{"hook_event_name":"Notification"}"#), None);
        assert_eq!(
            map_hook_json(r#"{"hook_event_name":"Notification","type":"reminder"}"#),
            None
        );
        assert_eq!(
            map_hook_json(
                r#"{"hook_event_name":"Notification","notification_type":"permission_prompt","type":"idle_prompt"}"#
            ),
            Some("needs-input")
        );
    }

    /// Unknown events, subagent events and unparseable input send nothing.
    #[test]
    fn unknown_and_unparseable_events_send_nothing() {
        for json in [
            "not json",
            "",
            "null",
            "[]",
            "{}",
            r#"{"hook_event_name":"SomethingNew"}"#,
            r#"{"event":42}"#,
            r#"{"hook_event_name":"SubagentStop"}"#,
            r#"{"hook_event_name":"SubagentStart"}"#,
        ] {
            assert_eq!(map_hook_json(json), None, "for {json:?}");
        }
    }

    /// Stdin is read to EOF, but a producer that never closes it cannot
    /// hold the hook past the deadline.
    #[test]
    fn stdin_input_is_read_to_eof_or_gives_up_at_the_deadline() {
        let json = r#"{"hook_event_name":"Stop"}"#;
        assert_eq!(
            read_input(Cursor::new(json), Instant::now() + TIMEOUT),
            Some(json.to_owned())
        );

        /// Never yields EOF, like a hook whose producer forgot the pipe.
        struct Stuck;
        impl Read for Stuck {
            fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
                std::thread::sleep(TIMEOUT * 10);
                Ok(0)
            }
        }
        let start = Instant::now();
        assert_eq!(
            read_input(Stuck, Instant::now() + Duration::from_millis(100)),
            None
        );
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "gave up at the deadline, not the reader's"
        );
    }

    /// A spent deadline means no request at all is worth starting.
    #[test]
    fn send_with_a_spent_deadline_sends_nothing() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        send(&url, "s1", "token", "idle", Instant::now() - TIMEOUT).unwrap();
        // Had anything been sent, the kernel would hold the connection for
        // `accept` to pick up.
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err(), "a request was sent anyway");
    }

    /// The daemon always writes a literal `http://…` URL; that scheme is
    /// stripped once, a scheme-less URL is taken as-is, and `https` —
    /// which this minimal client cannot speak — is refused.
    #[test]
    fn only_http_urls_are_spoken_to() {
        assert_eq!(authority("http://127.0.0.1:7681/"), Some("127.0.0.1:7681"));
        assert_eq!(authority("http://127.0.0.1:7681"), Some("127.0.0.1:7681"));
        assert_eq!(authority("127.0.0.1:7681/x"), Some("127.0.0.1:7681"));
        assert_eq!(authority("https://127.0.0.1:7681"), None);
    }

    #[test]
    fn hook_posts_the_state_to_the_daemon() {
        let _guard = lock_env();
        // A one-shot listener standing in for the daemon. It answers in a
        // thread so the test itself can run `run` in this thread (where the
        // environment variables are set) and time out if nothing arrives.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let dir = scratch();
        let token_file = dir.join("token");
        std::fs::write(&token_file, "s3cret-token").unwrap();
        unsafe {
            std::env::set_var("TABSH_SESSION", "s1");
            std::env::set_var("TABSH_URL", format!("http://{addr}/"));
            std::env::set_var("TABSH_TOKEN_FILE", &token_file);
        }

        let (posted, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n");
            let _ = posted.send(request);
        });
        run(Some("needs-input"));
        let request = rx
            .recv_timeout(Duration::from_secs(3))
            .expect("the hook never posted anything");

        assert!(request.starts_with("POST /api/sessions/s1/activity HTTP/1.1\r\n"));
        assert!(request.contains("Authorization: Bearer s3cret-token\r\n"));
        assert!(request.ends_with(r#"{"state":"needs-input"}"#));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn hook_survives_a_missing_session_and_an_unreachable_daemon() {
        let _guard = lock_env();
        // Outside a tabsh tab there is no session: nothing to do, no time
        // spent — even in the stdin-reading mode. (`run` returning is
        // `main` returning: exit code 0.)
        unsafe { std::env::remove_var("TABSH_SESSION") };
        let start = Instant::now();
        run(Some("running"));
        run(None);
        assert!(
            start.elapsed() < Duration::from_millis(100),
            "without TABSH_SESSION it returns at once"
        );

        // A session and a token, but a daemon that isn't there: the 1s
        // overall deadline bounds it, quietly.
        let dir = scratch();
        let token_file = dir.join("token");
        std::fs::write(&token_file, "s3cret").unwrap();
        unsafe {
            std::env::set_var("TABSH_SESSION", "s1");
            std::env::set_var("TABSH_URL", "http://127.0.0.1:9"); // nothing listens here
            std::env::set_var("TABSH_TOKEN_FILE", &token_file);
        }
        let start = Instant::now();
        run(Some("needs-input"));
        assert!(start.elapsed() < TIMEOUT + Duration::from_millis(500));

        let _ = std::fs::remove_dir_all(dir);
    }
}
