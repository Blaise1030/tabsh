//! Token authentication and generation for the daemon.

use axum::extract::Request;
use axum::http::header;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

/// Who a request's token belongs to.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Credential {
    Main,
    /// A device's id.
    Device(String),
}

/// Reads the pairing token from `path`, creating it on first run. It is kept
/// across restarts so a paired browser stays paired.
pub(crate) fn load_or_create_token(path: &Path) -> std::io::Result<String> {
    match std::fs::symlink_metadata(path) {
        Ok(md) => check_token_file(path, &md)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().len() >= 32 => return Ok(t.trim().to_owned()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let token = random_hex(32)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // `mode` only applies when the file is created; a pre-existing
    // short/empty file keeps its old permissions.
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    file.write_all(token.as_bytes())?;
    Ok(token)
}

/// An existing token is only trusted when it is a regular file owned by
/// this user. Loose permissions are repaired to `0600` rather than left
/// readable by other local users; a symlink or a file owned by someone
/// else is refused, so a copied or planted token cannot be followed
/// silently.
fn check_token_file(path: &Path, md: &std::fs::Metadata) -> std::io::Result<()> {
    let invalid = |msg: String| std::io::Error::new(std::io::ErrorKind::InvalidInput, msg);
    if md.file_type().is_symlink() {
        return Err(invalid(format!(
            "token file {} is a symlink; remove it and restart",
            path.display()
        )));
    }
    if !md.is_file() {
        return Err(invalid(format!(
            "token file {} is not a regular file",
            path.display()
        )));
    }
    if md.uid() != unsafe { libc::getuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("token file {} is not owned by this user", path.display()),
        ));
    }
    if md.permissions().mode() & 0o077 != 0 {
        eprintln!(
            "tabsh: tightening permissions on {} to 0600",
            path.display()
        );
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tabsh-auth-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn a_new_token_is_0600_and_round_trips() {
        let path = scratch("new").join("token");
        let token = load_or_create_token(&path).unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(mode(&path), 0o600);
        assert_eq!(load_or_create_token(&path).unwrap(), token);
    }

    #[test]
    fn loose_permissions_on_an_existing_token_are_repaired() {
        let dir = scratch("loose");
        let path = dir.join("token");
        let token = "a".repeat(64);
        std::fs::write(&path, &token).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(load_or_create_token(&path).unwrap(), token);
        assert_eq!(mode(&path), 0o600);
    }

    #[test]
    fn a_symlinked_token_is_refused() {
        let dir = scratch("symlink");
        let real = dir.join("real");
        std::fs::write(&real, "a".repeat(64)).unwrap();
        let path = dir.join("token");
        std::os::unix::fs::symlink(&real, &path).unwrap();
        assert_eq!(
            load_or_create_token(&path).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn a_short_existing_token_is_replaced_at_0600() {
        let dir = scratch("short");
        let path = dir.join("token");
        std::fs::write(&path, "short").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let token = load_or_create_token(&path).unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(mode(&path), 0o600);
    }
}
