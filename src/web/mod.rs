//! Web interface and routes for the daemon.

pub(crate) mod assets;
pub(crate) mod guard;
pub(crate) mod pages;

use axum::{Router, routing::get};

use crate::AppState;
use assets::{app_asset, sound};
use pages::{about, local_app, open_app, open_local_app};

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(open_app))
        .route("/open", get(open_local_app))
        .route(
            "/app",
            get(|| async { axum::response::Redirect::permanent("/app/") }),
        )
        .route("/app/", get(local_app))
        .route("/sounds/{*path}", get(sound))
        .route("/_astro/{name}", get(app_asset))
        .route("/api/about", get(about))
}
