//! The file pane's API: describing, previewing and saving a path printed in a terminal.

mod kind;
mod read;
mod resolve;
mod save;
mod tree;

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
    RAW_LIMIT_BYTES, TEXT_LIMIT_BYTES, file_error, not_a_regular_file, open_regular,
    read_file_info, version_of,
};
use resolve::{resolve_path, session_base_dir};
use save::{SaveError, save_file};
use serde::Deserialize;
use std::{io::Read, path::PathBuf};
use tree::{TREE_LIMIT_PATHS, list_tree, tree_root};

/// The file pane's routes. A save may carry up to four times the text limit
/// (JSON escaping can grow it).
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/files",
            get(file_info).put(save.layer(DefaultBodyLimit::max(4 * TEXT_LIMIT_BYTES as usize))),
        )
        .route("/api/files/raw", get(file_raw))
        .route("/api/files/tree", get(file_tree))
}

#[derive(Deserialize)]
struct FileQuery {
    session: Option<String>,
    path: String,
}

#[derive(Deserialize)]
struct TreeQuery {
    session: Option<String>,
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
/// resolves, and its version). Relative paths are taken from the tab's working directory.
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
        // The open pane polls this to notice the file changing on disk.
        let Ok(meta) = std::fs::metadata(&path) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        return (
            [
                ("x-tabsh-version", version_of(&meta)),
                (
                    "access-control-expose-headers",
                    "x-tabsh-version".to_string(),
                ),
            ],
            StatusCode::OK,
        )
            .into_response();
    }
    match tokio::task::spawn_blocking(move || read_file_info(&path)).await {
        Ok(Ok(info)) => Json(info).into_response(),
        Ok(Err(e)) => file_error(e),
        Err(e) => internal_error(e).into_response(),
    }
}

/// Lists the tab's project for the explorer: everything under the repo root
/// (or the working directory, outside a repo) that git wouldn't ignore.
async fn file_tree(State(st): State<AppState>, Query(q): Query<TreeQuery>) -> Response {
    let cwd = session_base_dir(&st, q.session.as_deref().unwrap_or(""));
    let listed =
        tokio::task::spawn_blocking(move || list_tree(&tree_root(&cwd), TREE_LIMIT_PATHS)).await;
    match listed {
        Ok(tree) => Json(tree).into_response(),
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

#[cfg(test)]
mod tests {
    use crate::{
        state::router,
        test_support::{scratch, test_state},
    };
    use axum::body::to_bytes;
    use axum::http::{Method, Request, StatusCode};
    use tower::ServiceExt;

    fn head(path: &std::path::Path) -> Request<axum::body::Body> {
        Request::builder()
            .method(Method::HEAD)
            .uri(format!("/api/files?session=x&path={}", path.display()))
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://tabsh.cc")
            .header("Authorization", "Bearer t0k3n")
            .body(axum::body::Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn head_reports_the_version_and_its_change() {
        let f = scratch().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let version = |res: &axum::response::Response| {
            res.headers()["x-tabsh-version"]
                .to_str()
                .unwrap()
                .to_string()
        };
        let res = router(test_state()).oneshot(head(&f)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let before = version(&res);
        assert!(
            res.headers()["access-control-expose-headers"]
                .to_str()
                .unwrap()
                .contains("x-tabsh-version")
        );

        std::fs::write(&f, "three").unwrap();
        let res = router(test_state()).oneshot(head(&f)).await.unwrap();
        assert_ne!(version(&res), before);

        std::fs::remove_file(&f).unwrap();
        let res = router(test_state()).oneshot(head(&f)).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    fn tree_request(session: &str, auth: &[(&str, &str)]) -> Request<axum::body::Body> {
        let mut req = Request::builder()
            .uri(format!("/api/files/tree?session={session}"))
            .header("Host", "127.0.0.1:7681");
        for (name, value) in auth {
            req = req.header(*name, *value);
        }
        req.body(axum::body::Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn tree_lists_the_repo_root_of_a_known_session() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/main.rs"), "").unwrap();
        let st = test_state();
        st.db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO sessions (id, name, position, cwd) VALUES ('s1', 'T', 1, ?1)",
                [dir.join("src").to_str().unwrap()],
            )
            .unwrap();
        let auth = [
            ("Origin", "https://tabsh.cc"),
            ("Authorization", "Bearer t0k3n"),
        ];
        let res = router(st).oneshot(tree_request("s1", &auth)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["root"], dir.to_str().unwrap());
        assert_eq!(json["truncated"], false);
        let mut paths: Vec<&str> = json["paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        paths.sort_unstable();
        assert_eq!(paths, ["src/", "src/main.rs"]);
    }

    #[tokio::test]
    async fn tree_of_an_unknown_session_falls_back_to_home() {
        let auth = [
            ("Origin", "https://tabsh.cc"),
            ("Authorization", "Bearer t0k3n"),
        ];
        let res = router(test_state())
            .oneshot(tree_request("nope", &auth))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["root"].is_string());
    }

    #[tokio::test]
    async fn tree_needs_the_token_and_a_known_origin() {
        // No Origin and no token.
        let res = router(test_state())
            .oneshot(tree_request("x", &[]))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        // A foreign Origin, even with the token.
        let res = router(test_state())
            .oneshot(tree_request(
                "x",
                &[
                    ("Origin", "https://evil.example"),
                    ("Authorization", "Bearer t0k3n"),
                ],
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }
}
