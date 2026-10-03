//! Web assets including sounds and bundled app files.

use axum::{
    extract::Path,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

// The page's typing sound samples, from web/public/sounds (see build.rs).
include!(concat!(env!("OUT_DIR"), "/sounds.rs"));
// The app page's bundled scripts and styles, from src/app-assets (see build.rs).
include!(concat!(env!("OUT_DIR"), "/app_assets.rs"));

/// Helper to check if an asset with the given name exists.
#[cfg(test)]
pub(crate) fn has_app_asset(name: &str) -> bool {
    APP_ASSETS.iter().any(|(n, _)| *n == name)
}

/// Helper to check if any JS asset exists.
#[cfg(test)]
pub(crate) fn has_js_asset() -> bool {
    APP_ASSETS.iter().any(|(n, _)| n.ends_with(".js"))
}

/// Get the first asset name for testing.
#[cfg(test)]
pub(crate) fn first_asset_name() -> Option<&'static str> {
    APP_ASSETS.first().map(|(name, _)| *name)
}

pub(crate) async fn sound(Path(path): Path<String>) -> Response {
    let Some((_, bytes)) = SOUNDS.iter().find(|(name, _)| *name == path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let kind = if path.ends_with(".mp3") {
        "audio/mpeg"
    } else {
        "text/plain; charset=utf-8"
    };
    (
        [
            (header::CONTENT_TYPE, kind),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "max-age=86400"),
        ],
        *bytes,
    )
        .into_response()
}

pub(crate) async fn app_asset(Path(name): Path<String>) -> Response {
    let Some((_, bytes)) = APP_ASSETS.iter().find(|(n, _)| *n == name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let kind = if name.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if name.ends_with(".css") {
        "text/css; charset=utf-8"
    } else {
        "application/octet-stream"
    };
    (
        [
            (header::CONTENT_TYPE, kind),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            // File names carry a content hash.
            (header::CACHE_CONTROL, "max-age=31536000, immutable"),
        ],
        *bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_sounds_are_embedded() {
        assert!(SOUNDS.iter().any(|(name, _)| name.ends_with(".mp3")));
    }
}
