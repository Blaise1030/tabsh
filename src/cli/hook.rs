//! `tabsh hook <state>`: tell the daemon this tab's agent activity. Agent
//! hooks run it, so it must never fail, block or print: every error is
//! swallowed and the exit code is always 0.

use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

/// How long the whole attempt may take: a hook must not slow the agent.
const TIMEOUT: Duration = Duration::from_secs(1);

/// Posts `state` for the session in `TABSH_SESSION` to the daemon at
/// `TABSH_URL`, reading the token from `TABSH_TOKEN_FILE` (never the
/// environment, which every child of the shell would inherit). Missing any
/// of them — i.e. outside a tabsh tab — there is nothing to do.
pub(crate) fn run(state: Option<&str>) {
    // `tabsh hook` with no argument reads an agent's hook JSON from stdin;
    // that mode arrives with the agent-event mapping.
    let Some(state) = state else { return };
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
    let _ = send(&url, &session, token.trim(), state);
}

/// One minimal HTTP/1.1 POST over a plain `TcpStream`: the hook runs
/// wherever the agent does and must not grow dependencies.
fn send(url: &str, session: &str, token: &str, state: &str) -> std::io::Result<()> {
    // `http://127.0.0.1:7681` → the authority to connect to.
    let authority = url
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or_default();
    let Some(addr) = authority.to_socket_addrs()?.next() else {
        return Ok(());
    };
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_read_timeout(Some(TIMEOUT))?;
    stream.set_write_timeout(Some(TIMEOUT))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::scratch;
    use std::{
        io::{Read, Write},
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
        // spent. (`run` returning is `main` returning: exit code 0.)
        unsafe { std::env::remove_var("TABSH_SESSION") };
        let start = Instant::now();
        run(Some("running"));
        run(None); // `tabsh hook` with stdin JSON is a later slice
        assert!(
            start.elapsed() < Duration::from_millis(100),
            "without TABSH_SESSION it returns at once"
        );

        // A session and a token, but a daemon that isn't there: the 1s
        // overall timeout bounds it, quietly.
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
        assert!(start.elapsed() < Duration::from_secs(2));

        let _ = std::fs::remove_dir_all(dir);
    }
}
