# Agent activity: tabs that know when an agent needs you

Status: approved design, 2026-10-04.

## Intent

**Problem:** tabsh tells you a tab needs attention only through BEL. A BEL
says nothing about who sent it or why, so it fires when nothing needs you.
For example, after a program leaves focus reporting on (`\e[?1004h`), zsh
treats the focus codes `\e[I` and `\e[O` as unknown keys and beeps on every
tab switch. A BEL also can't tell "the agent is working" from "it's done"
from "it's waiting for a permission".

**Success looks like:**
- A tab running Claude Code shows whether the agent is working, waiting for
  you, or done.
- Only a tab that is waiting for you badges the favicon and title.
- A stray BEL can't override what an agent reports.
- Setting it up is one command, `tabsh hooks install claude`.

**Constraints:**
- The security model changes in one deliberate place only, documented in
  `docs/architecture.md` (section 1).
- Hooks never slow down or break the agent: they time out fast and swallow
  errors.
- The same hook config is harmless in any other terminal.

**Prior art:** Paseo and Herdr both report agent state through hooks rather
than by parsing terminal output, for the same reasons. Paseo's three states
(`running`, `idle`, `needs-input`) are the ones used here.

**Out of scope:**
- browser notifications (desktop pop-ups), which can be added on top later;
- Codex and other agents' hook presets (they can call `tabsh hook <state>`
  directly);
- changing the "unread" dot for background output;
- fixing the zsh focus-code beeps themselves (a separate change).

## 1. How a hook reaches the daemon

### Environment

`sessions/pty.rs` sets three variables on every shell it spawns:

| Variable | Value |
|---|---|
| `TABSH_SESSION` | the tab's session ID |
| `TABSH_URL` | the daemon's own address, e.g. `http://127.0.0.1:7681` |
| `TABSH_TOKEN_FILE` | the path to the pairing token file (beside the database) |

The token itself is never put in the environment, so it isn't inherited by
every child process. `TABSH_URL` makes a development daemon on another port
work without configuration.

### Route

`POST /api/sessions/{id}/activity` with the JSON body
`{"state": "running" | "needs-input" | "idle"}`.

| Case | Response |
|---|---|
| State set | 204 |
| Unknown session | 404 |
| Malformed body or unknown state | 400 |

The route belongs to the `sessions` feature and is merged in
`state::router()` like every other route.

### Guard

Requests without an `Origin` come from local programs, not web pages. Today
they pass the guard without a token, except `/api/files*`, which needs one
(`admits_without_origin` in `web/guard.rs`). The activity route joins that
exception: **without an Origin, it needs the token.** From a browser page,
the usual Origin and token rules apply unchanged.

So a web page can't set a tab's state: it has no token, and a foreign Origin
is refused. Another program running as the same user could, but it can
already read the token file, so nothing new is exposed.

The "Without an Origin" bullet of **Security invariants** in
`docs/architecture.md` is updated to name the activity route.

### CLI: `tabsh hook`

- `tabsh hook <state>` posts `<state>` for `$TABSH_SESSION`.
- `tabsh hook claude` reads Claude Code's hook JSON from stdin and maps it
  to a state (section 3).

Behaviour:
- Without `TABSH_SESSION`, it exits 0 at once and does nothing.
- It reads the token from `TABSH_TOKEN_FILE` and sends it as
  `Authorization: Bearer <token>`.
- The request is a minimal HTTP/1.1 POST over a `TcpStream` to the host and
  port in `TABSH_URL`. No HTTP client crate is added.
- It times out after 1 second overall.
- It ignores every error, prints nothing and always exits 0, so it can
  never block or alter the agent.

Argument parsing moves out of `main.rs`'s startup: `tabsh` with no
subcommand, or with a port, starts the daemon as today; `hook` and `hooks`
run the CLI. The CLI lives in `src/cli/` (`hook.rs`, `install.rs`).

## 2. From the daemon to the page

### Daemon

- `Session` holds its current `activity` (`Idle`, `Running`,
  `NeedsInput`), starting at `Idle`. It's in memory only: after a daemon
  restart the agents are gone, so every tab starts idle.
- Setting it broadcasts a new `Event::Activity(state)` on the session's
  existing channel, only when the state actually changes.
- `ws.rs` forwards it as a text frame, `{"activity":"needs-input"}`, beside
  the existing `{"exit":true}`.
- On attach, right after the replayed history, the daemon sends the current
  state if it isn't `idle`.

**Recovering from a crashed agent:** if an agent dies without sending
`idle`, the tab would stay `running`. Whenever the PTY reader receives
output while the state isn't `idle`, it compares the PTY's foreground
process group (`MasterPty::process_group_leader()`) with the shell's PID. If
they match, the agent has gone and the state resets to `idle`. A quitting
agent always makes the shell print its prompt, so the check runs; while
idle, it costs nothing.

### Page

A new `web/src/app/sessions/activity.ts` handles the frames. Its pure logic,
from a state plus whether you've seen the tab to what to show, sits in
`activity-view.ts` with a `node --test` test, and doesn't touch the DOM.

| State | Tab | Favicon and title | Clears |
|---|---|---|---|
| `running` | small spinner | – | when the state changes |
| `needs-input` | orange dot (the bell's style) | badge and 🔔, unless that tab is active and the page is focused | when the agent moves on, not on visiting |
| `idle`, after `running` | ✓ "done" | – | when you visit the tab |
| `idle` | nothing | – | – |

- While a tab has had hook activity in this page, BEL from that tab is
  ignored. Tabs without hooks keep the BEL behaviour.
- `bell.ts`'s favicon and title badge counts `needs-input` tabs as well as
  ringing ones.
- The spinner respects `prefers-reduced-motion` (a static marker instead).

## 3. The agent side

### Claude Code mapping

`tabsh hook claude` reads `hook_event_name` (and, for `Notification`,
`notification_type`) from stdin:

| Event | State |
|---|---|
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | `running` |
| `PermissionRequest`, `Elicitation` | `needs-input` |
| `Notification` with `permission_prompt` or `elicitation_dialog` | `needs-input` |
| `Stop`, `StopFailure`, `SessionEnd` | `idle` |
| anything else | no request |

- `PostToolUse` moves the tab back from `needs-input` once you grant a
  permission.
- `Notification` with `idle_prompt` is ignored: it's the reminder after a
  turn ends, and would turn "done" back into "needs you".
- Subagent events are ignored; the main agent stays `running` meanwhile.
- The hook prints nothing, so it never answers a `PermissionRequest`.
- The mapping is a pure function in `cli/hook.rs`, with a unit test per row.

### Installing

`tabsh hooks install claude`:
- adds one entry per event above to `~/.claude/settings.json`, each running
  `<absolute path of this binary> hook claude`;
- writes `settings.json.tabsh-backup` before changing anything;
- keeps every other key and hook, and doesn't add an entry that's already
  there, so running it twice changes nothing;
- creates the file if it doesn't exist.

`tabsh hooks uninstall claude` removes exactly the entries whose command
ends in ` hook claude` and points at a `tabsh` binary, and leaves the rest.

The README shows the JSON for adding the hooks by hand.

## Testing

**Daemon (`cargo test`):**
- the route: 204, 404, 400; no Origin without token → 401; foreign Origin
  → 403;
- `every_route_is_guarded` includes the route;
- setting the same state twice broadcasts once;
- attach sends the current state after the history;
- the foreground check resets to `idle` once the shell is in front again;
- the Claude mapping, every row;
- install: into a missing file, beside existing hooks, twice (no change),
  then uninstall (back to the original);
- the hook CLI exits 0 silently without `TABSH_SESSION` and with an
  unreachable daemon.

**App (`npm test`):** `activity-view.ts`, for every state, seen and unseen.

**By hand:** in a tabsh tab with the hooks installed, run Claude Code, ask
for something that needs a permission, switch tabs, and check spinner →
orange dot and badge → spinner → ✓.
