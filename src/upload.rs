//! Files dropped onto a terminal, saved so their path can be typed at the prompt.

use crate::{AppState, error::internal_error};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::StatusCode,
    routing::post,
};
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/uploads",
        post(upload).layer(DefaultBodyLimit::max(UPLOAD_LIMIT_BYTES)),
    )
}

#[derive(Deserialize)]
struct UploadQuery {
    name: String,
}

/// Largest file accepted from a drag-and-drop into a terminal.
const UPLOAD_LIMIT_BYTES: usize = 100 * 1024 * 1024;

/// Saves a file dropped onto a terminal (browsers never expose the dropped
/// file's own path) next to the database, and returns where it landed so the
/// client can type that path at the prompt.
async fn upload(
    State(st): State<AppState>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let base = std::path::Path::new(&q.name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let safe: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(100)
        .collect();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::path::Path::new(&*st.db_path)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("uploads");
    let path = dir.join(format!(
        "{nanos:x}-{:x}-{safe}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let dest = path.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(&dest, &body)
    })
    .await
    .map_err(internal_error)?
    .map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "path": path.to_string_lossy() })))
}
