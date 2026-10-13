//! Request guard middleware for security and origin validation.

use axum::{
    extract::{ConnectInfo, Request},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;

use crate::AppState;
use crate::auth::{Credential, presented_token};
use crate::remote;

/// Where the UI (web/) is served from. It may drive this daemon once paired
/// with the token. TABSH_ORIGINS (comma-separated) replaces this list, e.g.
/// `http://localhost:4321` to work on the site with `astro dev`.
pub(crate) const HOSTED_ORIGINS: &[&str] = &["https://tabsh.cc"];
/// The name our own copy of the app is opened at, rather than a bare
/// `localhost`.
pub(crate) const LOCAL_NAME: &str = "tabsh.localhost";

/// Browsers let any site send requests to localhost, so every request passes
/// through here:
/// - The Host must be `localhost`, `tabsh.localhost` or an IP address. Any
///   other DNS name means DNS rebinding: a page whose own domain resolves to
///   us, which would otherwise look same-origin. (`.localhost` names never
///   reach public DNS; browsers and the OS resolve them to loopback.)
/// - The peer address must be known. Another machine is let in only while
///   sharing is on, or when `HOST` is fixed, and then only with a token (the
///   main one or a device's), except for the page and its assets (`is_page`).
/// - A device token never reaches `/api/remote*`.
/// - No Origin: not a cross-site browser request (browsers always send it on
///   cross-site writes and WebSockets; see `ws_handler`). The file API still
///   needs a token (`admits_without_origin`).
/// - A hosted UI origin, or our own (the page at /app/): allowed, but only
///   with a token.
/// - Anything else is refused.
///
/// A request let through with a token carries its `Credential` as an
/// extension.
pub(crate) async fn guard(
    axum::extract::State(st): axum::extract::State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    if !host_is_address(req.headers()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(ConnectInfo(peer)) = req.extensions().get::<ConnectInfo<SocketAddr>>().copied() else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let credential = presented_token(&req).and_then(|t| remote::credential(&st, t));
    if let Some(credential) = &credential {
        req.extensions_mut().insert(credential.clone());
    }
    let path = req.uri().path();
    if !remote::is_loopback(peer) {
        if !remote::admits_others(&st) {
            return StatusCode::FORBIDDEN.into_response();
        }
        if is_page(req.method(), path) {
            return next.run(req).await;
        }
        if credential.is_none() {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    if matches!(credential, Some(Credential::Device(_))) && path.starts_with("/api/remote") {
        return StatusCode::FORBIDDEN.into_response();
    }
    // Public build assets; script loads can't carry the token.
    if is_public_asset(req.method(), path) {
        return next.run(req).await;
    }
    let headers = req.headers();
    let Some(origin) = headers.get(header::ORIGIN).cloned() else {
        if !admits_without_origin(path, credential.as_ref()) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        return next.run(req).await;
    };
    // The Host was checked above, so this is a page we served, not a
    // rebound domain or another port on this machine.
    let own = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|host| origin.as_bytes() == format!("http://{host}").as_bytes());
    if !own && !st.origins.iter().any(|o| origin == o.as_str()) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut res = if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        let h = res.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("authorization, content-type"),
        );
        h.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
        // Chrome's Private Network Access preflight for public pages reaching localhost.
        h.insert(
            "access-control-allow-private-network",
            HeaderValue::from_static("true"),
        );
        res
    } else if credential.is_some() {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    };
    let h = res.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    h.insert(header::VARY, HeaderValue::from_static("origin"));
    res
}

/// Whether a request with no Origin may pass. The file API reads and writes
/// any file the user can, so it always needs a token, whoever is asking.
fn admits_without_origin(path: &str, credential: Option<&Credential>) -> bool {
    !path.starts_with("/api/files") || credential.is_some()
}

/// The page and its assets, which another device loads before it has a
/// token: read-only, and `/` and `/open` give the token only to loopback.
fn is_page(method: &Method, path: &str) -> bool {
    (method == Method::GET || method == Method::HEAD)
        && (matches!(path, "/" | "/open" | "/app" | "/app/")
            || path.starts_with("/sounds/")
            || is_public_asset(method, path))
}

/// The page's bundled scripts and styles: read-only, same for everyone.
fn is_public_asset(method: &Method, path: &str) -> bool {
    (method == Method::GET || method == Method::HEAD)
        && path
            .strip_prefix("/_astro/")
            .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
}

fn host_is_address(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let name = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.rsplit_once(':').map_or(host, |(name, _)| name),
    };
    name.eq_ignore_ascii_case("localhost")
        || name.eq_ignore_ascii_case(LOCAL_NAME)
        || name.parse::<std::net::IpAddr>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Credential;
    use crate::remote::{mint, revoke, set_enabled};
    use crate::test_support::{loopback_peer, off_the_worker, test_state};
    use axum::{Extension, Router, body::Body, extract::ConnectInfo, routing::get};
    use std::net::SocketAddr;
    use tower::ServiceExt;

    const REMOTE: Option<[u8; 4]> = Some([100, 64, 0, 1]);
    const LOOPBACK: Option<[u8; 4]> = Some([127, 0, 0, 1]);

    fn request(
        method: Method,
        path: &str,
        peer: Option<[u8; 4]>,
        origin: Option<&str>,
        token: Option<&str>,
    ) -> Request {
        let remote = peer.is_some_and(|ip| ip != [127, 0, 0, 1]);
        let host = if remote {
            "100.64.0.1:7681"
        } else {
            "127.0.0.1:7681"
        };
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, host);
        if let Some(origin) = origin {
            req = req.header(header::ORIGIN, origin);
        }
        if let Some(token) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        match peer {
            Some([127, 0, 0, 1]) => req = req.extension(loopback_peer()),
            Some(ip) => req = req.extension(ConnectInfo(SocketAddr::from((ip, 50000)))),
            None => {}
        }
        req.body(Body::empty()).unwrap()
    }

    async fn respond(
        st: &AppState,
        method: Method,
        path: &str,
        peer: Option<[u8; 4]>,
        origin: Option<&str>,
        token: Option<&str>,
    ) -> Response {
        crate::state::router(st.clone())
            .oneshot(request(method, path, peer, origin, token))
            .await
            .unwrap()
    }

    async fn send(
        st: &AppState,
        method: Method,
        path: &str,
        peer: Option<[u8; 4]>,
        origin: Option<&str>,
        token: Option<&str>,
    ) -> StatusCode {
        respond(st, method, path, peer, origin, token)
            .await
            .status()
    }

    #[tokio::test]
    async fn remote_peers_need_a_token_on_every_route() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        for (m, p) in [
            (Method::POST, "/api/sessions"),
            (Method::PATCH, "/api/sessions/x/status"),
            (Method::GET, "/ws?id=x"),
            (Method::GET, "/api/board/events"),
            (Method::GET, "/api/settings"),
        ] {
            assert_eq!(
                send(&st, m.clone(), p, REMOTE, None, None).await,
                StatusCode::UNAUTHORIZED,
                "{m} {p}"
            );
            assert_eq!(
                send(
                    &st,
                    m.clone(),
                    p,
                    REMOTE,
                    Some("http://100.64.0.1:7681"),
                    None
                )
                .await,
                StatusCode::UNAUTHORIZED,
                "{m} {p} with Origin"
            );
        }
        // Only GET or HEAD of the page is public.
        assert_eq!(
            send(&st, Method::POST, "/app/", REMOTE, None, None).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(&st, Method::GET, "/app/x", REMOTE, None, None).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn remote_peers_get_the_page_without_a_token() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        assert_eq!(
            send(&st, Method::GET, "/app/", REMOTE, None, None).await,
            StatusCode::OK
        );
        assert_eq!(
            send(&st, Method::HEAD, "/app/", REMOTE, None, None).await,
            StatusCode::OK
        );
        let asset = format!(
            "/_astro/{}",
            crate::web::assets::first_asset_name().unwrap()
        );
        assert_eq!(
            send(&st, Method::GET, &asset, REMOTE, None, None).await,
            StatusCode::OK
        );
        let res = respond(&st, Method::GET, "/open", REMOTE, None, None).await;
        assert_eq!(res.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(res.headers()[header::LOCATION], "/app/");
        for path in ["/", "/app", "/sounds/mx-blue/press_key1.mp3"] {
            let status = send(&st, Method::GET, path, REMOTE, None, None).await;
            assert!(
                status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
                "{path}: {status}"
            );
        }
    }

    #[tokio::test]
    async fn sharing_off_refuses_remote_peers() {
        let st = test_state();
        for path in ["/app/", "/api/sessions"] {
            assert_eq!(
                send(&st, Method::GET, path, REMOTE, None, Some("t0k3n")).await,
                StatusCode::FORBIDDEN,
                "{path}"
            );
        }
    }

    // HOST set to a LAN address already listens beyond this machine, and
    // sharing can't be switched there.
    #[tokio::test]
    async fn a_fixed_host_lets_other_machines_in_with_a_token() {
        let mut st = test_state();
        st.host = Some("192.168.1.2".into());
        assert_eq!(
            send(
                &st,
                Method::GET,
                "/api/sessions",
                REMOTE,
                None,
                Some("t0k3n")
            )
            .await,
            StatusCode::OK
        );
        assert_eq!(
            send(&st, Method::GET, "/api/sessions", REMOTE, None, None).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(&st, Method::GET, "/app/", REMOTE, None, None).await,
            StatusCode::OK
        );
    }

    // HOST=:: takes IPv4 connections as IPv4-mapped IPv6 addresses.
    #[tokio::test]
    async fn a_mapped_loopback_peer_is_loopback() {
        let st = test_state();
        let mapped = SocketAddr::from(([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1], 50000));
        let req = Request::builder()
            .uri("/api/sessions")
            .header(header::HOST, "127.0.0.1:7681")
            .extension(ConnectInfo(mapped))
            .body(Body::empty())
            .unwrap();
        let res = crate::state::router(st).oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn missing_peer_is_refused() {
        let st = test_state();
        for path in ["/api/sessions", "/app/"] {
            assert_eq!(
                send(&st, Method::GET, path, None, None, Some("t0k3n")).await,
                StatusCode::FORBIDDEN,
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn a_device_token_works_but_not_on_remote_routes() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (_, token) = mint(&st, "Pixel").unwrap();
        assert_eq!(
            send(
                &st,
                Method::GET,
                "/api/sessions",
                REMOTE,
                None,
                Some(&token)
            )
            .await,
            StatusCode::OK
        );
        for peer in [REMOTE, LOOPBACK] {
            for path in ["/api/remote", "/api/remote/devices"] {
                assert_eq!(
                    send(&st, Method::GET, path, peer, None, Some(&token)).await,
                    StatusCode::FORBIDDEN,
                    "{path} from {peer:?}"
                );
            }
        }
        assert_ne!(
            send(
                &st,
                Method::GET,
                "/api/remote",
                LOOPBACK,
                None,
                Some("t0k3n")
            )
            .await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn a_revoked_token_is_refused() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (id, token) = mint(&st, "Pixel").unwrap();
        assert!(revoke(&st, &id).unwrap());
        assert_eq!(
            send(
                &st,
                Method::GET,
                "/api/sessions",
                REMOTE,
                None,
                Some(&token)
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn a_device_token_waits_off_the_async_workers() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (_, token) = mint(&st, "Pixel").unwrap();
        let app = crate::state::router(st.clone());
        let req = request(Method::GET, "/app/", REMOTE, None, Some(&token));
        let (free, res) = off_the_worker(&st, async move { app.oneshot(req).await.unwrap() });
        assert!(free, "a device's last_seen write held up the async worker");
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn handlers_see_the_credential() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (id, token) = mint(&st, "Pixel").unwrap();
        let app = Router::new()
            .route(
                "/api/who",
                get(|who: Option<Extension<Credential>>| async move {
                    format!("{:?}", who.map(|Extension(c)| c))
                }),
            )
            .layer(axum::middleware::from_fn_with_state(st.clone(), guard))
            .with_state(st);
        let who = |peer, token| {
            let app = app.clone();
            async move {
                let res = app
                    .oneshot(request(Method::GET, "/api/who", peer, None, token))
                    .await
                    .unwrap();
                let body = axum::body::to_bytes(res.into_body(), usize::MAX)
                    .await
                    .unwrap();
                String::from_utf8(body.to_vec()).unwrap()
            }
        };
        assert_eq!(
            who(REMOTE, Some(&token)).await,
            format!("Some(Device({id:?}))")
        );
        assert_eq!(who(LOOPBACK, Some("t0k3n")).await, "Some(Main)");
        assert_eq!(who(LOOPBACK, None).await, "None");
    }

    #[test]
    fn host_must_be_local_or_an_address() {
        let host = |h: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::HOST, HeaderValue::from_str(h).unwrap());
            host_is_address(&headers)
        };
        for ok in [
            "localhost:7681",
            "tabsh.localhost:7681",
            "TABSH.localhost",
            "127.0.0.1:7681",
            "[::1]:7681",
        ] {
            assert!(host(ok), "{ok}");
        }
        for bad in [
            "evil.example:7681",
            "evil.localhost:7681",
            "tabsh.localhost.evil.example",
        ] {
            assert!(!host(bad), "{bad}");
        }
    }

    #[test]
    fn only_astro_assets_skip_the_token() {
        assert!(is_public_asset(&Method::GET, "/_astro/a.js"));
        assert!(is_public_asset(&Method::HEAD, "/_astro/a.js"));
        assert!(!is_public_asset(&Method::POST, "/_astro/a.js"));
        assert!(!is_public_asset(&Method::PUT, "/_astro/a.js"));
        assert!(!is_public_asset(&Method::GET, "/api/sessions"));
        assert!(!is_public_asset(&Method::GET, "/sounds/a.mp3"));
        assert!(!is_public_asset(&Method::GET, "/_astrox/a.js"));
        for path in [
            "/_astro",
            "/_astro/",
            "/_astro/x/y",
            "/_astro/../api/sessions",
        ] {
            assert!(!is_public_asset(&Method::GET, path), "{path}");
        }
    }

    #[test]
    fn file_api_needs_the_token_without_origin() {
        let device = Credential::Device("d1".into());
        for path in ["/api/files", "/api/files/raw"] {
            assert!(!admits_without_origin(path, None), "{path}");
            assert!(
                admits_without_origin(path, Some(&Credential::Main)),
                "{path}"
            );
            assert!(admits_without_origin(path, Some(&device)), "{path}");
        }
        // Everything else is left to its own hardening for now.
        assert!(admits_without_origin("/api/sessions", None));
        assert!(admits_without_origin("/ws", None));
    }

    #[test]
    fn the_page_is_exactly_its_paths_and_assets() {
        for path in [
            "/",
            "/open",
            "/app",
            "/app/",
            "/_astro/a.js",
            "/sounds/a/b.mp3",
        ] {
            assert!(is_page(&Method::GET, path), "{path}");
            assert!(is_page(&Method::HEAD, path), "{path}");
            assert!(!is_page(&Method::POST, path), "{path}");
        }
        for path in [
            "/app/x",
            "/apps",
            "/open/x",
            "/_astro/x/y",
            "/sounds",
            "/ws",
            "/api/about",
        ] {
            assert!(!is_page(&Method::GET, path), "{path}");
        }
    }
}
