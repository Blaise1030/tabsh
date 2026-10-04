//! Saving the pane's edits safely: version-checked, atomic, keeping permissions.

use super::read::{TEXT_LIMIT_BYTES, version_of};
use crate::auth::random_hex;
use std::{io::Write, os::unix::fs::OpenOptionsExt};

pub(super) enum SaveError {
    /// The file changed since it was read; carries its current version.
    Conflict(String),
    TooLarge,
    Io(std::io::Error),
}

impl From<std::io::Error> for SaveError {
    fn from(e: std::io::Error) -> Self {
        SaveError::Io(e)
    }
}

/// Replaces the file with `content` unless it changed since `expected` was
/// read. Writes a temp file beside it and renames over it, so a crash never
/// leaves a half-written file; a symlink's target is saved, not the link.
pub(super) fn save_file(
    path: &std::path::Path,
    content: &[u8],
    expected: &str,
) -> Result<String, SaveError> {
    if content.len() as u64 > TEXT_LIMIT_BYTES {
        return Err(SaveError::TooLarge);
    }
    let path = std::fs::canonicalize(path)?;
    let meta = std::fs::metadata(&path)?;
    let current = version_of(&meta);
    if current != expected {
        return Err(SaveError::Conflict(current));
    }
    let name = path
        .file_name()
        .map_or_else(|| "file".to_string(), |n| n.to_string_lossy().into_owned());
    let tmp = path.with_file_name(format!(".{name}.tabsh-{}", random_hex(6)?));
    let write = || -> std::io::Result<String> {
        use std::os::unix::fs::PermissionsExt;
        let mut f = create_temp(&tmp, meta.permissions().mode())?;
        f.write_all(content)?;
        f.sync_all()?;
        // Again, for any bits the umask stripped at creation.
        std::fs::set_permissions(&tmp, meta.permissions())?;
        std::fs::rename(&tmp, &path)?;
        Ok(version_of(&std::fs::metadata(&path)?))
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        SaveError::Io(e)
    })
}

/// A new file that has `mode` from the moment it exists, so a private file's
/// contents are never readable by others while it is being written.
pub(super) fn create_temp(tmp: &std::path::Path, mode: u32) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(tmp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::scratch;

    #[test]
    fn save_file_writes_and_returns_new_version() {
        let dir = scratch();
        let f = dir.join("a.txt");
        std::fs::write(&f, "old").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        let nv = save_file(&f, b"new!", &v).ok().unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "new!");
        assert_eq!(nv, version_of(&std::fs::metadata(&f).unwrap()));
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            1,
            "no temp file left behind"
        );
    }

    #[test]
    fn save_file_refuses_a_stale_version() {
        let dir = scratch();
        let f = dir.join("a.txt");
        std::fs::write(&f, "old").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        std::fs::write(&f, "changed in vim").unwrap();
        match save_file(&f, b"mine", &v) {
            Err(SaveError::Conflict(cur)) => {
                assert_eq!(cur, version_of(&std::fs::metadata(&f).unwrap()))
            }
            _ => panic!("expected a conflict"),
        }
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "changed in vim");
    }

    #[test]
    fn save_file_keeps_permissions_and_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        let f = dir.join("run.sh");
        std::fs::write(&f, "echo hi").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        let link = dir.join("link.sh");
        std::os::unix::fs::symlink(&f, &link).unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        save_file(&link, b"echo bye", &v).ok().unwrap();
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "echo bye");
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    fn save_file_keeps_a_private_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        let f = dir.join("secret.env");
        std::fs::write(&f, "A=1").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600)).unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        save_file(&f, b"A=2", &v).ok().unwrap();
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn temp_file_is_created_with_the_mode() {
        use std::os::unix::fs::PermissionsExt;
        // No set_permissions here: the mode must be on the file from creation,
        // so it is never readable by others, even briefly. Without it the
        // umask would leave 0o644 (or similar).
        let dir = scratch();
        let tmp = dir.join(".x.tabsh-tmp");
        let _f = create_temp(&tmp, 0o600).unwrap();
        assert_eq!(
            std::fs::metadata(&tmp).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(create_temp(&tmp, 0o600).is_err(), "never reuses a file");
    }
}
