//! What kind of file a path is, and the content type its preview is served with.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(super) enum FileKind {
    Dir,
    Text,
    Html,
    Markdown,
    Svg,
    Image,
    Pdf,
    Binary,
}

/// Extensions the pane previews as images (lower case).
pub(super) const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp"];

/// What the file pane should do with a path: by extension where that's
/// decisive, otherwise by sniffing `head` (the start of the file).
pub(super) fn file_kind(path: &std::path::Path, head: &[u8], is_dir: bool) -> FileKind {
    if is_dir {
        return FileKind::Dir;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => FileKind::Html,
        "md" | "markdown" => FileKind::Markdown,
        "svg" => FileKind::Svg,
        e if IMAGE_EXTS.contains(&e) => FileKind::Image,
        "pdf" => FileKind::Pdf,
        _ => {
            // `head` may end inside a multi-byte character; that's still text.
            let utf8 = match std::str::from_utf8(head) {
                Ok(_) => true,
                Err(e) => e.error_len().is_none(),
            };
            if utf8 && !head.contains(&0) {
                FileKind::Text
            } else {
                FileKind::Binary
            }
        }
    }
}

/// The type `file_raw` serves for a lower-case extension.
pub(super) fn raw_content_type(ext: &str) -> &'static str {
    match ext {
        "html" | "htm" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn file_kind_by_extension_then_content() {
        let p = |s: &str| PathBuf::from(s);
        assert_eq!(file_kind(&p("x"), b"", true), FileKind::Dir);
        assert_eq!(file_kind(&p("a.HTML"), b"<p>", false), FileKind::Html);
        assert_eq!(file_kind(&p("a.md"), b"# hi", false), FileKind::Markdown);
        assert_eq!(file_kind(&p("a.svg"), b"<svg", false), FileKind::Svg);
        assert_eq!(file_kind(&p("a.png"), b"\x89PNG", false), FileKind::Image);
        assert_eq!(file_kind(&p("a.pdf"), b"%PDF", false), FileKind::Pdf);
        assert_eq!(
            file_kind(&p("main.rs"), "fn ü() {}".as_bytes(), false),
            FileKind::Text
        );
        assert_eq!(file_kind(&p("Makefile"), b"all:\n", false), FileKind::Text);
        assert_eq!(file_kind(&p("a.bin"), b"ab\0cd", false), FileKind::Binary);
        assert_eq!(file_kind(&p("a.bin"), b"\xff\xfe", false), FileKind::Binary);
        // A multi-byte character cut off at the end of the sniffed head is still text.
        assert_eq!(
            file_kind(&p("a.txt"), &"ü".as_bytes()[..1], false),
            FileKind::Text
        );
    }

    #[test]
    fn previewed_kinds_get_a_safe_content_type() {
        let p = |e: &str| PathBuf::from(format!("a.{e}"));
        let mut checked = 0;
        for ext in IMAGE_EXTS.iter().chain(&["pdf"]) {
            let kind = file_kind(&p(ext), b"", false);
            assert!(matches!(kind, FileKind::Image | FileKind::Pdf), "{ext}");
            let ct = raw_content_type(ext);
            assert!(
                ct.starts_with("image/") || ct == "application/pdf",
                "{ext} served as {ct}"
            );
            checked += 1;
        }
        assert!(checked >= 9);
        // And the upper-case spellings the pane also sees.
        assert_eq!(file_kind(&p("PNG"), b"", false), FileKind::Image);
        assert_eq!(raw_content_type("pdf"), "application/pdf");
        assert_eq!(raw_content_type("exe"), "application/octet-stream");
    }
}
