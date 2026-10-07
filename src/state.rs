//! The daemon's shared state, and the router that puts every route behind the guard.

use crate::{board, files, sessions, settings, upload, web};
use axum::{Router, middleware};
use rusqlite::Connection;
use sessions::Session;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// The database is the source of truth for which sessions exist; `live`
/// holds the ones with a running shell. Lock order: `live` before `db`.
#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: Arc<Mutex<Connection>>,
    pub(crate) live: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    pub(crate) db_path: Arc<str>,
    pub(crate) started: std::time::Instant,
    /// Secret the hosted UI must present.
    pub(crate) token: Arc<str>,
    pub(crate) origins: Arc<[String]>,
    /// The hosted UI, pointed at this daemon, without the token.
    pub(crate) app_url: Option<Arc<str>>,
    /// This daemon's own address, given to shells as `TABSH_URL`.
    pub(crate) self_url: Arc<str>,
    /// Card status changes, for `/api/board/events`.
    pub(crate) events: tokio::sync::broadcast::Sender<crate::board::BoardEvent>,
}

/// Builds the app router with all routes and the guard middleware applied.
pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .merge(web::routes())
        .merge(sessions::routes())
        .merge(board::routes())
        .merge(files::routes())
        .merge(settings::routes())
        .merge(upload::routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            web::guard::guard,
        ))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::http::{Method, StatusCode};

    #[tokio::test]
    async fn every_route_is_guarded() {
        use tower::ServiceExt;

        let state = test_state();

        // The first asset name from APP_ASSETS for the public asset test.
        let first_asset = web::assets::first_asset_name().expect("APP_ASSETS is empty");

        // Routes that require a token: each returns 401 with Origin but no token.
        let guarded_routes: &[(Method, &str)] = &[
            (Method::GET, "/"),
            (Method::GET, "/open"),
            (Method::GET, "/app"),
            (Method::GET, "/app/"),
            (Method::GET, "/sounds/mx-blue/press_key1.mp3"),
            (Method::GET, "/api/sessions"),
            (Method::POST, "/api/sessions"),
            (Method::PUT, "/api/sessions/order"),
            (Method::PATCH, "/api/sessions/x"),
            (Method::DELETE, "/api/sessions/x"),
            (Method::PATCH, "/api/sessions/x/status"),
            (Method::GET, "/api/board/events"),
            (Method::GET, "/api/settings"),
            (Method::PUT, "/api/settings"),
            (Method::GET, "/api/about"),
            (Method::POST, "/api/uploads?name=a"),
            (Method::GET, "/api/files?session=x&path=a"),
            (Method::HEAD, "/api/files?session=x&path=a"),
            (Method::PUT, "/api/files"),
            (Method::GET, "/api/files/folders?path=/a"),
            (Method::GET, "/api/files/raw?path=/a"),
            (Method::GET, "/api/files/root?session=x"),
            (Method::GET, "/api/files/tree?session=x"),
            (Method::GET, "/api/files/watch?session=x"),
            (Method::GET, "/ws?id=x"),
            (Method::GET, "/nope"),
        ];

        // All guarded routes with Origin but no token → 401
        for (method, path) in guarded_routes {
            let req = axum::http::Request::builder()
                .method(method.clone())
                .uri(*path)
                .header("Host", "127.0.0.1:7681")
                .header("Origin", "https://tabsh.cc")
                .body(axum::body::Body::empty())
                .unwrap();
            let app = router(state.clone());
            let res = app.oneshot(req).await.unwrap();
            assert_eq!(
                res.status(),
                StatusCode::UNAUTHORIZED,
                "expected 401 for {} {}",
                method,
                path
            );
        }

        // Public assets pass without a token
        let req = axum::http::Request::builder()
            .method(Method::GET)
            .uri(format!("/_astro/{}", first_asset))
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://tabsh.cc")
            .body(axum::body::Body::empty())
            .unwrap();
        let app = router(state.clone());
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "GET /_astro/{} with Origin should be 200",
            first_asset
        );

        // File API requires token when no Origin header
        for path in &[
            "/api/files?session=x&path=a",
            "/api/files/raw?path=/a",
            "/api/files/tree?session=x",
            "/api/files/watch?session=x",
        ] {
            let req = axum::http::Request::builder()
                .method(Method::GET)
                .uri(*path)
                .header("Host", "127.0.0.1:7681")
                .body(axum::body::Body::empty())
                .unwrap();
            let app = router(state.clone());
            let res = app.oneshot(req).await.unwrap();
            assert_eq!(
                res.status(),
                StatusCode::UNAUTHORIZED,
                "GET {} without Origin should be 401",
                path
            );
        }

        // Foreign origins are rejected
        let req = axum::http::Request::builder()
            .method(Method::GET)
            .uri("/api/sessions")
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://evil.example")
            .body(axum::body::Body::empty())
            .unwrap();
        let app = router(state.clone());
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "GET /api/sessions with foreign Origin should be 403"
        );

        // Non-address hostnames are rejected (DNS rebinding protection)
        let req = axum::http::Request::builder()
            .method(Method::GET)
            .uri("/api/sessions")
            .header("Host", "evil.example")
            .header("Origin", "https://tabsh.cc")
            .body(axum::body::Body::empty())
            .unwrap();
        let app = router(state.clone());
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "GET /api/sessions with non-address Host should be 403"
        );

        // Unrouted paths with valid auth return 404
        let req = axum::http::Request::builder()
            .method(Method::GET)
            .uri("/nope")
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://tabsh.cc")
            .header("Authorization", "Bearer t0k3n")
            .body(axum::body::Body::empty())
            .unwrap();
        let app = router(state);
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "GET /nope with valid auth should be 404"
        );
    }
}
