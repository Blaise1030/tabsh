//! Reading a file for the pane: its kind, size, version and (small) text.

use super::kind::{FileKind, file_kind};
use crate::error::internal_error;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use std::{io::Read, os::unix::fs::OpenOptionsExt};

/// Largest text file whose content the file pane receives (and can edit).
pub(super) const TEXT_LIMIT_BYTES: u64 = 2 * 1024 * 1024;

/// Largest file served raw, for previews of images, PDFs and pages.
pub(super) const RAW_LIMIT_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Serialize)]
pub(super) struct FileInfo {
    path: String,
    kind: FileKind,
    size: u64,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    eol: Option<&'static str>,
}

/// Describes `path`, with its text when it is small enough to edit in the
/// pane. Files that aren't wholly valid text get no `content`.
pub(super) fn read_file_info(path: &std::path::Path) -> std::io::Result<FileInfo> {
    let meta = std::fs::metadata(path)?;
    let mut info = FileInfo {
        path: path.to_string_lossy().into_owned(),
        kind: FileKind::Dir,
        size: meta.len(),
        version: version_of(&meta),
        content: None,
        eol: None,
    };
    if meta.is_dir() {
        return Ok(info);
    }
    if !meta.is_file() {
        return Err(not_a_regular_file());
    }
    let mut head = Vec::new();
    open_regular(path)?.take(8192).read_to_end(&mut head)?;
    info.kind = file_kind(path, &head, false);
    let texty = matches!(
        info.kind,
        FileKind::Text | FileKind::Html | FileKind::Markdown | FileKind::Svg
    );
    if texty && meta.len() <= TEXT_LIMIT_BYTES {
        let mut bytes = Vec::new();
        open_regular(path)?
            .take(TEXT_LIMIT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 <= TEXT_LIMIT_BYTES
            && !bytes.contains(&0)
            && let Ok(text) = String::from_utf8(bytes)
        {
            info.eol = Some(detect_eol(&text));
            info.content = Some(text);
        }
    }
    Ok(info)
}

pub(super) fn not_a_regular_file() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a regular file")
}

/// Opens a regular file for reading. FIFOs, devices and sockets are refused;
/// `O_NONBLOCK` keeps a path swapped for a FIFO from hanging the open.
pub(super) fn open_regular(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(not_a_regular_file());
    }
    Ok(file)
}

/// Changes whenever the file does, so a save can tell if it was edited
/// elsewhere meanwhile.
pub(super) fn version_of(meta: &std::fs::Metadata) -> String {
    let ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    format!("{ns}-{}", meta.len())
}

/// Line endings of `text`, by its first line break, so an edit keeps them.
pub(super) fn detect_eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(i) if text[..i].ends_with('\r') => "crlf",
        _ => "lf",
    }
}

pub(super) fn file_error(e: std::io::Error) -> Response {
    match e.kind() {
        // Directories and FIFOs, devices and sockets where a file is needed.
        std::io::ErrorKind::InvalidInput => StatusCode::BAD_REQUEST.into_response(),
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND.into_response(),
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN.into_response(),
        _ => internal_error(e).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::scratch;
    use std::time::Duration;

    #[test]
    fn version_and_eol() {
        let dir = scratch();
        let f = dir.join("v.txt");
        std::fs::write(&f, "12345").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        let (ns, size) = v.split_once('-').unwrap();
        assert!(ns.parse::<u128>().unwrap() > 0);
        assert_eq!(size, "5");
        assert_eq!(detect_eol("a\r\nb\nc"), "crlf");
        assert_eq!(detect_eol("a\nb\r\n"), "lf");
        assert_eq!(detect_eol("no newline"), "lf");
    }

    #[test]
    fn file_info_returns_text_with_version_and_eol() {
        let dir = scratch();
        let f = dir.join("a.rs");
        std::fs::write(&f, "x\r\ny\r\n").unwrap();
        let info = read_file_info(&f).unwrap();
        assert_eq!(info.kind, FileKind::Text);
        assert_eq!(info.content.as_deref(), Some("x\r\ny\r\n"));
        assert_eq!(info.eol, Some("crlf"));
        assert_eq!(info.size, 6);
        assert_eq!(info.version, version_of(&std::fs::metadata(&f).unwrap()));
    }

    #[test]
    fn file_info_omits_content_for_binary_dirs_and_large_text() {
        let dir = scratch();
        std::fs::write(dir.join("b.bin"), b"a\0b").unwrap();
        assert!(
            read_file_info(&dir.join("b.bin"))
                .unwrap()
                .content
                .is_none()
        );
        let d = read_file_info(&dir).unwrap();
        assert_eq!(d.kind, FileKind::Dir);
        assert!(d.content.is_none());
        let big = dir.join("big.txt");
        std::fs::write(&big, vec![b'a'; TEXT_LIMIT_BYTES as usize + 1]).unwrap();
        let info = read_file_info(&big).unwrap();
        assert_eq!(info.kind, FileKind::Text);
        assert!(info.content.is_none());
    }

    #[test]
    fn file_info_refuses_a_fifo_without_blocking() {
        let dir = scratch();
        let fifo = dir.join("pipe");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());
        let (tx, rx) = std::sync::mpsc::channel();
        let p = fifo.clone();
        std::thread::spawn(move || {
            let _ = tx.send(read_file_info(&p).map(|_| ()));
        });
        let res = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("read_file_info blocked on a FIFO");
        let err = res.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
        assert_eq!(
            file_error(err).status(),
            StatusCode::BAD_REQUEST,
            "a FIFO is a bad request"
        );
        // Wake the reader in case it is stuck in open().
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&fifo);
    }
}
