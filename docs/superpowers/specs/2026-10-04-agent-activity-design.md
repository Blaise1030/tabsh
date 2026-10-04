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
- A tab running Claude Code or Codex shows whether the agent is working,
  waiting for you, or done. Other agents can do the same, best effort.
- Only a tab that is waiting for you badges the favicon and title.
- A stray BEL can't override what an agent reports.
- Setting it up is one copied prompt: the app offers it on first run, and
  the settings palette keeps it.

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
- presets for agents other than Claude Code and Codex (the prompt has them
  call `tabsh hook <state>` directly);
- a command that edits agents' config files itself (the agent does it,
  from the prompt);
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
- `tabsh hook <agent>` (`claude` or `codex`) reads the agent's hook JSON
  from stdin and maps it to a state (section 3).

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
subcommand, or with a port, starts the daemon as today; `hook` runs the
CLI. The CLI lives in `src/cli/hook.rs`.

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

### Mapping events to states

Claude Code and Codex both pass command hooks a JSON object on stdin with
`hook_event_name`, and share most event names. `tabsh hook claude` and
`tabsh hook codex` read it (and, for Claude's `Notification`,
`notification_type`) and map it with one shared table plus a few rows per
agent:

| Event | State | Agents |
|---|---|---|
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | `running` | both |
| `PostToolUseFailure` | `running` | Claude |
| `PermissionRequest` | `needs-input` | both |
| `Elicitation`, and `Notification` with `permission_prompt` or `elicitation_dialog` | `needs-input` | Claude |
| `Stop`, `SessionEnd` | `idle` | both |
| `StopFailure` | `idle` | Claude |
| `Interrupt` | `idle` | Codex |
| anything else | no request | |

- `PostToolUse` moves the tab back from `needs-input` once you grant a
  permission.
- Claude's `Notification` with `idle_prompt` is ignored: it's the reminder
  after a turn ends, and would turn "done" back into "needs you".
- Subagent events are ignored; the main agent stays `running` meanwhile.
- The hook prints nothing, so it never answers a `PermissionRequest`.
- The mapping is a pure function in `cli/hook.rs`, with a unit test per row
  and agent.

### Setting it up: a prompt for the agent

tabsh doesn't edit agents' config files. It gives you a prompt to paste into
your agent, and the agent sets up its own hooks. The agent knows its config
format; tabsh keeps the part that needs to be right, the mapping.

The prompt tells the agent to:
1. Find the `tabsh` binary's absolute path (`command -v tabsh`) and use it
   in the hooks, so they don't depend on the hooks' `PATH`.
2. **If it is Claude Code or Codex:** add hooks in its user-level config
   (`~/.claude/settings.json`, `~/.codex/hooks.json`) that send every event
   in the table above to `<tabsh> hook claude` (or `codex`), keeping every
   existing hook and adding nothing twice.
3. **Otherwise:** call `<tabsh> hook running`, `needs-input` or `idle` from
   its own events. The prompt defines the three states and gives the rules
   above as examples: a permission prompt is `needs-input`, granting it
   returns to `running`, a reminder after a turn ends changes nothing.
4. Say what it changed, and that the hooks do nothing outside tabsh.
5. Check its work: run `<tabsh> hook needs-input` in its own tab, then
   `<tabsh> hook idle`, so you see the dot appear and clear.

The prompt's text lives in one place, `web/src/app/agents/prompt.ts`, as a
pure module with a test that pins the table's events into it, so the prompt
and the Rust mapping can't drift apart unnoticed. The README points to the
dialog rather than copying the text.

### The dialog

A new app feature, `web/src/app/agents/`, with `initAgents()` called from
`main.ts`:
- `prompt.ts`: the prompt text (above);
- `dialog.ts`: a `<dialog>` like About's. It explains in two lines what the
  hooks do, shows the prompt read-only, and has **Copy prompt** and **Not
  now**. Copy puts the prompt on the clipboard and shows "Copied — paste it
  into your agent".

**On first run,** the dialog opens once the page is paired and its tabs are
restored. It doesn't open again after either button or Escape: a new
setting, `agentPromptSeen: boolean` (default `false`), is saved on the
daemon, so it's once per machine rather than per browser. It also doesn't
open if a tab has already reported activity, which means hooks are set up.

**From the palette,** a "Set up agent hooks" item in the settings palette
(`palette/pages.ts`) opens the same dialog at any time.

`agents` sits between `sessions` and `palette` in the app's dependency
order, which `docs/architecture.md` is updated to show.

## Testing

**Daemon (`cargo test`):**
- the route: 204, 404, 400; no Origin without token → 401; foreign Origin
  → 403;
- `every_route_is_guarded` includes the route;
- setting the same state twice broadcasts once;
- attach sends the current state after the history;
- the foreground check resets to `idle` once the shell is in front again;
- the mapping, every row, for both agents;
- the hook CLI exits 0 silently without `TABSH_SESSION` and with an
  unreachable daemon.

**App (`npm test`):**
- `activity-view.ts`, for every state, seen and unseen;
- `prompt.ts` names every event in the mapping table, for both agents;
- `cleanSettings` keeps `agentPromptSeen` and defaults it to `false`.

**By hand:** on a fresh daemon, the dialog opens once and not after a
reload. Paste the prompt into Claude Code and into Codex, and check what
each wrote to its config. Then, in a tabsh tab, run each agent, ask
for something that needs a permission, switch tabs, and check spinner →
orange dot and badge → spinner → ✓.
