use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        ConnectInfo, DefaultBodyLimit, Path, Query, Request, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    handler::Handler,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, patch, post},
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    net::SocketAddr,
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::broadcast;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// Output kept per session so a reconnecting client can redraw its screen.
const SCROLLBACK_BYTES: usize = 512 * 1024;
/// How often changed scrollback and cwd are written to the database.
const FLUSH_INTERVAL: Duration = Duration::from_secs(2);
/// Shown between saved output and the fresh shell after a daemon restart. It
/// first undoes modes a dead program may have left on (alt screen, mouse
/// reporting, bracketed paste, hidden cursor, colors).
const RESTORE_MARKER: &[u8] =
    b"\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m\
\r\n\x1b[2m--- restored: tabsh restarted ---\x1b[0m\r\n";

/// DEC private modes worth restoring on replay: cursor keys, autowrap,
/// cursor visibility, alt screen, mouse reporting, focus events, bracketed
/// paste. A full-screen program usually turns these on once at startup, so
/// after enough redraws the bytes that did it fall out of the scrollback.
const TRACKED_MODES: &[u16] = &[
    1, 7, 25, 47, 1047, 1049, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004,
];

/// Follows `ESC [ ? Pm h` / `ESC [ ? Pm l` through a byte stream, which may
/// split sequences anywhere, and remembers the last setting of each mode.
#[derive(Default)]
struct ModeTracker {
    modes: std::collections::BTreeMap<u16, bool>,
    state: ScanState,
    params: Vec<u8>,
}

#[derive(Default, PartialEq)]
enum ScanState {
    #[default]
    Ground,
    Esc,
    Csi,
    Private,
}

impl ModeTracker {
    fn feed(&mut self, bytes: impl IntoIterator<Item = u8>) {
        for b in bytes {
            self.state = match (&self.state, b) {
                (_, 0x1b) => ScanState::Esc,
                (ScanState::Esc, b'[') => ScanState::Csi,
                (ScanState::Csi, b'?') => {
                    self.params.clear();
                    ScanState::Private
                }
                (ScanState::Private, b'0'..=b'9' | b';') if self.params.len() < 64 => {
                    self.params.push(b);
                    ScanState::Private
                }
                (ScanState::Private, b'h' | b'l') => {
                    for p in self.params.split(|&c| c == b';') {
                        let mode = std::str::from_utf8(p).ok().and_then(|p| p.parse().ok());
                        if let Some(mode) = mode.filter(|m| TRACKED_MODES.contains(m)) {
                            self.modes.insert(mode, b == b'h');
                        }
                    }
                    ScanState::Ground
                }
                _ => ScanState::Ground,
            };
        }
    }

    /// Escape sequences that put a fresh terminal into the tracked state.
    fn replay_prefix(&self) -> Vec<u8> {
        self.modes
            .iter()
            .flat_map(|(mode, on)| {
                format!("\x1b[?{mode}{}", if *on { 'h' } else { 'l' }).into_bytes()
            })
            .collect()
    }
}

/// Set once the daemon is exiting: shells dying because of that must not
/// count as the user closing them, so their rows are kept for next start.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
enum Event {
    Output(Bytes),
    Exit,
}

/// A shell running in a PTY. It outlives any single WebSocket so a browser
/// reload can reattach; it ends when the shell exits or a client kills it.
struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: std::sync::mpsc::Sender<Bytes>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    // Scrollback and broadcast are updated under one lock so a new subscriber
    // sees every byte exactly once: replayed history, then live output.
    output: Mutex<Output>,
}

struct Output {
    scrollback: VecDeque<u8>,
    /// Terminal modes in effect where the scrollback starts, i.e. set by
    /// output that has since been trimmed off the front.
    trimmed_modes: ModeTracker,
    tx: broadcast::Sender<Event>,
    exited: bool,
    /// Scrollback changed since the last flush to the database.
    dirty: bool,
}

/// The database is the source of truth for which sessions exist; `live`
/// holds the ones with a running shell. Lock order: `live` before `db`.
#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    live: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    db_path: Arc<str>,
    started: std::time::Instant,
    /// Secret the hosted UI must present.
    token: Arc<str>,
    origins: Arc<[String]>,
    /// The hosted UI, pointed at this daemon, without the token.
    app_url: Option<Arc<str>>,
}

#[derive(Serialize)]
struct SessionInfo {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct Rename {
    name: String,
}

#[derive(Deserialize)]
struct UploadQuery {
    name: String,
}

/// Where the UI (web/) is served from. It may drive this daemon once paired
/// with the token. TABSH_ORIGINS (comma-separated) replaces this list, e.g.
/// `http://localhost:4321` to work on the site with `astro dev`.
const HOSTED_ORIGINS: &[&str] = &["https://tabsh.cc"];

/// The app page, built from web/ (`npm run build` there copies it here). The
/// daemon serves its own copy at /app/ for browsers that won't let the hosted
/// one reach it: WebKit blocks https pages from calling http://127.0.0.1.
const APP_HTML: &str = include_str!("app.html");
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
const APP_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; \
style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; \
img-src data:; connect-src 'self' ws://tabsh.localhost:* ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/// The name our own copy of the app is opened at, rather than a bare
/// `localhost`.
const LOCAL_NAME: &str = "tabsh.localhost";

// The page's typing sound samples, from web/public/sounds (see build.rs).
include!(concat!(env!("OUT_DIR"), "/sounds.rs"));

/// Largest file accepted from a drag-and-drop into a terminal.
const UPLOAD_LIMIT_BYTES: usize = 100 * 1024 * 1024;
/// Largest text file whose content the file pane receives (and can edit).
const TEXT_LIMIT_BYTES: u64 = 2 * 1024 * 1024;
/// Largest file served raw, for previews of images, PDFs and pages.
const RAW_LIMIT_BYTES: u64 = 50 * 1024 * 1024;
#[tokio::main]
async fn main() {
    let port = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("PORT").ok())
        .unwrap_or_else(|| "7681".into());
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let addr = format!("{host}:{port}");

    let db_path = std::env::var("TABSH_DB").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        // The project was called webterm; carry its state (sessions, token,
        // uploads) over so existing tabs and paired browsers keep working.
        let (old, new) = (format!("{home}/.webterm"), format!("{home}/.tabsh"));
        if !std::path::Path::new(&new).exists() && std::path::Path::new(&old).is_dir() {
            match std::fs::rename(&old, &new) {
                Ok(()) => println!("tabsh: moved {old} to {new}"),
                Err(e) => eprintln!("tabsh: could not move {old} to {new}: {e}"),
            }
        }
        format!("{new}/state.db")
    });
    let db = open_db(&db_path).unwrap_or_else(|e| panic!("failed to open {db_path}: {e}"));
    let token_path = std::path::Path::new(&db_path).with_file_name("token");
    let token = load_or_create_token(&token_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", token_path.display()));
    let origins: Vec<String> = match std::env::var("TABSH_ORIGINS") {
        Ok(list) => list
            .split(',')
            .map(|o| o.trim().trim_end_matches('/').to_owned())
            .filter(|o| !o.is_empty())
            .collect(),
        Err(_) => HOSTED_ORIGINS.iter().map(|o| o.to_string()).collect(),
    };
    let app_url = origins.first().map(|origin| {
        let daemon = if host == "127.0.0.1" && port == "7681" {
            String::new()
        } else {
            format!("?daemon=http://{addr}")
        };
        format!("{origin}/app/{daemon}").into()
    });
    let state = AppState {
        db: Arc::new(Mutex::new(db)),
        live: Default::default(),
        db_path: db_path.as_str().into(),
        started: std::time::Instant::now(),
        token: token.into(),
        origins: origins.into(),
        app_url,
    };

    let flusher = state.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(FLUSH_INTERVAL);
            flush(&flusher);
        }
    });

    let app = Router::new()
        .route("/", get(open_app))
        .route("/open", get(open_local_app))
        .route("/app", get(|| async { Redirect::permanent("/app/") }))
        .route("/app/", get(local_app))
        .route("/sounds/{*path}", get(sound))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route(
            "/api/sessions/{id}",
            patch(rename_session).delete(delete_session),
        )
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/about", get(about))
        .route(
            "/api/uploads",
            post(upload).layer(DefaultBodyLimit::max(UPLOAD_LIMIT_BYTES)),
        )
        .route(
            "/api/files",
            get(file_info).put(save.layer(DefaultBodyLimit::max(4 * TEXT_LIMIT_BYTES as usize))),
        )
        .route("/api/files/raw", get(file_raw))
        .route("/ws", get(ws_handler))
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    println!("tabsh listening on http://{addr} (state: {db_path})");
    let local_host = match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() || ip.is_unspecified() => LOCAL_NAME.into(),
        _ => host.clone(),
    };
    let local_url = format!("http://{local_host}:{port}/app/#token={}", state.token);
    let open_url = match &state.app_url {
        Some(app_url) => {
            let url = format!("{app_url}#token={}", state.token);
            println!("open the app: {url}");
            println!("  or, in Safari: {local_url}");
            url
        }
        None => {
            println!("open the app: {local_url}");
            local_url
        }
    };
    open_browser(&open_url);

    tokio::select! {
        res = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()) => res.unwrap(),
        _ = shutdown_signal() => {
            SHUTTING_DOWN.store(true, Ordering::SeqCst);
            flush(&state);
            println!("tabsh: state saved, exiting");
            std::process::exit(0);
        }
    }
}

/// Opens the app in the default browser, unless there's no one at this
/// machine's screen to see it (an SSH session, a Linux box without a
/// display) or TABSH_NO_BROWSER is set, e.g. when run as a service. Safari
/// can't use the hosted page, which sends it on to our copy.
fn open_browser(url: &str) {
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

async fn shutdown_signal() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

fn open_db(path: &str) -> Result<Connection, BoxError> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS sessions (
             id         TEXT PRIMARY KEY,
             name       TEXT NOT NULL,
             position   INTEGER NOT NULL,
             cwd        TEXT,
             scrollback BLOB NOT NULL DEFAULT x'',
             updated_at INTEGER NOT NULL DEFAULT (unixepoch())
         );
         -- UI preferences (theme, font, ...) as one JSON object; the page owns its shape.
         CREATE TABLE IF NOT EXISTS settings (
             id    INTEGER PRIMARY KEY CHECK (id = 1),
             value TEXT NOT NULL
         );",
    )?;
    Ok(conn)
}

/// Write scrollback and cwd of every session whose output changed.
fn flush(state: &AppState) {
    let live: Vec<(String, Arc<Session>)> = state
        .live
        .lock()
        .unwrap()
        .iter()
        .map(|(id, s)| (id.clone(), s.clone()))
        .collect();
    let db = state.db.lock().unwrap();
    for (id, session) in live {
        let scrollback: Vec<u8> = {
            let mut out = session.output.lock().unwrap();
            if !out.dirty {
                continue;
            }
            out.dirty = false;
            out.scrollback.iter().copied().collect()
        };
        let cwd = session.pid.and_then(process_cwd);
        if let Err(e) = db.execute(
            "UPDATE sessions SET scrollback = ?1, cwd = COALESCE(?2, cwd), updated_at = unixepoch()
             WHERE id = ?3",
            params![scrollback, cwd, id],
        ) {
            eprintln!("failed to save session {id}: {e}");
        }
    }
}

#[cfg(target_os = "linux")]
fn process_cwd(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()?
        .into_os_string()
        .into_string()
        .ok()
}

#[cfg(target_os = "macos")]
fn process_cwd(pid: u32) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let n = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if n != size {
        return None;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr().cast()) };
    path.to_str().ok().map(String::from)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn process_cwd(_pid: u32) -> Option<String> {
    None
}

fn internal_error(e: impl std::fmt::Display) -> StatusCode {
    eprintln!("internal error: {e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

/// Reads the pairing token from `path`, creating it on first run. It is kept
/// across restarts so a paired browser stays paired.
fn load_or_create_token(path: &std::path::Path) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().len() >= 32 => return Ok(t.trim().to_owned()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let token = random_hex(32)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?
        .write_all(token.as_bytes())?;
    Ok(token)
}

fn random_hex(len: usize) -> std::io::Result<String> {
    let mut bytes = vec![0u8; len];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Browsers let any site send requests to localhost, so every request passes
/// through here:
/// - The Host must be `localhost`, `tabsh.localhost` or an IP address. Any
///   other DNS name means DNS rebinding: a page whose own domain resolves to
///   us, which would otherwise look same-origin. (`.localhost` names never
///   reach public DNS; browsers and the OS resolve them to loopback.)
/// - No Origin: not a cross-site browser request (browsers always send it on
///   cross-site writes and WebSockets; see `ws_handler`).
/// - A hosted UI origin, or our own (the page at /app/): allowed, but only
///   with the token.
/// - Anything else is refused.
async fn guard(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    if !host_is_address(headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(origin) = headers.get(header::ORIGIN).cloned() else {
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

/// The UI lives on the hosted site, so visiting the daemon sends you there,
/// paired: the token rides in the fragment, which is never sent onward. Only
/// browsers on this machine get it; with HOST set to a LAN address, others
/// land on the pairing screen instead.
async fn open_app(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    let Some(app_url) = &st.app_url else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if peer.ip().is_loopback() {
        Redirect::temporary(&format!("{app_url}#token={}", st.token)).into_response()
    } else {
        Redirect::temporary(app_url).into_response()
    }
}

/// Like `open_app`, but to our own copy of the page. The hosted page links
/// here when the browser won't let it reach us.
async fn open_local_app(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Redirect {
    if peer.ip().is_loopback() {
        Redirect::temporary(&format!("/app/#token={}", st.token))
    } else {
        Redirect::temporary("/app/")
    }
}

async fn local_app() -> Response {
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

async fn sound(Path(path): Path<String>) -> Response {
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

/// `Authorization: Bearer <token>`, or `?token=` for WebSockets, which can't
/// set headers from a browser.
fn presented_token(req: &Request) -> Option<&str> {
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    bearer.or_else(|| {
        req.uri()
            .query()?
            .split('&')
            .find_map(|kv| kv.strip_prefix("token="))
    })
}

/// Compares in constant time so response timing doesn't leak the token.
fn token_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |acc, (x, y)| acc | (x ^ y))
            == 0
}

async fn list_sessions(State(st): State<AppState>) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let db = st.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, name FROM sessions ORDER BY position")
        .map_err(internal_error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionInfo {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(internal_error)?;
    Ok(Json(rows))
}

async fn create_session(State(st): State<AppState>) -> Result<Json<SessionInfo>, StatusCode> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = format!("{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed));

    let db = st.db.lock().unwrap();
    let names: Vec<String> = db
        .prepare("SELECT name FROM sessions")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .map_err(internal_error)?;
    let n = names
        .iter()
        .filter_map(|n| n.strip_prefix("Terminal ")?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    let name = format!("Terminal {n}");
    db.execute(
        "INSERT INTO sessions (id, name, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sessions))",
        params![id, name],
    )
    .map_err(internal_error)?;
    Ok(Json(SessionInfo { id, name }))
}

async fn rename_session(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Rename>,
) -> StatusCode {
    let name: String = body.name.trim().chars().take(100).collect();
    if name.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    match st.db.lock().unwrap().execute(
        "UPDATE sessions SET name = ?1 WHERE id = ?2",
        params![name, id],
    ) {
        Ok(0) => StatusCode::NOT_FOUND,
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) => internal_error(e),
    }
}

async fn get_settings(State(st): State<AppState>) -> Result<Json<serde_json::Value>, StatusCode> {
    let value: Option<String> = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT value FROM settings WHERE id = 1", [], |r| r.get(0))
        .optional()
        .map_err(internal_error)?;
    let settings = value
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(Json(settings))
}

async fn put_settings(
    State(st): State<AppState>,
    Json(settings): Json<serde_json::Value>,
) -> StatusCode {
    if !settings.is_object() {
        return StatusCode::BAD_REQUEST;
    }
    match st.db.lock().unwrap().execute(
        "INSERT INTO settings (id, value) VALUES (1, ?1)
         ON CONFLICT (id) DO UPDATE SET value = excluded.value",
        params![settings.to_string()],
    ) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) => internal_error(e),
    }
}

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

#[derive(Deserialize)]
struct FileQuery {
    session: Option<String>,
    path: String,
}

#[derive(Serialize)]
struct FileInfo {
    path: String,
    kind: FileKind,
    size: u64,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    eol: Option<&'static str>,
}

/// Describes `path`, with its text when it is small enough to edit in the
/// pane. Files that aren't wholly valid text get no `content`.
fn read_file_info(path: &std::path::Path) -> std::io::Result<FileInfo> {
    let meta = std::fs::metadata(path)?;
    let mut info = FileInfo {
        path: path.to_string_lossy().into_owned(),
        kind: FileKind::Dir,
        size: meta.len(),
        version: version_of(&meta),
        content: None,
        eol: None,
    };
    if meta.is_dir() {
        return Ok(info);
    }
    let mut head = Vec::new();
    std::fs::File::open(path)?
        .take(8192)
        .read_to_end(&mut head)?;
    info.kind = file_kind(path, &head, false);
    let texty = matches!(
        info.kind,
        FileKind::Text | FileKind::Html | FileKind::Markdown | FileKind::Svg
    );
    if texty && meta.len() <= TEXT_LIMIT_BYTES {
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(TEXT_LIMIT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 <= TEXT_LIMIT_BYTES
            && !bytes.contains(&0)
            && let Ok(text) = String::from_utf8(bytes)
        {
            info.eol = Some(detect_eol(&text));
            info.content = Some(text);
        }
    }
    Ok(info)
}

fn file_error(e: std::io::Error) -> Response {
    match e.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND.into_response(),
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN.into_response(),
        _ => internal_error(e).into_response(),
    }
}

#[derive(Deserialize)]
struct SaveFile {
    path: String,
    content: String,
    version: String,
}

enum SaveError {
    /// The file changed since it was read; carries its current version.
    Conflict(String),
    TooLarge,
    Io(std::io::Error),
}

impl From<std::io::Error> for SaveError {
    fn from(e: std::io::Error) -> Self {
        SaveError::Io(e)
    }
}

/// Replaces the file with `content` unless it changed since `expected` was
/// read. Writes a temp file beside it and renames over it, so a crash never
/// leaves a half-written file; a symlink's target is saved, not the link.
fn save_file(path: &std::path::Path, content: &[u8], expected: &str) -> Result<String, SaveError> {
    if content.len() as u64 > TEXT_LIMIT_BYTES {
        return Err(SaveError::TooLarge);
    }
    let path = std::fs::canonicalize(path)?;
    let meta = std::fs::metadata(&path)?;
    let current = version_of(&meta);
    if current != expected {
        return Err(SaveError::Conflict(current));
    }
    let name = path
        .file_name()
        .map_or_else(|| "file".to_string(), |n| n.to_string_lossy().into_owned());
    let tmp = path.with_file_name(format!(".{name}.tabsh-{}", random_hex(6)?));
    let write = || -> std::io::Result<String> {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(content)?;
        f.sync_all()?;
        std::fs::set_permissions(&tmp, meta.permissions())?;
        std::fs::rename(&tmp, &path)?;
        Ok(version_of(&std::fs::metadata(&path)?))
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        SaveError::Io(e)
    })
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
        let file = std::fs::File::open(&path)?;
        let meta = file.metadata()?;
        if meta.is_dir() {
            return Err(std::io::Error::other("is a directory"));
        }
        if meta.len() > RAW_LIMIT_BYTES {
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
        Ok(Err(e)) if e.to_string() == "is a directory" => {
            return StatusCode::BAD_REQUEST.into_response();
        }
        Ok(Err(e)) => return file_error(e),
        Err(e) => return internal_error(e).into_response(),
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match ext.as_str() {
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
    };
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

/// Resolves a path printed in a terminal: `~` is `home`, a relative path is
/// taken from `base`. Symlinks and `..` are resolved. `git diff` prints
/// `a/…` and `b/…` for files that don't have those prefixes, so those are
/// tried without the prefix when the literal path doesn't exist.
fn resolve_path(base: &std::path::Path, home: &std::path::Path, input: &str) -> Option<PathBuf> {
    let resolve = |s: &str| {
        let path = match s.strip_prefix('~') {
            Some("") => home.to_path_buf(),
            Some(rest) if rest.starts_with('/') => home.join(rest.trim_start_matches('/')),
            _ => base.join(s),
        };
        std::fs::canonicalize(path).ok()
    };
    resolve(input).or_else(|| {
        input
            .strip_prefix("a/")
            .or_else(|| input.strip_prefix("b/"))
            .and_then(resolve)
    })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum FileKind {
    Dir,
    Text,
    Html,
    Markdown,
    Svg,
    Image,
    Pdf,
    Binary,
}

/// What the file pane should do with a path: by extension where that's
/// decisive, otherwise by sniffing `head` (the start of the file).
fn file_kind(path: &std::path::Path, head: &[u8], is_dir: bool) -> FileKind {
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
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "ico" | "bmp" => FileKind::Image,
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

/// Changes whenever the file does, so a save can tell if it was edited
/// elsewhere meanwhile.
fn version_of(meta: &std::fs::Metadata) -> String {
    let ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    format!("{ns}-{}", meta.len())
}

/// Line endings of `text`, by its first line break, so an edit keeps them.
fn detect_eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(i) if text[..i].ends_with('\r') => "crlf",
        _ => "lf",
    }
}

/// Where a relative path from this tab is resolved: its shell's live working
/// directory, else the last one saved, else home.
fn session_base_dir(st: &AppState, session: &str) -> PathBuf {
    let pid = st.live.lock().unwrap().get(session).and_then(|s| s.pid);
    let cwd = pid.and_then(process_cwd).or_else(|| {
        st.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT cwd FROM sessions WHERE id = ?1",
                params![session],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten()
    });
    cwd.map(PathBuf::from)
        .unwrap_or_else(|| std::env::var_os("HOME").map_or_else(|| "/".into(), PathBuf::from))
}

async fn about(State(st): State<AppState>) -> Result<Json<serde_json::Value>, StatusCode> {
    let running = st.live.lock().unwrap().len();
    let total: i64 = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .map_err(internal_error)?;
    Ok(Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "shell": std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        "state_path": &*st.db_path,
        "uptime_secs": st.started.elapsed().as_secs(),
        "sessions_running": running,
        "sessions_total": total,
    })))
}

/// Close a tab. A running shell is killed and its reader thread removes the
/// row (and tells attached clients); a not-yet-restored one is just deleted.
async fn delete_session(State(st): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let live = st.live.lock().unwrap();
    if let Some(session) = live.get(&id) {
        let _ = session.killer.lock().unwrap().kill();
        return StatusCode::NO_CONTENT;
    }
    match st
        .db
        .lock()
        .unwrap()
        .execute("DELETE FROM sessions WHERE id = ?1", params![id])
    {
        Ok(0) => StatusCode::NOT_FOUND,
        Ok(_) => StatusCode::NO_CONTENT,
        Err(e) => internal_error(e),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    State(st): State<AppState>,
) -> Response {
    // Browsers let any site open a WebSocket to localhost and always send
    // Origin when they do; `guard` has checked it is a hosted UI with the
    // token. Without one this isn't a browser we can vouch for.
    if !headers.contains_key(header::ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let id = params.get("id").cloned().unwrap_or_default();
    let session = match get_or_spawn(&st, &id) {
        Ok(Some(s)) => s,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            eprintln!("failed to start session {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = attach(socket, &session).await {
            eprintln!("session {id} error: {e}");
        }
    })
}

/// Return the running shell for `id`, starting it (in its saved cwd, with its
/// saved scrollback) if the session exists but isn't running yet.
fn get_or_spawn(st: &AppState, id: &str) -> Result<Option<Arc<Session>>, BoxError> {
    let mut live = st.live.lock().unwrap();
    if let Some(s) = live.get(id) {
        return Ok(Some(s.clone()));
    }
    let row = st
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT cwd, scrollback FROM sessions WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Vec<u8>>(1)?)),
        )
        .optional()?;
    let Some((cwd, scrollback)) = row else {
        return Ok(None);
    };
    let session = spawn_session(st.clone(), id.to_owned(), cwd, scrollback)?;
    live.insert(id.to_owned(), session.clone());
    Ok(Some(session))
}

fn spawn_session(
    st: AppState,
    id: String,
    cwd: Option<String>,
    saved: Vec<u8>,
) -> Result<Arc<Session>, BoxError> {
    let pair = native_pty_system().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    let dir = cwd
        .filter(|d| std::path::Path::new(d).is_dir())
        .map(Into::into)
        .or_else(|| std::env::var_os("HOME"));
    if let Some(dir) = dir {
        cmd.cwd(dir);
    }
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;

    // PTY I/O is blocking, so it lives on dedicated threads.
    let (input, in_rx) = std::sync::mpsc::channel::<Bytes>();
    std::thread::spawn(move || {
        while let Ok(data) = in_rx.recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
        }
    });

    let mut scrollback = VecDeque::from(saved);
    if !scrollback.is_empty() {
        scrollback.extend(RESTORE_MARKER);
    }
    let (tx, _) = broadcast::channel(1024);
    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        input,
        killer: Mutex::new(child.clone_killer()),
        pid: child.process_id(),
        output: Mutex::new(Output {
            scrollback,
            trimmed_modes: ModeTracker::default(),
            tx,
            exited: false,
            dirty: false,
        }),
    });

    let s = session.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            let mut out = s.output.lock().unwrap();
            let out = &mut *out;
            out.scrollback.extend(&buf[..n]);
            let excess = out.scrollback.len().saturating_sub(SCROLLBACK_BYTES);
            out.trimmed_modes.feed(out.scrollback.drain(..excess));
            out.dirty = true;
            let _ = out
                .tx
                .send(Event::Output(Bytes::copy_from_slice(&buf[..n])));
        }
        // Shell exited (or was killed): reap it, tell clients, forget the session.
        let _ = child.wait();
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return;
        }
        let mut out = s.output.lock().unwrap();
        out.exited = true;
        let _ = out.tx.send(Event::Exit);
        drop(out);
        st.live.lock().unwrap().remove(&id);
        if let Err(e) = st
            .db
            .lock()
            .unwrap()
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])
        {
            eprintln!("failed to delete session {id}: {e}");
        }
    });

    Ok(session)
}

async fn attach(socket: WebSocket, session: &Session) -> Result<(), BoxError> {
    let (mut sink, mut stream) = socket.split();

    let (history, exited, mut rx) = {
        let out = session.output.lock().unwrap();
        let mut history = out.trimmed_modes.replay_prefix();
        history.extend(out.scrollback.iter());
        (history, out.exited, out.tx.subscribe())
    };
    // Always sent, even empty: the page treats the first binary message as
    // replayed history (e.g. to skip old bells in it).
    sink.send(Message::Binary(history.into())).await?;
    if exited {
        sink.send(Message::Text(r#"{"exit":true}"#.into())).await?;
        return Ok(());
    }

    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(Event::Output(data)) => sink.send(Message::Binary(data)).await?,
                Ok(Event::Exit) | Err(broadcast::error::RecvError::Closed) => {
                    sink.send(Message::Text(r#"{"exit":true}"#.into())).await?;
                    break;
                }
                // This client fell too far behind to stay consistent; drop it
                // and let it reconnect, which replays the scrollback cleanly.
                Err(broadcast::error::RecvError::Lagged(_)) => break,
            },
            msg = stream.next() => match msg {
                Some(Ok(Message::Binary(data))) => session.input.send(data)?,
                // Text frames carry control messages: {"cols": N, "rows": N} resizes.
                Some(Ok(Message::Text(text))) => {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                        continue;
                    };
                    if let (Some(cols), Some(rows)) = (v["cols"].as_u64(), v["rows"].as_u64()) {
                        let _ = session.master.lock().unwrap().resize(PtySize {
                            rows: rows as u16,
                            cols: cols as u16,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                }
                // The browser went away; the shell keeps running for a reattach.
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }

    let _ = sink.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_tracker_follows_split_sequences() {
        let mut t = ModeTracker::default();
        t.feed(*b"\x1b[?1049h\x1b[?1000;10");
        t.feed(*b"06h hello \x1b[?25l\x1b[?1000l\x1b[?9h");
        assert_eq!(
            t.replay_prefix(),
            b"\x1b[?25l\x1b[?1000l\x1b[?1006h\x1b[?1049h"
        );
    }

    /// Our copy of the page must talk to us, not to the default address.
    #[test]
    fn local_app_points_at_its_own_origin() {
        assert_eq!(APP_HTML.matches(HOSTED_DAEMON_META).count(), 1);
        assert!(!APP_PAGE.contains(HOSTED_DAEMON_META));
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
    fn typing_sounds_are_embedded() {
        assert!(SOUNDS.iter().any(|(name, _)| name.ends_with(".mp3")));
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tabsh-test-{}", random_hex(8).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_path_handles_relative_home_symlinks_and_git_prefixes() {
        let dir = scratch();
        let base = dir.join("proj");
        std::fs::create_dir_all(base.join("src")).unwrap();
        std::fs::write(base.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(base.join("ü notes.md"), "hi").unwrap();
        std::os::unix::fs::symlink(base.join("src/main.rs"), base.join("link.rs")).unwrap();
        let real = std::fs::canonicalize(base.join("src/main.rs")).unwrap();

        assert_eq!(resolve_path(&base, &dir, "src/main.rs"), Some(real.clone()));
        assert_eq!(
            resolve_path(&base, &dir, "./src/../src/main.rs"),
            Some(real.clone())
        );
        assert_eq!(
            resolve_path(&base, &dir, "~/proj/src/main.rs"),
            Some(real.clone())
        );
        assert_eq!(resolve_path(&base, &dir, "link.rs"), Some(real.clone()));
        assert_eq!(
            resolve_path(&base, &dir, "a/src/main.rs"),
            Some(real.clone())
        );
        assert_eq!(resolve_path(&base, &dir, "b/src/main.rs"), Some(real));
        assert!(resolve_path(&base, &dir, "ü notes.md").is_some());
        assert_eq!(
            resolve_path(&base, &dir, "~"),
            Some(std::fs::canonicalize(&dir).unwrap())
        );
        assert_eq!(resolve_path(&base, &dir, "missing.rs"), None);
        assert_eq!(resolve_path(&base, &dir, "a/missing.rs"), None);
    }

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
    fn version_and_eol() {
        let dir = scratch();
        let f = dir.join("v.txt");
        std::fs::write(&f, "12345").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        let (ns, size) = v.split_once('-').unwrap();
        assert!(ns.parse::<u128>().unwrap() > 0);
        assert_eq!(size, "5");
        assert_eq!(detect_eol("a\r\nb\nc"), "crlf");
        assert_eq!(detect_eol("a\nb\r\n"), "lf");
        assert_eq!(detect_eol("no newline"), "lf");
    }

    #[test]
    fn file_info_returns_text_with_version_and_eol() {
        let dir = scratch();
        let f = dir.join("a.rs");
        std::fs::write(&f, "x\r\ny\r\n").unwrap();
        let info = read_file_info(&f).unwrap();
        assert_eq!(info.kind, FileKind::Text);
        assert_eq!(info.content.as_deref(), Some("x\r\ny\r\n"));
        assert_eq!(info.eol, Some("crlf"));
        assert_eq!(info.size, 6);
        assert_eq!(info.version, version_of(&std::fs::metadata(&f).unwrap()));
    }

    #[test]
    fn file_info_omits_content_for_binary_dirs_and_large_text() {
        let dir = scratch();
        std::fs::write(dir.join("b.bin"), b"a\0b").unwrap();
        assert!(
            read_file_info(&dir.join("b.bin"))
                .unwrap()
                .content
                .is_none()
        );
        let d = read_file_info(&dir).unwrap();
        assert_eq!(d.kind, FileKind::Dir);
        assert!(d.content.is_none());
        let big = dir.join("big.txt");
        std::fs::write(&big, vec![b'a'; TEXT_LIMIT_BYTES as usize + 1]).unwrap();
        let info = read_file_info(&big).unwrap();
        assert_eq!(info.kind, FileKind::Text);
        assert!(info.content.is_none());
    }

    #[test]
    fn save_file_writes_and_returns_new_version() {
        let dir = scratch();
        let f = dir.join("a.txt");
        std::fs::write(&f, "old").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        let nv = save_file(&f, b"new!", &v).ok().unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "new!");
        assert_eq!(nv, version_of(&std::fs::metadata(&f).unwrap()));
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            1,
            "no temp file left behind"
        );
    }

    #[test]
    fn save_file_refuses_a_stale_version() {
        let dir = scratch();
        let f = dir.join("a.txt");
        std::fs::write(&f, "old").unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        std::fs::write(&f, "changed in vim").unwrap();
        match save_file(&f, b"mine", &v) {
            Err(SaveError::Conflict(cur)) => {
                assert_eq!(cur, version_of(&std::fs::metadata(&f).unwrap()))
            }
            _ => panic!("expected a conflict"),
        }
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "changed in vim");
    }

    #[test]
    fn save_file_keeps_permissions_and_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        let f = dir.join("run.sh");
        std::fs::write(&f, "echo hi").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        let link = dir.join("link.sh");
        std::os::unix::fs::symlink(&f, &link).unwrap();
        let v = version_of(&std::fs::metadata(&f).unwrap());
        save_file(&link, b"echo bye", &v).ok().unwrap();
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "echo bye");
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }
}
