# tabsh kanban: design

Date: 2026-10-07
Status: approved in brainstorming, awaiting spec review

## Goal

A kanban board on top of tabsh, for one person running many coding-agent sessions at once
(Claude Code first; Gemini CLI, Codex and others should work too). The board is the overview for
switching between tasks; each card is a tabsh terminal opened in the task's folder, so the folder's
files and the terminal are right there when you open it. The agent keeps the board accurate itself
through one agent-neutral contract, the `tabsh status` CLI. tabsh never edits an agent's config:
`tabsh setup` prints a guide that the agent follows to wire its own hooks to that contract.

Inspired by ckanban (github.com/leoawesome/kanban), but none of its code or server is used:
tickets here are interactive terminals, not headless `claude -p` runs.

## Non-goals

- Headless or automatic agent runs, interview forms, PR tracking.
- Git worktrees. Agents create them if they want; the card follows the shell's cwd.
- Several terminals per card, task descriptions, labels, dates, assignees.
- Agents creating cards (`tabsh card new`). A likely follow-up once the CLI exists.
- tabsh writing any agent's config files or knowing their hook formats. That knowledge lives in
  the agent; tabsh ships the contract and the guide.
- Publishing a GitHub fork. The fork lives locally on branch `kanban-board`; remote `upstream`
  is Blaise1030/tabsh.

## Concepts

- **Card = tabsh session.** One row of the existing `sessions` table. The card title is the
  session name; the card's folder is the session's cwd (live, as tabsh already tracks it).
- **Statuses:** `backlog`, `in_progress`, `needs_input`, `completed`, `archived`.

| Status | Set by |
|---|---|
| backlog | Default for new sessions without a first prompt; the user |
| in_progress | The agent's "user sent a prompt" hook; new card with a first prompt; the user |
| needs_input | The agent's "needs permission/input" hook (note = its message); its "turn ended" hook (note = "Agent finished its turn"); the user |
| completed | The agent itself, following its instructions (`tabsh status completed --note "<summary>"`); the user |

For Claude Code those hooks are `UserPromptSubmit`, `Notification` and `Stop`; for Gemini CLI
`BeforeAgent`, `Notification` and `AfterAgent`. Codex only reports a finished turn (`notify`), so
its cards reach in_progress only through a first prompt or a drag. The agent works this out from
the guide; tabsh hard-codes none of it.
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

`POST /api/sessions` accepts optional `name`, `prompt` and `command` (the agent's launch
template, e.g. `claude {prompt}` or `gemini -i {prompt}`; default `claude {prompt}`). With a
prompt, the daemon replaces `{prompt}` with the prompt as one single-quoted, single-line argument
(appending it when the template has no `{prompt}`), writes that line plus Enter to the new PTY's
input once it's spawned, and sets `in_progress`; otherwise status stays `backlog`. A missing
agent binary just shows the shell's error.

### CLI (`src/cli/`)

Subcommands on the same binary; `tabsh` with no subcommand (or a port number) starts the daemon
exactly as today.

- `tabsh status <state> [--note <text>] [--if-not <state>] [--hook]`
  - Reads `TABSH_SESSION_ID`, `TABSH_URL` (default `http://127.0.0.1:7681`) and the token from
    `~/.tabsh/token`; PATCHes the daemon with a 500 ms timeout.
  - `--hook`: reads the hook's JSON from stdin (uses `message` as the note for `Notification`),
    prints nothing and **always exits 0**, including when `TABSH_SESSION_ID` is unset, the
    daemon is down, or the session is gone. Hooks must never disturb the agent.
  - Without `--hook`: clear error and exit 1 for each of those cases.
  - `--hook` takes the note from the `message` field of JSON on stdin when `--note` isn't given
    (Claude Code's and Gemini CLI's notification payloads carry one).
- `tabsh setup`: prints the agent setup guide (embedded in the binary, with `{tabsh}` replaced by
  this binary's quoted path). You tell any agent "run `tabsh setup` and follow it".

### Agent setup guide (`src/cli/setup.md`)

Addressed to the agent. It states the contract and how to wire it, safely:

1. The contract, as the table under Concepts: which moments call which `tabsh status` command.
2. Find your own hook / notification mechanism and config file. Back the file up, then merge:
   never replace other hooks, and skip entries that already call `tabsh status` (idempotent).
3. Map your events onto the contract; where you have no matching event, leave it out and say so.
4. Add an instruction to your own persistent instructions (a skill, `AGENTS.md`, `GEMINI.md`…):
   when `TABSH_SESSION_ID` is set and the user's task is done, run
   `tabsh status completed --note "<one line>"`; set no other status.
5. Verify: inside a tabsh terminal, `tabsh status needs_input --note "setup test"` moves the card;
   outside one, `tabsh status needs_input --hook` exits 0 silently.
6. Report what you set up, what you couldn't, the backup path, and how to undo it (remove
   hooks that call `tabsh status` and the instruction).

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
prompt, and the agent command (text field, default `claude {prompt}`, offering recently used
commands, which are kept in the page settings as `agentCommands`). Create →
`POST /api/sessions {name, cwd, prompt?, command?}`, close the board, focus the new tab.

### Workspace

Unchanged tabsh: explorer rooted at the session's folder, terminal, file pane/editor.

## Testing

- **Rust (`cargo test`)**, in the owning files' `mod tests`:
  - status rules: archived untouched by hooks; `--if-not completed`; user source always applies;
  - PATCH 200 / 400 / 404; event broadcast on change;
  - migration on a database without the new columns;
  - `POST /api/sessions` with a prompt sets `in_progress` and quotes the prompt safely;
  - the launch line: quoting, `{prompt}` replaced, appended when missing, other agents' templates;
  - `tabsh setup` prints the guide with the binary path filled in;
  - CLI `--hook` exits 0 silently when env/daemon/session is missing; non-hook exits 1;
  - `every_route_is_guarded` covers the new routes.
- **Web (`node --test`)**: grouping and ordering by column, time-in-status formatting, recent
  folders.
- **Playwright e2e**: create a card with a prompt → In progress; PATCH `needs_input` via the API
  → card moves, tab glyph turns amber; drag to Completed.
- **Manual**: ask Claude Code to run `tabsh setup` and follow it; then a real `claude` in a card
  moves in progress → needs input → completed. Optionally repeat with Gemini CLI.
