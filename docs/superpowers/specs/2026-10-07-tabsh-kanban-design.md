# tabsh kanban: design

Date: 2026-10-07
Status: approved in brainstorming, awaiting spec review

## Goal

A kanban board on top of tabsh, for one person running many Claude Code sessions at once.
The board is the overview for switching between tasks; each card is a tabsh terminal opened in
the task's folder, so the folder's files and the terminal are right there when you open it.
Claude keeps the board accurate itself, through a `tabsh` CLI, Claude Code hooks and a skill.

Inspired by ckanban (github.com/leoawesome/kanban), but none of its code or server is used:
tickets here are interactive terminals, not headless `claude -p` runs.

## Non-goals

- Headless or automatic Claude runs, interview forms, PR tracking.
- Git worktrees. Agents create them if they want; the card follows the shell's cwd.
- Several terminals per card, task descriptions, labels, dates, assignees.
- Claude creating cards (`tabsh card new`). A likely follow-up once the CLI exists.
- Publishing a GitHub fork. The fork lives locally on branch `kanban-board`; remote `upstream`
  is Blaise1030/tabsh.

## Concepts

- **Card = tabsh session.** One row of the existing `sessions` table. The card title is the
  session name; the card's folder is the session's cwd (live, as tabsh already tracks it).
- **Statuses:** `backlog`, `in_progress`, `needs_input`, `completed`, `archived`.

| Status | Set by |
|---|---|
| backlog | Default for new sessions without a first prompt; the user |
| in_progress | `UserPromptSubmit` hook; new card with a first prompt; the user |
| needs_input | `Notification` hook (note = notification text); `Stop` hook (note = "Claude finished its turn"); the user |
| completed | The skill (`tabsh status completed --note "<summary>"`); the user |
| archived | The user only |

## Daemon (Rust)

Follows `docs/architecture.md`: split by feature, `routes()` per feature merged in
`state::router()`, every route added to `every_route_is_guarded`, `pub(crate)` at most.

### Data

Migration in `sessions/store.rs::open_db`, adding columns when missing (old databases keep
working; existing sessions become backlog cards):

- `status TEXT NOT NULL DEFAULT 'backlog'`
- `status_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `note TEXT` (nullable; cleared on every status change that doesn't set one)

`GET /api/sessions` (`SessionInfo`) gains `status`, `status_at`, `note`, `cwd`.

### Environment

`sessions/pty.rs` sets, for every shell it spawns:
`TABSH_SESSION_ID=<id>` and `TABSH_URL=http://127.0.0.1:<port>` (the daemon's actual address).

### New feature `src/board/`

- `PATCH /api/sessions/{id}/status`, body `{status, note?, source?: "hook" | "user"}`.
  - `400` unknown status, `404` unknown session, `200` with the updated `SessionInfo`.
  - Rules, only when `source == "hook"` (the default for the CLI):
    - an `archived` card is never changed;
    - `needs_input` from `Stop` does not replace `completed` (the CLI marks the Stop hook's
      call with `--if-not completed`, sent as `unless: "completed"`);
    - anything else applies.
  - `source == "user"` (the board) always applies.
  - Writes `status`, `status_at = now`, `note`, then broadcasts.
- `GET /api/board/events` (WebSocket, guarded): sends `{id, status, status_at, note}` on every
  change. Backed by a `tokio::sync::broadcast` channel in `AppState`. On (re)connect the client
  runs `sync()` to catch up, so missed events don't matter.

### First prompt

`POST /api/sessions` accepts optional `name` and `prompt`. With a prompt, the daemon writes
`claude <shell-quoted prompt>\r` to the new PTY's input once it's spawned and sets
`in_progress`; otherwise status stays `backlog`. A missing `claude` just shows the shell's error.

### CLI (`src/cli/`)

Subcommands on the same binary; `tabsh` with no subcommand (or a port number) starts the daemon
exactly as today.

- `tabsh status <state> [--note <text>] [--if-not <state>] [--hook]`
  - Reads `TABSH_SESSION_ID`, `TABSH_URL` (default `http://127.0.0.1:7681`) and the token from
    `~/.tabsh/token`; PATCHes the daemon with a 500 ms timeout.
  - `--hook`: reads the hook's JSON from stdin (uses `message` as the note for `Notification`),
    prints nothing and **always exits 0**, including when `TABSH_SESSION_ID` is unset, the
    daemon is down, or the session is gone. Hooks must never disturb Claude.
  - Without `--hook`: clear error and exit 1 for each of those cases.
- `tabsh hooks install` / `tabsh hooks uninstall`
  - Merges into `~/.claude/settings.json`: `UserPromptSubmit` → `tabsh status in_progress --hook`,
    `Notification` → `tabsh status needs_input --hook`, `Stop` →
    `tabsh status needs_input --hook --if-not completed --note "Claude finished its turn"`.
  - Writes `settings.json.bak` first; idempotent; never touches other hooks. Uninstall removes
    only entries whose command starts with `tabsh status`.
  - Also writes / removes the skill at `~/.claude/skills/tabsh-board/SKILL.md`.

### Skill (`tabsh-board`)

Embedded in the binary, written by `hooks install`. Tells Claude: when running inside a tabsh
terminal (`TABSH_SESSION_ID` is set) and the user's task is done, run
`tabsh status completed --note "<one-line summary of what was done>"`. Don't set other statuses;
hooks handle them.

## Web app (`web/src/app/board/`)

Uses only the Basecoat tokens in `app.css` (`--background`, `--card`, `--border`,
`--muted-foreground`, `--accent`, …), which derive from the active terminal theme, so the board
matches every tabsh theme and font in light and dark.

### Tab strip

- Each tab gets a status glyph: ◌ backlog, ◐ in progress (gentle pulse), ● needs input (amber,
  and triggers tabsh's existing bell / favicon badge), ✓ completed.
- Archived sessions are not shown in the strip.
- **▦ Board** button at the strip's left; ⌘B (a keybinding in `settings/keys.ts`) toggles it.
- The existing `+` keeps working: a backlog card named after its folder.

### Board view

Replaces the terminal area while open. Linear-style, minimal:

- **Columns** Backlog, In progress, Needs input, Completed; header = glyph, name, count, `+`
  (opens New card with that status). **Archive ▸** at the far right expands a column of archived
  cards with Restore and Delete (Delete = closing the tab today: kills the shell).
- **Card**: `--card` background, 1px `--border`, small radius, no shadow. Title (medium weight)
  with the status glyph top-right; folder icon + short path (muted); note (muted, 2-line clamp,
  only when set); time in status (muted, e.g. `3m`, `2d`). Hover tints with `--accent`.
- **Needs input** glyph is the only coloured element on the board.
- Click a card: close the board, focus its terminal. Drag between columns: set status
  (`source: "user"`). Drag within a column: reorder via the existing `PUT /api/sessions/order`.
- Columns scroll horizontally; each column scrolls vertically.
- The ⌘K palette lists `needs_input` sessions first.

### New card

Dialog: title, folder (text field + recent folders from existing sessions' cwds), optional first
prompt. Create → `POST /api/sessions {name, cwd, prompt?}`, close the board, focus the new tab.

### Workspace

Unchanged tabsh: explorer rooted at the session's folder, terminal, file pane/editor.

## Testing

- **Rust (`cargo test`)**, in the owning files' `mod tests`:
  - status rules: archived untouched by hooks; `--if-not completed`; user source always applies;
  - PATCH 200 / 400 / 404; event broadcast on change;
  - migration on a database without the new columns;
  - `POST /api/sessions` with a prompt sets `in_progress` and quotes the prompt safely;
  - hooks install: merge with foreign hooks, idempotent, backup written, uninstall removes ours only;
  - CLI `--hook` exits 0 silently when env/daemon/session is missing; non-hook exits 1;
  - `every_route_is_guarded` covers the new routes.
- **Web (`node --test`)**: grouping and ordering by column, time-in-status formatting, recent
  folders.
- **Playwright e2e**: create a card with a prompt → In progress; PATCH `needs_input` via the API
  → card moves, tab glyph turns amber; drag to Completed.
- **Manual**: real `claude` in a card moves in progress → needs input → completed via hooks and
  the skill.
