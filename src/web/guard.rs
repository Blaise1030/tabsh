//! Request guard middleware for security and origin validation.

use axum::{
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::AppState;
use crate::auth::{presented_token, token_eq};

pub(crate) const HOSTED_ORIGINS: &[&str] = &["https://tabsh.cc"];
pub(crate) const LOCAL_NAME: &str = "tabsh.localhost";

/// Browsers let any site send requests to localhost, so every request passes
/// through here:
/// - The Host must be `localhost`, `tabsh.localhost` or an IP address. Any
///   other DNS name means DNS rebinding: a page whose own domain resolves to
///   us, which would otherwise look same-origin. (`.localhost` names never
///   reach public DNS; browsers and the OS resolve them to loopback.)
/// - No Origin: not a cross-site browser request (browsers always send it on
///   cross-site writes and WebSockets; see `ws_handler`). The file API still
///   needs the token (`admits_without_origin`).
/// - A hosted UI origin, or our own (the page at /app/): allowed, but only
///   with the token.
/// - Anything else is refused.
pub(crate) async fn guard(
    axum::extract::State(st): axum::extract::State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let headers = req.headers();
    if !host_is_address(headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    // Public build assets; script loads can't carry the token.
    if is_public_asset(req.method(), req.uri().path()) {
        return next.run(req).await;
    }
    let Some(origin) = headers.get(header::ORIGIN).cloned() else {
        if !admits_without_origin(req.uri().path(), presented_token(&req), &st.token) {
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
    } else if presented_token(&req).is_some_and(|t| token_eq(t, &st.token)) {
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
/// any file the user can, so it always needs the token, whoever is asking.
fn admits_without_origin(path: &str, token: Option<&str>, expected: &str) -> bool {
    !path.starts_with("/api/files") || token.is_some_and(|t| token_eq(t, expected))
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
        let token = "s3cret";
        for path in ["/api/files", "/api/files/raw"] {
            assert!(!admits_without_origin(path, None, token), "{path}");
            assert!(
                !admits_without_origin(path, Some("wrong!"), token),
                "{path}"
            );
            assert!(admits_without_origin(path, Some(token), token), "{path}");
        }
        // Everything else is left to its own hardening for now.
        assert!(admits_without_origin("/api/sessions", None, token));
        assert!(admits_without_origin("/ws", None, token));
    }
}
