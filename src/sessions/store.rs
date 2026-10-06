//! The SQLite database: which sessions exist, their saved scrollback and cwd.

use super::{Session, SessionInfo, pty::process_cwd};
use crate::{AppState, error::BoxError};
use rusqlite::{Connection, params};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

pub(crate) fn open_db(path: &str) -> Result<Connection, BoxError> {
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
pub(crate) fn flush(state: &AppState) {
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

pub(super) fn insert_session(db: &Connection, cwd: Option<&str>) -> rusqlite::Result<SessionInfo> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = format!("{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed));

    let names: Vec<String> = db
        .prepare("SELECT name FROM sessions")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let n = names
        .iter()
        .filter_map(|n| n.strip_prefix("Terminal ")?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    let name = format!("Terminal {n}");
    db.execute(
        "INSERT INTO sessions (id, name, position, cwd)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sessions), ?3)",
        params![id, name, cwd],
    )?;
    Ok(SessionInfo { id, name })
}

/// Sets the tab order: `ids` first, in that order, then any other sessions in
/// their old order.
pub(super) fn reorder(db: &mut Connection, ids: &[String]) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    let old: Vec<String> = tx
        .prepare("SELECT id FROM sessions ORDER BY position")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let given = ids.iter().filter(|id| old.contains(id));
    let rest = old.iter().filter(|id| !ids.contains(id));
    for (pos, id) in given.chain(rest).enumerate() {
        tx.execute(
            "UPDATE sessions SET position = ?1 WHERE id = ?2",
            params![pos as i64 + 1, id],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_session_can_start_in_a_directory() {
        let db = open_db(":memory:").unwrap();
        let a = insert_session(&db, None).unwrap();
        let b = insert_session(&db, Some("/tmp")).unwrap();
        assert_eq!(a.name, "Terminal 1");
        assert_eq!(b.name, "Terminal 2");
        let cwd: Option<String> = db
            .query_row(
                "SELECT cwd FROM sessions WHERE id = ?1",
                params![b.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn reorder_puts_given_ids_first_and_keeps_the_rest_in_order() {
        let mut db = open_db(":memory:").unwrap();
        let [a, b, c, d] = [(); 4].map(|_| insert_session(&db, None).unwrap().id);
        reorder(&mut db, &[c.clone(), "nope".into(), a.clone()]).unwrap();
        let order: Vec<String> = db
            .prepare("SELECT id FROM sessions ORDER BY position")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(order, [c, a, b, d]);
    }
}
