//! Token authentication and generation for the daemon.

use axum::extract::Request;
use axum::http::header;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

pub(crate) fn load_or_create_token(path: &Path) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().len() >= 32 => return Ok(t.trim().to_owned()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let token = random_hex(32)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?
        .write_all(token.as_bytes())?;
    Ok(token)
}

pub(crate) fn random_hex(len: usize) -> std::io::Result<String> {
    let mut bytes = vec![0u8; len];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Compares in constant time so response timing doesn't leak the token.
pub(crate) fn token_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// `Authorization: Bearer <token>`, or `?token=` for WebSockets, which can't
/// set headers from a browser.
pub(crate) fn presented_token(req: &Request) -> Option<&str> {
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    bearer.or_else(|| {
        req.uri()
            .query()?
            .split('&')
            .find_map(|kv| kv.strip_prefix("token="))
    })
}
