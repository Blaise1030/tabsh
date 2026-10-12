//! Shared by the feature modules' tests.

use crate::{AppState, auth, sessions::open_db};
use std::sync::{Arc, Mutex};

/// An in-memory daemon state with token `t0k3n`, accepting the hosted origin.
pub(crate) fn test_state() -> AppState {
    let db = open_db(":memory:").unwrap();
    let remote = crate::remote::load(&db).unwrap();
    AppState {
        db: Arc::new(Mutex::new(db)),
        live: Default::default(),
        starting: Default::default(),
        db_path: ":memory:".into(),
        started: std::time::Instant::now(),
        token: "t0k3n".into(),
        origins: vec!["https://tabsh.cc".to_string()].into(),
        app_url: None,
        self_url: "http://127.0.0.1:7681".into(),
        events: tokio::sync::broadcast::channel(256).0,
        remote: Arc::new(remote),
        port: 7681,
        host: None,
    }
}

/// Held by every test that reads or writes `TABSH_REMOTE_ADDRESS`, which is
/// process-wide, for the whole test.
pub(crate) static ENV: Mutex<()> = Mutex::new(());

/// Owns `ENV` and `TABSH_REMOTE_ADDRESS` for one test: unset on entry and on
/// exit, even when the test fails.
pub(crate) struct Address {
    _lock: std::sync::MutexGuard<'static, ()>,
}

impl Address {
    pub(crate) fn unset() -> Self {
        let guard = Address {
            _lock: ENV.lock().unwrap_or_else(|e| e.into_inner()),
        };
        // SAFETY: the ENV lock serialises every access to this variable.
        unsafe { std::env::remove_var(ADDRESS_VAR) };
        guard
    }

    pub(crate) fn set(&self, value: &str) {
        // SAFETY: the ENV lock, held by `self`, serialises it.
        unsafe { std::env::set_var(ADDRESS_VAR, value) };
    }
}

impl Drop for Address {
    fn drop(&mut self) {
        // SAFETY: the ENV lock, still held, serialises it.
        unsafe { std::env::remove_var(ADDRESS_VAR) };
    }
}

const ADDRESS_VAR: &str = "TABSH_REMOTE_ADDRESS";

/// A port nothing listens on now.
pub(crate) fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// The peer address of a request from this machine: the guard refuses
/// requests without one.
pub(crate) fn loopback_peer() -> axum::extract::ConnectInfo<std::net::SocketAddr> {
    axum::extract::ConnectInfo(std::net::SocketAddr::from(([127, 0, 0, 1], 50000)))
}

/// A fresh, empty directory under the system temp dir.
pub(crate) fn scratch() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tabsh-test-{}", auth::random_hex(8).unwrap()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Holds `st.db` on another thread for `hold`, returning once it is held:
/// work that needs the database waits that long meanwhile.
pub(crate) fn hold_db(
    st: &crate::AppState,
    hold: std::time::Duration,
) -> std::thread::JoinHandle<()> {
    let db = st.db.clone();
    let (held, is_held) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        let _db = db.lock().unwrap();
        held.send(()).unwrap();
        std::thread::sleep(hold);
    });
    is_held.recv().unwrap();
    holder
}

/// Runs `work` as a task on a one-worker runtime while `st.db` is held for
/// 400ms, and says whether the worker stayed free meanwhile: work that waits
/// on the database (or a shell's start) inline parks that worker; work on
/// the blocking pool doesn't. Also returns what `work` returned.
pub(crate) fn off_the_worker<F>(st: &crate::AppState, work: F) -> (bool, F::Output)
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let rt = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let holder = hold_db(st, std::time::Duration::from_millis(400));
    let out = rt.block_on(async {
        let t0 = std::time::Instant::now();
        let task = tokio::spawn(work);
        // Lets `task` run: inline, it would block this worker on the held
        // database until the holder lets go.
        tokio::task::yield_now().await;
        let free = t0.elapsed() < std::time::Duration::from_millis(200);
        (free, task.await.unwrap())
    });
    holder.join().unwrap();
    out
}
