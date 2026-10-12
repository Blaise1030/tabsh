//! Sharing tabsh with other devices: the on/off flag and the per-device tokens.

pub(crate) mod listen;

use crate::{
    AppState,
    auth::{Credential, random_hex, token_eq},
    error::{BoxError, internal_error},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

/// A device's `last_seen` is written at most this often.
const LAST_SEEN_EVERY: Duration = Duration::from_secs(60);
const DEFAULT_NAME: &str = "iPhone";
const NAME_MAX_CHARS: usize = 60;

/// What the sharing flag and the devices are in memory: the database holds
/// them, and `credential` answers every request without it.
pub(crate) struct Remote {
    enabled: AtomicBool,
    /// Token to device.
    devices: Mutex<HashMap<String, Device>>,
    /// The second listener's task and the address it is bound to.
    listener: Mutex<Option<(tokio::task::AbortHandle, std::net::SocketAddr)>>,
    error: Mutex<Option<String>>,
    /// Sockets to close: one device's after a revoke, all after turning off.
    pub(crate) closed: broadcast::Sender<Closed>,
}

struct Device {
    id: String,
    /// When `last_seen` was last written, if since this start.
    written: Option<Instant>,
}

#[derive(Clone, Debug)]
pub(crate) enum Closed {
    Device(String),
    All,
}

/// What a socket handler calls first: the receiver its `closed_for` waits on,
/// and the device (`None`: the main token) it is for. A revoke or turning
/// sharing off between the guard's check and this subscription is never sent
/// to the receiver, so a device that is gone by now is refused (`None`)
/// instead: the handler answers 403 before it upgrades.
pub(crate) fn admit(
    st: &AppState,
    credential: Option<axum::Extension<Credential>>,
) -> Option<(broadcast::Receiver<Closed>, Option<String>)> {
    let device = match credential {
        Some(axum::Extension(Credential::Device(id))) => Some(id),
        _ => None,
    };
    // Subscribe first: what happens after is sent to `rx`, what happened
    // before is seen below.
    let rx = st.remote.closed.subscribe();
    if let Some(id) = &device {
        let known = st
            .remote
            .devices
            .lock()
            .unwrap()
            .values()
            .any(|device| device.id == *id);
        if !(known && is_enabled(st)) {
            return None;
        }
    }
    Some((rx, device))
}

/// Completes when a socket of `device` must close: sharing was turned off,
/// that device was revoked, or the signals fell behind (a missed one might
/// have been its own). Never completes for `None`, the main token's.
pub(crate) async fn closed_for(rx: &mut broadcast::Receiver<Closed>, device: &Option<String>) {
    let Some(id) = device else {
        return std::future::pending().await;
    };
    loop {
        match rx.recv().await {
            Ok(Closed::All) | Err(_) => return,
            Ok(Closed::Device(closed)) if closed == *id => return,
            Ok(Closed::Device(_)) => {}
        }
    }
}

/// The frame a socket is closed with: policy violation (1008).
pub(crate) fn policy_close() -> axum::extract::ws::Message {
    use axum::extract::ws::{CloseFrame, Message};
    Message::Close(Some(CloseFrame {
        code: 1008,
        reason: "access revoked".into(),
    }))
}

#[derive(Serialize)]
pub(crate) struct DeviceInfo {
    id: String,
    name: String,
    created: i64,
    last_seen: Option<i64>,
}

pub(crate) fn load(conn: &Connection) -> Result<Remote, BoxError> {
    let enabled = conn
        .query_row("SELECT enabled FROM remote WHERE id = 1", [], |r| {
            r.get::<_, bool>(0)
        })
        .optional()?
        .unwrap_or(false);
    let devices = conn
        .prepare("SELECT token, id FROM devices")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Device {
                    id: r.get(1)?,
                    written: None,
                },
            ))
        })?
        .collect::<Result<_, _>>()?;
    Ok(Remote {
        enabled: AtomicBool::new(enabled),
        devices: Mutex::new(devices),
        listener: Mutex::new(None),
        error: Mutex::new(None),
        closed: broadcast::channel(16).0,
    })
}

/// Who `token` is: the main token, a device's, or nobody.
pub(crate) fn credential(st: &AppState, token: &str) -> Option<Credential> {
    if token_eq(token, &st.token) {
        return Some(Credential::Main);
    }
    let (id, stale) = {
        let mut devices = st.remote.devices.lock().unwrap();
        let device = devices
            .iter_mut()
            .find(|(known, _)| token_eq(token, known))?
            .1;
        let stale = device
            .written
            .is_none_or(|at| at.elapsed() >= LAST_SEEN_EVERY);
        if stale {
            device.written = Some(Instant::now());
        }
        (device.id.clone(), stale)
    };
    if stale {
        let (db, id) = (st.db.clone(), id.clone());
        // The guard calls this on every request: don't wait on the database there.
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => drop(rt.spawn_blocking(move || save_last_seen(&db, &id))),
            Err(_) => save_last_seen(&db, &id),
        }
    }
    Some(Credential::Device(id))
}

fn save_last_seen(db: &Mutex<Connection>, id: &str) {
    let saved = db.lock().unwrap().execute(
        "UPDATE devices SET last_seen = unixepoch() WHERE id = ?1",
        params![id],
    );
    if let Err(e) = saved {
        eprintln!("tabsh: could not save when device {id} was last seen: {e}");
    }
}

/// Adds a device, returning its id and its token.
pub(crate) fn mint(st: &AppState, name: &str) -> Result<(String, String), BoxError> {
    let name = match name.trim() {
        "" => DEFAULT_NAME,
        name => name,
    };
    let name: String = name.chars().take(NAME_MAX_CHARS).collect();
    let id = random_hex(8)?;
    let token = random_hex(32)?;
    st.db.lock().unwrap().execute(
        "INSERT INTO devices (id, name, token) VALUES (?1, ?2, ?3)",
        params![id, name, token],
    )?;
    st.remote.devices.lock().unwrap().insert(
        token.clone(),
        Device {
            id: id.clone(),
            written: None,
        },
    );
    Ok((id, token))
}

/// Removes a device and closes its sockets; `false` when there is none.
pub(crate) fn revoke(st: &AppState, id: &str) -> Result<bool, BoxError> {
    let removed = st
        .db
        .lock()
        .unwrap()
        .execute("DELETE FROM devices WHERE id = ?1", params![id])?;
    st.remote
        .devices
        .lock()
        .unwrap()
        .retain(|_, device| device.id != id);
    if removed == 0 {
        return Ok(false);
    }
    let _ = st.remote.closed.send(Closed::Device(id.to_owned()));
    Ok(true)
}

pub(crate) fn set_enabled(st: &AppState, on: bool) -> Result<(), BoxError> {
    st.db.lock().unwrap().execute(
        "INSERT INTO remote (id, enabled) VALUES (1, ?1)
         ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled",
        params![on],
    )?;
    st.remote.enabled.store(on, Ordering::SeqCst);
    if !on {
        let _ = st.remote.closed.send(Closed::All);
    }
    Ok(())
}

pub(crate) fn is_enabled(st: &AppState) -> bool {
    st.remote.enabled.load(Ordering::SeqCst)
}

/// Every device, oldest first.
pub(crate) fn list(st: &AppState) -> Result<Vec<DeviceInfo>, BoxError> {
    let db = st.db.lock().unwrap();
    let devices = db
        .prepare("SELECT id, name, created, last_seen FROM devices ORDER BY created, rowid")?
        .query_map([], |r| {
            Ok(DeviceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                created: r.get(2)?,
                last_seen: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(devices)
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/remote", get(get_remote).put(put_remote))
        .route("/api/remote/devices", post(add_device))
        .route("/api/remote/devices/{id}", delete(delete_device))
}

/// What the dialog shows: the same body for `GET` and `PUT`.
#[derive(Serialize)]
struct Status {
    enabled: bool,
    /// Where other devices reach this machine: null when there is none.
    address: Option<String>,
    port: u16,
    /// The daemon's own non-loopback `HOST`, when it has one.
    host: Option<String>,
    /// Why sharing could not start, last.
    error: Option<String>,
    devices: Vec<DeviceInfo>,
}

#[derive(Deserialize)]
struct Switch {
    enabled: bool,
}

#[derive(Deserialize)]
struct NewDevice {
    #[serde(default)]
    name: String,
}

#[derive(Serialize)]
struct Pairing {
    id: String,
    name: String,
    /// Carries the token: shown once, never listed.
    url: String,
}

/// The address the listener is bound to, else the one it would bind.
fn current_address(st: &AppState) -> Option<IpAddr> {
    listen::running(st)
        .map(|bound| bound.ip())
        .or_else(listen::address)
}

fn status(st: &AppState) -> Result<Status, BoxError> {
    Ok(Status {
        enabled: is_enabled(st),
        address: current_address(st).map(|ip| ip.to_string()),
        port: st.port,
        host: st.host.as_deref().map(str::to_owned),
        error: st.remote.error.lock().unwrap().clone(),
        devices: list(st)?,
    })
}

/// Runs database work on the blocking pool, as `board` does.
async fn blocking<T: Send + 'static>(
    st: &AppState,
    work: impl FnOnce(&AppState) -> Result<T, BoxError> + Send + 'static,
) -> Result<T, StatusCode> {
    let st = st.clone();
    tokio::task::spawn_blocking(move || work(&st))
        .await
        .map_err(internal_error)?
        .map_err(internal_error)
}

async fn get_remote(State(st): State<AppState>) -> Result<Json<Status>, StatusCode> {
    blocking(&st, status).await.map(Json)
}

async fn put_remote(
    State(st): State<AppState>,
    Json(body): Json<Switch>,
) -> Result<Json<Status>, StatusCode> {
    // The daemon already listens beyond this machine: there is nothing to switch.
    if st.host.is_some() {
        return Err(StatusCode::CONFLICT);
    }
    if body.enabled {
        // The flag first: `start` refuses while sharing is off.
        blocking(&st, |st| set_enabled(st, true)).await?;
        if let Err(why) = listen::start(st.clone()).await {
            *st.remote.error.lock().unwrap() = Some(why);
            blocking(&st, |st| set_enabled(st, false)).await?;
        }
    } else {
        blocking(&st, |st| set_enabled(st, false)).await?;
        listen::stop(&st);
        *st.remote.error.lock().unwrap() = None;
    }
    blocking(&st, status).await.map(Json)
}

async fn add_device(
    State(st): State<AppState>,
    Json(body): Json<NewDevice>,
) -> Result<Json<Pairing>, StatusCode> {
    let Some(ip) = current_address(&st).filter(|_| is_enabled(&st)) else {
        return Err(StatusCode::CONFLICT);
    };
    let port = st.port;
    blocking(&st, move |st| {
        let (id, token) = mint(st, &body.name)?;
        let name = list(st)?
            .into_iter()
            .find(|device| device.id == id)
            .map_or_else(String::new, |device| device.name);
        let host = match ip {
            IpAddr::V4(ip) => ip.to_string(),
            IpAddr::V6(ip) => format!("[{ip}]"),
        };
        Ok(Pairing {
            url: format!("http://{host}:{port}/app/#token={token}"),
            id,
            name,
        })
    })
    .await
    .map(Json)
}

async fn delete_device(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    match blocking(&st, move |st| revoke(st, &id)).await? {
        true => Ok(StatusCode::NO_CONTENT),
        false => Err(StatusCode::NOT_FOUND),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Credential;
    use crate::sessions::open_db;
    use crate::test_support::{scratch, test_state};
    use std::sync::{Arc, Mutex};

    #[test]
    fn a_minted_token_is_a_device_credential() {
        let st = test_state();
        let (id, token) = mint(&st, " Pixel ").unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(credential(&st, &token), Some(Credential::Device(id)));
        assert_eq!(credential(&st, "t0k3n"), Some(Credential::Main));
        assert_eq!(credential(&st, "nope"), None);
        assert_eq!(list(&st).unwrap()[0].name, "Pixel");
    }

    #[test]
    fn an_empty_name_is_iphone() {
        let st = test_state();
        mint(&st, "  ").unwrap();
        assert_eq!(list(&st).unwrap()[0].name, "iPhone");
    }

    #[test]
    fn a_long_name_is_cut_to_sixty_characters() {
        let st = test_state();
        mint(&st, &"é".repeat(80)).unwrap();
        assert_eq!(list(&st).unwrap()[0].name.chars().count(), 60);
    }

    #[test]
    fn the_list_never_holds_a_token() {
        let st = test_state();
        let (_, token) = mint(&st, "Pixel").unwrap();
        let json = serde_json::to_string(&list(&st).unwrap()).unwrap();
        assert!(!json.contains(&token));
    }

    #[test]
    fn the_list_is_oldest_first() {
        let st = test_state();
        mint(&st, "first").unwrap();
        mint(&st, "second").unwrap();
        mint(&st, "third").unwrap();
        let names: Vec<_> = list(&st).unwrap().into_iter().map(|d| d.name).collect();
        assert_eq!(names, ["first", "second", "third"]);
    }

    #[test]
    fn revoke_drops_the_credential_and_says_so() {
        let st = test_state();
        let (id, token) = mint(&st, "Pixel").unwrap();
        let mut rx = st.remote.closed.subscribe();
        assert!(revoke(&st, &id).unwrap());
        assert_eq!(credential(&st, &token), None);
        assert!(matches!(rx.try_recv(), Ok(Closed::Device(closed)) if closed == id));
        assert!(!revoke(&st, &id).unwrap());
        assert!(list(&st).unwrap().is_empty());
    }

    #[tokio::test]
    async fn closed_for_waits_for_its_own_device_or_all() {
        let (tx, _) = broadcast::channel(2);
        let wait = |mut rx: broadcast::Receiver<Closed>, who: Option<&str>| {
            let who = who.map(str::to_owned);
            async move {
                tokio::time::timeout(Duration::from_millis(100), closed_for(&mut rx, &who))
                    .await
                    .is_ok()
            }
        };
        let (main, a, b) = (tx.subscribe(), tx.subscribe(), tx.subscribe());
        tx.send(Closed::Device("a".into())).unwrap();
        assert!(!wait(main, None).await);
        assert!(wait(a, Some("a")).await);
        assert!(!wait(b, Some("b")).await);

        let (main, b) = (tx.subscribe(), tx.subscribe());
        tx.send(Closed::All).unwrap();
        assert!(!wait(main, None).await);
        assert!(wait(b, Some("b")).await);

        // Fell behind: it can't tell whether a missed signal was its own.
        let lagging = tx.subscribe();
        for _ in 0..3 {
            tx.send(Closed::Device("z".into())).unwrap();
        }
        assert!(wait(lagging, Some("b")).await);
    }

    // A request the guard let through with a device's credential, whose
    // device is revoked (or sharing turned off) before the handler subscribes:
    // no signal will ever reach it, so the handler must refuse it.
    #[tokio::test]
    async fn a_socket_of_a_revoked_device_is_refused_after_subscribing() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (id, token) = mint(&st, "Pixel").unwrap();
        let as_guard_saw = |token: &str| credential(&st, token).map(axum::Extension);
        assert!(admit(&st, as_guard_saw(&token)).is_some());
        assert!(admit(&st, as_guard_saw("t0k3n")).is_some());

        let seen = as_guard_saw(&token);
        assert!(revoke(&st, &id).unwrap());
        assert!(admit(&st, seen).is_none());
        // The main token is not a device's: it is admitted whatever happened.
        assert!(admit(&st, as_guard_saw("t0k3n")).is_some());

        let (_, token) = mint(&st, "Pixel").unwrap();
        let seen = as_guard_saw(&token);
        set_enabled(&st, false).unwrap();
        assert!(admit(&st, seen).is_none());
        assert!(admit(&st, as_guard_saw("t0k3n")).is_some());
    }

    #[test]
    fn turning_sharing_off_closes_everything() {
        let st = test_state();
        let mut rx = st.remote.closed.subscribe();
        assert!(!is_enabled(&st));
        set_enabled(&st, true).unwrap();
        assert!(is_enabled(&st));
        assert!(rx.try_recv().is_err());
        set_enabled(&st, false).unwrap();
        assert!(!is_enabled(&st));
        assert!(matches!(rx.try_recv(), Ok(Closed::All)));
    }

    #[test]
    fn last_seen_is_written_once_a_minute() {
        let st = test_state();
        let (id, token) = mint(&st, "Pixel").unwrap();
        assert_eq!(list(&st).unwrap()[0].last_seen, None);

        credential(&st, &token);
        let first = list(&st).unwrap()[0].last_seen;
        assert!(first.is_some());

        let set = |value: i64| {
            st.db
                .lock()
                .unwrap()
                .execute(
                    "UPDATE devices SET last_seen = ?1 WHERE id = ?2",
                    rusqlite::params![value, id],
                )
                .unwrap();
        };
        set(1);
        credential(&st, &token);
        assert_eq!(list(&st).unwrap()[0].last_seen, Some(1));
    }

    #[tokio::test]
    async fn in_a_runtime_last_seen_is_written_in_the_background() {
        let st = test_state();
        let (_, token) = mint(&st, "Pixel").unwrap();
        credential(&st, &token);
        let deadline = Instant::now() + Duration::from_secs(5);
        while list(&st).unwrap()[0].last_seen.is_none() {
            assert!(Instant::now() < deadline, "last_seen was never written");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[test]
    fn enabled_and_devices_survive_reopening() {
        let path = scratch().join("state.db");
        let path = path.to_str().unwrap();
        let mut st = test_state();
        st.db = Arc::new(Mutex::new(open_db(path).unwrap()));
        st.remote = Arc::new(load(&st.db.lock().unwrap()).unwrap());
        set_enabled(&st, true).unwrap();
        let (id, token) = mint(&st, "Pixel").unwrap();
        drop(st);

        let mut st = test_state();
        st.db = Arc::new(Mutex::new(open_db(path).unwrap()));
        st.remote = Arc::new(load(&st.db.lock().unwrap()).unwrap());
        assert!(is_enabled(&st));
        assert_eq!(credential(&st, &token), Some(Credential::Device(id)));
    }
}

#[cfg(test)]
// The ENV lock is held across awaits on purpose: it serialises the tests.
#[allow(clippy::await_holding_lock)]
mod route_tests {
    use super::*;
    use crate::state::router;
    use crate::test_support::{Address, free_port, loopback_peer, test_state};
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    /// Calls `/api/remote…` as the page does: the main token, no body unless given.
    async fn call(
        st: &AppState,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://tabsh.cc")
            .header("Authorization", "Bearer t0k3n")
            .extension(loopback_peer());
        let body = match body {
            Some(json) => {
                req = req.header("Content-Type", "application/json");
                Body::from(json.to_string())
            }
            None => Body::empty(),
        };
        let res = router(st.clone())
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    #[tokio::test]
    async fn get_reports_off_with_no_devices() {
        let _env = Address::unset();
        let st = test_state();
        let (status, body) = call(&st, Method::GET, "/api/remote", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({
                "enabled": false,
                "address": null,
                "port": 7681,
                "host": null,
                "error": null,
                "devices": [],
            })
        );
    }

    #[tokio::test]
    async fn add_device_returns_the_link_once() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let mut st = test_state();
        st.port = free_port();

        let (status, body) = call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": true})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], true);
        assert_eq!(body["address"], "127.0.0.1");
        assert_eq!(body["error"], Value::Null);

        let (status, body) = call(
            &st,
            Method::POST,
            "/api/remote/devices",
            Some(json!({"name": "iPhone"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (id, url) = (body["id"].as_str().unwrap(), body["url"].as_str().unwrap());
        assert_eq!(body["name"], "iPhone");
        let token = url
            .strip_prefix(&format!("http://127.0.0.1:{}/app/#token=", st.port))
            .expect(url);
        assert_eq!(credential(&st, token), Some(Credential::Device(id.into())));

        let (_, listed) = call(&st, Method::GET, "/api/remote", None).await;
        assert_eq!(listed["devices"][0]["id"], id);
        assert_eq!(listed["devices"][0]["name"], "iPhone");
        assert!(!listed.to_string().contains(token));

        listen::stop(&st);
    }

    #[tokio::test]
    async fn an_ipv6_address_is_bracketed_in_the_link() {
        let env = Address::unset();
        env.set("::1");
        let mut st = test_state();
        st.port = free_port();
        set_enabled(&st, true).unwrap();
        let (status, body) = call(
            &st,
            Method::POST,
            "/api/remote/devices",
            Some(json!({"name": "x"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body["url"]
                .as_str()
                .unwrap()
                .starts_with(&format!("http://[::1]:{}/app/#token=", st.port)),
            "{body}"
        );
    }

    #[tokio::test]
    async fn add_device_needs_sharing_on() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let st = test_state();
        let (status, _) = call(
            &st,
            Method::POST,
            "/api/remote/devices",
            Some(json!({"name": "iPhone"})),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(list(&st).unwrap().is_empty());
    }

    #[tokio::test]
    async fn add_device_needs_an_address() {
        let _env = Address::unset();
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (status, _) = call(
            &st,
            Method::POST,
            "/api/remote/devices",
            Some(json!({"name": "iPhone"})),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(list(&st).unwrap().is_empty());
    }

    /// The socket a client opens at `path` on `addr` with `token`, as a page
    /// served from the daemon itself does.
    async fn open_socket(
        addr: std::net::SocketAddr,
        path: &str,
        token: &str,
    ) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
    {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let sep = if path.contains('?') { '&' } else { '?' };
        let mut req = format!("ws://{addr}{path}{sep}token={token}")
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("Origin", format!("http://{addr}").parse().unwrap());
        tokio_tungstenite::connect_async(req).await.unwrap().0
    }

    /// The close code the socket ends with within `within`, or `None` while
    /// it is still open. Anything else it ends with counts as 0.
    async fn closes_with<S>(socket: &mut S, within: Duration) -> Option<u16>
    where
        S: futures_util::Stream<
                Item = Result<
                    tokio_tungstenite::tungstenite::Message,
                    tokio_tungstenite::tungstenite::Error,
                >,
            > + Unpin,
    {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::Message;
        let deadline = tokio::time::Instant::now() + within;
        loop {
            match tokio::time::timeout_at(deadline, socket.next()).await {
                Err(_) => return None,
                Ok(Some(Ok(Message::Close(frame)))) => {
                    return Some(frame.map_or(0, |f| f.code.into()));
                }
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(_)) | None) => return Some(0),
            }
        }
    }

    const CLOSES_WITHIN: Duration = Duration::from_secs(1);
    const POLICY_VIOLATION: u16 = 1008;

    async fn serve(st: &AppState) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router(st.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        addr
    }

    #[tokio::test]
    async fn revoke_closes_the_devices_socket() {
        let st = test_state();
        set_enabled(&st, true).unwrap();
        let (id, token) = mint(&st, "Pixel").unwrap();
        let addr = serve(&st).await;
        let mut device = open_socket(addr, "/api/board/events", &token).await;
        let mut main = open_socket(addr, "/api/board/events", "t0k3n").await;

        assert!(revoke(&st, &id).unwrap());

        assert_eq!(
            closes_with(&mut device, CLOSES_WITHIN).await,
            Some(POLICY_VIOLATION)
        );
        assert_eq!(
            closes_with(&mut main, Duration::from_millis(300)).await,
            None
        );
    }

    // Every socket a device opens (terminal, files, board) goes with it; the
    // others stay until sharing is turned off, which takes all devices' and
    // never the main token's.
    #[tokio::test]
    async fn revoking_and_turning_sharing_off_close_every_kind_of_socket() {
        let st = test_state();
        let cwd = crate::test_support::scratch();
        st.db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO sessions (id, name, position, cwd) VALUES ('s1', 'T', 1, ?1)",
                [cwd.to_str().unwrap()],
            )
            .unwrap();
        set_enabled(&st, true).unwrap();
        let (a, token_a) = mint(&st, "A").unwrap();
        let (_, token_b) = mint(&st, "B").unwrap();
        let addr = serve(&st).await;
        let paths = [
            "/ws?id=s1",
            "/api/files/watch?session=s1",
            "/api/board/events",
        ];
        let mut of_a = Vec::new();
        for path in paths {
            of_a.push(open_socket(addr, path, &token_a).await);
        }
        let mut of_b = Vec::new();
        for path in paths {
            of_b.push(open_socket(addr, path, &token_b).await);
        }
        let mut main = open_socket(addr, "/ws?id=s1", "t0k3n").await;

        assert!(revoke(&st, &a).unwrap());
        for socket in &mut of_a {
            assert_eq!(
                closes_with(socket, CLOSES_WITHIN).await,
                Some(POLICY_VIOLATION)
            );
        }
        for socket in &mut of_b {
            assert_eq!(closes_with(socket, Duration::from_millis(200)).await, None);
        }

        set_enabled(&st, false).unwrap();
        for socket in &mut of_b {
            assert_eq!(
                closes_with(socket, CLOSES_WITHIN).await,
                Some(POLICY_VIOLATION)
            );
        }
        assert_eq!(
            closes_with(&mut main, Duration::from_millis(300)).await,
            None
        );
    }

    #[tokio::test]
    async fn delete_revokes() {
        let st = test_state();
        let (id, token) = mint(&st, "Pixel").unwrap();
        let uri = format!("/api/remote/devices/{id}");
        let (status, _) = call(&st, Method::DELETE, &uri, None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(credential(&st, &token), None);
        let (status, _) = call(&st, Method::DELETE, &uri, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_fixed_host_cannot_be_toggled() {
        let _env = Address::unset();
        let mut st = test_state();
        st.host = Some("192.168.1.2".into());
        let (status, _) = call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": true})),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(!is_enabled(&st));
        let (_, body) = call(&st, Method::GET, "/api/remote", None).await;
        assert_eq!(body["host"], "192.168.1.2");
    }

    #[tokio::test]
    async fn turning_off_stops_the_listener_and_closes_sockets() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let mut st = test_state();
        st.port = free_port();
        call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": true})),
        )
        .await;
        assert!(st.remote.listener.lock().unwrap().is_some());
        let mut rx = st.remote.closed.subscribe();

        let (status, body) = call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": false})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        assert!(!is_enabled(&st));
        assert!(st.remote.listener.lock().unwrap().is_none());
        assert!(matches!(rx.try_recv(), Ok(Closed::All)));
    }

    #[tokio::test]
    async fn a_failed_start_leaves_sharing_off_and_says_why() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut st = test_state();
        st.port = taken.local_addr().unwrap().port();

        let (status, body) = call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": true})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        assert!(
            body["error"].as_str().is_some_and(|e| !e.is_empty()),
            "{body}"
        );
        assert!(!is_enabled(&st));
    }

    #[tokio::test]
    async fn no_address_leaves_sharing_off_and_says_so() {
        let _env = Address::unset();
        let st = test_state();
        let (status, body) = call(
            &st,
            Method::PUT,
            "/api/remote",
            Some(json!({"enabled": true})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        assert_eq!(body["error"], "No Tailscale address");
    }
}
