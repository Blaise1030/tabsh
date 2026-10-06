//! The kanban board: every session is a card with a status, set by the
//! coding agent's hooks (through `tabsh status`) and by dragging cards on the board.

use rusqlite::Connection;

/// Every status a card can have, in board order.
// Unused until the status endpoint (a later task) validates against it.
#[allow(dead_code)]
pub(crate) const STATUSES: [&str; 5] = [
    "backlog",
    "in_progress",
    "needs_input",
    "completed",
    "archived",
];

/// Adds the card columns to a `sessions` table that lacks them. SQLite can't
/// add a column with a non-constant default, so `status_at` starts at 0 and
/// is set to now for those rows.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('sessions')")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for (name, ddl) in [
        (
            "status",
            "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'",
        ),
        (
            "status_at",
            "ALTER TABLE sessions ADD COLUMN status_at INTEGER NOT NULL DEFAULT 0",
        ),
        ("note", "ALTER TABLE sessions ADD COLUMN note TEXT"),
        (
            "pending_input",
            "ALTER TABLE sessions ADD COLUMN pending_input TEXT",
        ),
    ] {
        if !cols.iter().any(|c| c == name) {
            conn.execute(ddl, [])?;
        }
    }
    conn.execute(
        "UPDATE sessions SET status_at = unixepoch() WHERE status_at = 0",
        [],
    )?;
    Ok(())
}
