//! `tabsh status`: sets the card of the terminal it runs in. Hooks call it
//! with `--hook`, which must never disturb the agent: silent, always exit 0.

use crate::board::STATUSES;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

const TIMEOUT: Duration = Duration::from_millis(500);

/// What `tabsh status` reads from its surroundings.
pub(super) struct Env {
    pub(super) session: Option<String>,
    pub(super) url: String,
    pub(super) token: Option<String>,
}

impl Env {
    pub(super) fn from_process() -> Env {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        // The token sits next to the state database, as the daemon keeps it.
        let token_path = match var("TABSH_DB") {
            Some(db) => std::path::Path::new(&db).with_file_name("token"),
            None => std::path::Path::new(&var("HOME").unwrap_or_else(|| ".".into()))
                .join(".tabsh/token"),
        };
        Env {
            session: var("TABSH_SESSION_ID"),
            url: var("TABSH_URL").unwrap_or_else(|| "http://127.0.0.1:7681".into()),
            token: std::fs::read_to_string(token_path)
                .ok()
                .map(|t| t.trim().to_owned()),
        }
    }
}

#[derive(Debug)]
pub(super) struct Parsed {
    pub(super) status: String,
    pub(super) note: Option<String>,
    pub(super) unless: Option<String>,
    pub(super) hook: bool,
    /// Under `--hook`, one trailing argument some agents pass their event
    /// JSON in (instead of stdin).
    pub(super) payload: Option<String>,
}

pub(super) fn parse(args: &[String]) -> Result<Parsed, String> {
    let mut it = args.iter();
    let (mut status, mut note, mut unless, mut hook) = (None, None, None, false);
    let mut extra: Vec<&String> = Vec::new();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--hook" => hook = true,
            "--note" => note = Some(it.next().ok_or("--note needs a value")?.clone()),
            "--if-not" => unless = Some(it.next().ok_or("--if-not needs a status")?.clone()),
            s if !s.starts_with("--") && status.is_none() => status = Some(s.to_owned()),
            _ if status.is_some() && extra.is_empty() => extra.push(a),
            other => return Err(format!("unexpected argument '{other}'")),
        }
    }
    // `a` above also takes flags like `--bogus` after the status; only hook mode
    // may carry one extra argument, and it can't look like a flag.
    if let Some(a) = extra.first()
        && (!hook || a.starts_with("--"))
    {
        return Err(format!("unexpected argument '{a}'"));
    }
    let payload = extra.first().map(|a| (*a).clone());
    let status =
        status.ok_or("which status? backlog, in_progress, needs_input, completed or archived")?;
    for s in [Some(&status), unless.as_ref()].into_iter().flatten() {
        if !STATUSES.contains(&s.as_str()) {
            return Err(format!(
                "unknown status '{s}' (use {})",
                STATUSES.join(", ")
            ));
        }
    }
    Ok(Parsed {
        status,
        note,
        unless,
        hook,
        payload,
    })
}

/// The `message` of the hook event the agent writes on stdin (Claude Code's
/// and Gemini CLI's Notification payloads have one; other events don't).
pub(super) fn hook_message(stdin: &mut dyn Read) -> Option<String> {
    let mut buf = Vec::new();
    stdin.take(64 * 1024).read_to_end(&mut buf).ok()?;
    message_of(&buf)
}

fn message_of(json: impl AsRef<[u8]>) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(json.as_ref()).ok()?;
    v.get("message")?.as_str().map(String::from)
}

pub(super) fn run(args: &[String], env: &Env, stdin: &mut dyn Read) -> i32 {
    let hook = args.iter().any(|a| a == "--hook");
    match set(args, env, stdin) {
        Ok(()) => 0,
        Err(_) if hook => 0,
        Err(e) => {
            eprintln!("tabsh status: {e}");
            1
        }
    }
}

fn set(args: &[String], env: &Env, stdin: &mut dyn Read) -> Result<(), String> {
    let p = parse(args)?;
    let id = env
        .session
        .as_deref()
        .ok_or("not inside a tabsh terminal (TABSH_SESSION_ID is not set)")?;
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("odd TABSH_SESSION_ID '{id}'"));
    }
    let note = p.note.or_else(|| {
        if !p.hook {
            return None;
        }
        p.payload
            .as_deref()
            .and_then(message_of)
            .or_else(|| hook_message(stdin))
    });
    let body = serde_json::json!({ "status": p.status, "note": note, "source": "hook", "unless": p.unless }).to_string();
    match patch(&env.url, env.token.as_deref(), id, &body)? {
        200 => Ok(()),
        404 => Err("this terminal's card no longer exists".into()),
        code => Err(format!("the daemon answered {code}")),
    }
}

/// A one-shot HTTP/1.1 PATCH over a plain socket: the daemon is on loopback
/// and this keeps the binary free of an HTTP client crate.
fn patch(url: &str, token: Option<&str>, id: &str, body: &str) -> Result<u16, String> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("TABSH_URL must start with http:// (got '{url}')"))?
        .split('/')
        .next()
        .unwrap_or_default();
    let unreachable = |e: std::io::Error| format!("can't reach the tabsh daemon at {url}: {e}");
    let addr = authority
        .to_socket_addrs()
        .map_err(unreachable)?
        .next()
        .ok_or_else(|| format!("can't resolve {authority}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(unreachable)?;
    stream
        .set_read_timeout(Some(TIMEOUT))
        .map_err(unreachable)?;
    stream
        .set_write_timeout(Some(TIMEOUT))
        .map_err(unreachable)?;
    let auth = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "PATCH /api/sessions/{id}/status HTTP/1.1\r\nHost: {authority}\r\n{auth}\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(unreachable)?;
    let mut head = [0u8; 12]; // "HTTP/1.1 200"
    stream.read_exact(&mut head).map_err(unreachable)?;
    std::str::from_utf8(&head[9..12])
        .ok()
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| "the daemon sent an odd answer".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sessions::store::insert_session, state::router, test_support::test_state};

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }
    fn env(session: Option<&str>, url: &str) -> Env {
        Env {
            session: session.map(String::from),
            url: url.into(),
            token: Some("t0k3n".into()),
        }
    }

    #[test]
    fn hook_mode_never_fails() {
        let e = env(None, "http://127.0.0.1:9");
        assert_eq!(run(&args("in_progress --hook"), &e, &mut &b""[..]), 0);
        let e = env(Some("x"), "http://127.0.0.1:9"); // nothing listens on port 9
        assert_eq!(run(&args("in_progress --hook"), &e, &mut &b""[..]), 0);
        assert_eq!(run(&args("bogus --hook"), &e, &mut &b""[..]), 0);
    }

    #[test]
    fn by_hand_errors_exit_1() {
        assert_eq!(
            run(
                &args("completed"),
                &env(None, "http://127.0.0.1:9"),
                &mut &b""[..]
            ),
            1
        );
        assert_eq!(
            run(
                &args("completed"),
                &env(Some("x"), "http://127.0.0.1:9"),
                &mut &b""[..]
            ),
            1
        );
        assert_eq!(
            run(
                &args("doing"),
                &env(Some("x"), "http://127.0.0.1:9"),
                &mut &b""[..]
            ),
            1
        );
        assert_eq!(
            run(
                &args(""),
                &env(Some("x"), "http://127.0.0.1:9"),
                &mut &b""[..]
            ),
            1
        );
    }

    #[test]
    fn parses_flags() {
        let p = parse(&args("needs_input --hook --if-not completed --note hi")).unwrap();
        assert_eq!(
            (
                p.status.as_str(),
                p.hook,
                p.unless.as_deref(),
                p.note.as_deref()
            ),
            ("needs_input", true, Some("completed"), Some("hi"))
        );
        let p = parse(&[
            "completed".into(),
            "--note".into(),
            "Added tests, all green".into(),
        ])
        .unwrap();
        assert_eq!(p.note.as_deref(), Some("Added tests, all green"));
        assert!(parse(&args("completed --note")).is_err());
    }

    #[test]
    fn a_hook_note_comes_from_the_notification_message() {
        let stdin = br#"{"hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}"#;
        assert_eq!(
            hook_message(&mut &stdin[..]).as_deref(),
            Some("Claude needs your permission to use Bash")
        );
        assert_eq!(hook_message(&mut &br#"{"prompt":"hi"}"#[..]), None);
        assert_eq!(hook_message(&mut &b"not json"[..]), None);
    }

    #[test]
    fn hook_mode_takes_one_trailing_payload_argument() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let p = parse(&a(&["completed", "--hook", r#"{"message":"hi"}"#])).unwrap();
        assert_eq!(p.payload.as_deref(), Some(r#"{"message":"hi"}"#));
        assert!(p.hook);
        assert!(parse(&a(&["completed", "--hook", "x", "y"])).is_err());
        assert!(parse(&a(&["completed", "--hook", "--bogus"])).is_err());
        assert!(
            parse(&a(&["completed", r#"{"message":"hi"}"#])).is_err(),
            "without --hook an extra positional stays an error"
        );
        assert_eq!(message_of(r#"{"message":"hi"}"#).as_deref(), Some("hi"));
        assert_eq!(message_of("nope"), None);
        assert_eq!(message_of(r#"{"message":3}"#), None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_moves_a_real_card() {
        let st = test_state();
        let id = insert_session(&st.db.lock().unwrap(), None).unwrap().id;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = router(st.clone());
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
        });
        let (u, i) = (url.clone(), id.clone());
        let code = tokio::task::spawn_blocking(move || {
            run(
                &args("completed --note done"),
                &env(Some(&i), &u),
                &mut &b""[..],
            )
        })
        .await
        .unwrap();
        assert_eq!(code, 0);
        let status: String = st
            .db
            .lock()
            .unwrap()
            .query_row("SELECT status FROM sessions WHERE id = ?1", [&id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "completed");
        let code = tokio::task::spawn_blocking(move || {
            run(&args("completed"), &env(Some("gone"), &url), &mut &b""[..])
        })
        .await
        .unwrap();
        assert_eq!(code, 1, "unknown session by hand is an error");
    }
}
