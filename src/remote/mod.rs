//! Sharing tabsh with other devices: the on/off flag and the per-device tokens.

// Only the guard calls this yet: the routes and listener come in later tasks.
#![allow(dead_code)]

use crate::{
    AppState,
    auth::{Credential, random_hex, token_eq},
    error::BoxError,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    collections::HashMap,
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
    listener: Mutex<Option<tokio::task::AbortHandle>>,
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
