//! Pages and browser integration for the daemon web interface.

use axum::{
    extract::{ConnectInfo, State},
    http::header,
    response::{IntoResponse, Redirect, Response},
};
use std::net::SocketAddr;

use crate::AppState;

/// The app page, built from web/ (`npm run build` there copies it here). The
/// daemon serves its own copy at /app/ for browsers that won't let the hosted
/// one reach it: WebKit blocks https pages from calling http://127.0.0.1.
const APP_HTML: &str = include_str!("../app.html");
/// The page's daemon address as built for the hosted site, emptied when this
/// daemon serves it so the page talks to its own origin.
const HOSTED_DAEMON_META: &str = r#"<meta name="tabsh-daemon" content="http://127.0.0.1:7681">"#;
static APP_PAGE: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    APP_HTML.replacen(
        HOSTED_DAEMON_META,
        r#"<meta name="tabsh-daemon" content="">"#,
        1,
    )
});
/// The hosted site's policy for /app/ (web/public/_headers), for our copy.
const APP_CSP: &str = "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; \
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; \
img-src data: blob:; frame-src blob:; connect-src 'self' ws://tabsh.localhost:* ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/// Opens the app in the default browser, unless there's no one at this
/// machine's screen to see it (an SSH session, a Linux box without a
/// display) or TABSH_NO_BROWSER is set, e.g. when run as a service. Safari
/// can't use the hosted page, which sends it on to our copy.
pub(crate) fn open_browser(url: &str) {
    let env = |name| std::env::var_os(name).is_some_and(|v| !v.is_empty());
    let headless = if cfg!(target_os = "macos") {
        false
    } else {
        !env("DISPLAY") && !env("WAYLAND_DISPLAY")
    };
    if env("TABSH_NO_BROWSER") || env("SSH_CONNECTION") || headless {
        return;
    }
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut cmd = std::process::Command::new(opener);
    cmd.arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // Reap it in the background; the link above is the fallback if it fails.
    std::thread::spawn(move || {
        if let Err(e) = cmd.status() {
            eprintln!("tabsh: could not open a browser ({opener}): {e}");
        }
    });
}

/// The UI lives on the hosted site, so visiting the daemon sends you there,
/// paired: the token rides in the fragment, which is never sent onward. Only
/// browsers on this machine get it; with HOST set to a LAN address, others
/// land on the pairing screen instead.
pub(crate) async fn open_app(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    let Some(app_url) = &st.app_url else {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    };
    if peer.ip().is_loopback() {
        Redirect::temporary(&format!("{app_url}#token={}", st.token)).into_response()
    } else {
        Redirect::temporary(app_url).into_response()
    }
}

/// Like `open_app`, but to our own copy of the page. The hosted page links
/// here when the browser won't let it reach us.
pub(crate) async fn open_local_app(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Redirect {
    if peer.ip().is_loopback() {
        Redirect::temporary(&format!("/app/#token={}", st.token))
    } else {
        Redirect::temporary("/app/")
    }
}

pub(crate) async fn local_app() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CONTENT_SECURITY_POLICY, APP_CSP),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::CACHE_CONTROL, "no-cache"),
            (
                header::HeaderName::from_static("cross-origin-opener-policy"),
                "same-origin",
            ),
        ],
        APP_PAGE.as_str(),
    )
        .into_response()
}

pub(crate) async fn about(
    State(st): State<AppState>,
) -> Result<axum::Json<serde_json::Value>, axum::http::StatusCode> {
    let (running, total) = crate::sessions::counts(&st).map_err(crate::error::internal_error)?;
    Ok(axum::Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "shell": std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        "state_path": &*st.db_path,
        "uptime_secs": st.started.elapsed().as_secs(),
        "sessions_running": running,
        "sessions_total": total,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The editor (CodeMirror, marked) loads on the first Cmd-click, and the
    /// explorer's tree library when the sidebar first opens, not with the
    /// page: nothing the entry script imports statically may contain them.
    #[test]
    fn entry_script_does_not_bundle_the_editor() {
        let assets = crate::web::assets::app_assets();
        let asset = |name: &str| {
            assets
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned())
                .unwrap_or_else(|| panic!("missing asset {name}"))
        };
        let entry = APP_HTML
            .split(r#"<script type="module" src="/_astro/"#)
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("the page loads one module script");
        let mut seen = vec![entry.to_owned()];
        let mut i = 0;
        while i < seen.len() {
            let js = asset(&seen[i]);
            for marker in ["from\"./", "from \"./", "import\"./", "import \"./"] {
                for rest in js.split(marker).skip(1) {
                    let name = rest.split('"').next().unwrap().to_owned();
                    if !seen.contains(&name) {
                        seen.push(name);
                    }
                }
            }
            i += 1;
        }
        for name in &seen {
            assert!(
                !name.starts_with("marked"),
                "{name} is loaded with the page"
            );
            assert!(
                !asset(name).contains("cm-gutter"),
                "{name} bundles CodeMirror"
            );
            assert!(
                !asset(name).contains("file-tree-container"),
                "{name} bundles the file tree"
            );
        }
        // The marker is real: the editor's own chunks do contain it.
        assert!(
            assets
                .iter()
                .any(|(_, b)| String::from_utf8_lossy(b).contains("cm-gutter"))
        );
        assert!(assets.iter().any(|(n, b)| n.ends_with(".js")
            && String::from_utf8_lossy(b).contains("file-tree-container")));
    }

    /// The CSP allows no inline script, so the page must have none.
    #[test]
    fn app_page_has_no_inline_code() {
        for tag in APP_HTML.split("<script").skip(1) {
            let open = tag.split('>').next().unwrap();
            assert!(open.contains("src="), "inline script: <script{open}>");
        }
        for attr in [
            " onclick=",
            " onload=",
            " onerror=",
            " onsubmit=",
            " oninput=",
            " onkeydown=",
        ] {
            assert!(!APP_HTML.contains(attr), "inline handler {attr}");
        }
    }

    /// Our copy of the page gets the same policy as the hosted one, apart
    /// from where it may connect.
    #[test]
    fn csp_has_no_inline_scripts_and_matches_the_hosted_policy() {
        let hosted = include_str!("../../web/public/_headers");
        let directive = |csp: &str, name: &str| {
            csp.split(';')
                .map(str::trim)
                .find(|d| d.starts_with(name))
                .map(str::to_owned)
        };
        let hosted_csp = hosted
            .lines()
            .find_map(|l| l.trim().strip_prefix("Content-Security-Policy: "))
            .unwrap();
        for name in [
            "script-src",
            "style-src",
            "img-src",
            "frame-src",
            "default-src",
        ] {
            assert_eq!(
                directive(APP_CSP, name),
                directive(hosted_csp, name),
                "{name}"
            );
        }
        assert!(
            !directive(APP_CSP, "script-src")
                .unwrap()
                .contains("'unsafe-inline'")
        );
        assert!(directive(APP_CSP, "style-src").unwrap().contains("'self'"));
    }

    #[test]
    fn local_app_points_at_its_own_origin() {
        assert_eq!(APP_HTML.matches(HOSTED_DAEMON_META).count(), 1);
        assert!(!APP_PAGE.contains(HOSTED_DAEMON_META));
    }

    #[test]
    fn app_page_scripts_are_embedded() {
        use crate::web::assets;
        // Every /_astro/ file the page references must be servable by the daemon.
        for src in APP_HTML.split("/_astro/").skip(1) {
            let name = src.split(['"', '\'', ')']).next().unwrap();
            assert!(assets::has_app_asset(name), "missing {name}");
        }
        assert!(assets::has_js_asset());
    }
}
