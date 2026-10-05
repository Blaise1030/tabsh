//! Shared by the feature modules' tests.

use crate::{AppState, auth, sessions::open_db};
use std::sync::{Arc, Mutex};

/// An in-memory daemon state with token `t0k3n`, accepting the hosted origin.
pub(crate) fn test_state() -> AppState {
    let db = open_db(":memory:").unwrap();
    AppState {
        db: Arc::new(Mutex::new(db)),
        live: Default::default(),
        db_path: ":memory:".into(),
        started: std::time::Instant::now(),
        token: "t0k3n".into(),
        origins: vec!["https://tabsh.cc".to_string()].into(),
        app_url: None,
        url: "http://127.0.0.1:7681/".into(),
    }
}

/// A fresh, empty directory under the system temp dir.
pub(crate) fn scratch() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tabsh-test-{}", auth::random_hex(8).unwrap()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
