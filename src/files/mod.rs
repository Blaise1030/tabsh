//! The file pane's API: describing, previewing and saving a path printed in a terminal.

mod kind;
mod read;
mod resolve;
mod save;

use crate::{AppState, error::internal_error};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Query, State},
    handler::Handler,
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use kind::raw_content_type;
use read::{
    RAW_LIMIT_BYTES, TEXT_LIMIT_BYTES, file_error, not_a_regular_file, open_regular, read_file_info,
};
use resolve::{resolve_path, session_base_dir};
use save::{SaveError, save_file};
use serde::Deserialize;
use std::{io::Read, path::PathBuf};

/// The file pane's routes. A save may carry up to four times the text limit
/// (JSON escaping can grow it).
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/files",
            get(file_info).put(save.layer(DefaultBodyLimit::max(4 * TEXT_LIMIT_BYTES as usize))),
        )
        .route("/api/files/raw", get(file_raw))
}

#[derive(Deserialize)]
struct FileQuery {
    session: Option<String>,
    path: String,
}

#[derive(Deserialize)]
struct SaveFile {
    path: String,
    content: String,
    version: String,
}

/// Saves the pane's editor. The page reads the new version from a header.
async fn save(Json(body): Json<SaveFile>) -> Response {
    if !std::path::Path::new(&body.path).is_absolute() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let saved = tokio::task::spawn_blocking(move || {
        save_file(
            std::path::Path::new(&body.path),
            body.content.as_bytes(),
            &body.version,
        )
    })
    .await;
    match saved {
        Ok(Ok(version)) => (
            StatusCode::NO_CONTENT,
            [
                ("x-tabsh-version", version),
                (
                    "access-control-expose-headers",
                    "x-tabsh-version".to_string(),
                ),
            ],
        )
            .into_response(),
        Ok(Err(SaveError::Conflict(version))) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "version": version })),
        )
            .into_response(),
        Ok(Err(SaveError::TooLarge)) => StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Ok(Err(SaveError::Io(e))) => file_error(e),
        Err(e) => internal_error(e).into_response(),
    }
}

/// Describes a path printed in a terminal (`HEAD` only says whether it
/// resolves). Relative paths are taken from the tab's working directory.
async fn file_info(
    State(st): State<AppState>,
    method: Method,
    Query(q): Query<FileQuery>,
) -> Response {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    let base = session_base_dir(&st, q.session.as_deref().unwrap_or(""));
    let Some(path) = resolve_path(&base, &home, &q.path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if method == Method::HEAD {
        return StatusCode::OK.into_response();
    }
    match tokio::task::spawn_blocking(move || read_file_info(&path)).await {
        Ok(Ok(info)) => Json(info).into_response(),
        Ok(Err(e)) => file_error(e),
        Err(e) => internal_error(e).into_response(),
    }
}

/// Serves a file's bytes for the pane's image, PDF and HTML previews. Pages
/// and SVGs that can run script get a sandbox, so they can't reach the token
/// or this daemon's API.
async fn file_raw(Query(q): Query<FileQuery>) -> Response {
    if !std::path::Path::new(&q.path).is_absolute() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let read = tokio::task::spawn_blocking(move || {
        let path = std::fs::canonicalize(&q.path)?;
        if !std::fs::metadata(&path)?.is_file() {
            return Err(not_a_regular_file());
        }
        let file = open_regular(&path)?;
        if file.metadata()?.len() > RAW_LIMIT_BYTES {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        file.take(RAW_LIMIT_BYTES).read_to_end(&mut bytes)?;
        Ok(Some((path, bytes)))
    })
    .await;
    let (path, bytes) = match read {
        Ok(Ok(Some(found))) => found,
        Ok(Ok(None)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Ok(Err(e)) => return file_error(e),
        Err(e) => return internal_error(e).into_response(),
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = raw_content_type(&ext);
    let mut res = (
        [
            (header::CONTENT_TYPE, kind),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response();
    if matches!(ext.as_str(), "html" | "htm" | "svg") {
        res.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                "sandbox allow-scripts allow-popups allow-modals allow-downloads",
            ),
        );
    }
    res
}
