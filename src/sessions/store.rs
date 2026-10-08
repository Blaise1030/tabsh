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
    crate::board::migrate(&conn)?;
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

/// The columns `SessionInfo` is read from, in `info_row`'s order.
pub(crate) const INFO_COLUMNS: &str = "id, name, status, status_at, note, cwd, pinned";

pub(super) fn info_row(r: &rusqlite::Row) -> rusqlite::Result<SessionInfo> {
    Ok(SessionInfo {
        id: r.get(0)?,
        name: r.get(1)?,
        status: r.get(2)?,
        status_at: r.get(3)?,
        note: r.get(4)?,
        cwd: r.get(5)?,
        pinned: r.get(6)?,
    })
}

/// One session as the tab strip and the board see it.
pub(crate) fn info(db: &Connection, id: &str) -> rusqlite::Result<Option<SessionInfo>> {
    use rusqlite::OptionalExtension;
    db.query_row(
        &format!("SELECT {INFO_COLUMNS} FROM sessions WHERE id = ?1"),
        params![id],
        info_row,
    )
    .optional()
}

/// What a new session starts as.
pub(crate) struct NewCard<'a> {
    pub(crate) cwd: Option<&'a str>,
    /// `None`: the next free "Terminal N".
    pub(crate) name: Option<&'a str>,
    pub(crate) status: &'a str,
    /// Typed into the shell once the card is In progress and it runs.
    pub(crate) pending: Option<&'a str>,
    /// Handed to that shell as `TABSH_PROMPT`.
    pub(crate) prompt: Option<&'a str>,
    /// The name was chosen by the user: shell titles don't replace it.
    pub(crate) pinned: bool,
    /// How its agent's conversation is reopened after a restart, with
    /// `{session}` for the id its hooks report.
    pub(crate) resume: Option<&'a str>,
}

impl Default for NewCard<'_> {
    fn default() -> Self {
        NewCard {
            cwd: None,
            name: None,
            status: "backlog",
            pending: None,
            prompt: None,
            pinned: false,
            resume: None,
        }
    }
}

#[cfg(test)]
pub(crate) fn insert_session(db: &Connection, cwd: Option<&str>) -> rusqlite::Result<SessionInfo> {
    insert_card(
        db,
        &NewCard {
            cwd,
            ..Default::default()
        },
    )
}

pub(crate) fn insert_card(db: &Connection, card: &NewCard) -> rusqlite::Result<SessionInfo> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = format!("{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed));

    let name = match card.name {
        Some(n) => n.to_owned(),
        None => {
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
            format!("Terminal {n}")
        }
    };
    db.execute(
        "INSERT INTO sessions (id, name, position, cwd, status, status_at, pending_input, pending_prompt, pinned, resume_command)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sessions), ?3, ?4, unixepoch(), ?5, ?6, ?7, ?8)",
        params![id, name, card.cwd, card.status, card.pending, card.prompt, card.pinned, card.resume],
    )?;
    Ok(info(db, &id)?.expect("just inserted"))
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

    #[test]
    fn new_sessions_are_backlog_cards() {
        let db = open_db(":memory:").unwrap();
        let a = insert_session(&db, Some("/tmp")).unwrap();
        assert_eq!(a.status, "backlog");
        assert!(a.status_at > 1_700_000_000, "status_at is now, not 0");
        assert_eq!(a.note, None);
        assert_eq!(a.cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn a_card_can_start_named_with_a_status_and_pending_input() {
        let db = open_db(":memory:").unwrap();
        let c = insert_card(
            &db,
            &NewCard {
                cwd: None,
                name: Some("Fix login"),
                status: "in_progress",
                pending: Some("claude 'x'\r"),
                prompt: None,
                pinned: false,
                resume: None,
            },
        )
        .unwrap();
        assert_eq!(
            (c.name.as_str(), c.status.as_str()),
            ("Fix login", "in_progress")
        );
        let pending: Option<String> = db
            .query_row(
                "SELECT pending_input FROM sessions WHERE id = ?1",
                params![c.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending.as_deref(), Some("claude 'x'\r"));
        assert_eq!(info(&db, &c.id).unwrap().unwrap().name, "Fix login");
        assert!(info(&db, "missing").unwrap().is_none());
    }

    #[test]
    fn an_old_database_gains_the_card_columns() {
        let dir = crate::test_support::scratch();
        let path = dir.join("state.db");
        let path = path.to_str().unwrap();
        {
            let old = Connection::open(path).unwrap();
            old.execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
                 cwd TEXT, scrollback BLOB NOT NULL DEFAULT x'', updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
                 INSERT INTO sessions (id, name, position) VALUES ('old', 'Terminal 1', 1);",
            )
            .unwrap();
        }
        let db = open_db(path).unwrap();
        let s = info(&db, "old").unwrap().unwrap();
        assert_eq!(s.status, "backlog");
        assert!(s.status_at > 1_700_000_000);
        // Opening twice is fine (migration is idempotent).
        drop(db);
        open_db(path).unwrap();
    }
}
