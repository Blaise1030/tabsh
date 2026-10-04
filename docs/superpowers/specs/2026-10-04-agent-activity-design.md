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
- A tab running any terminal coding agent with hooks shows whether the
  agent is working, waiting for you, or done. The agents covered are Claude
  Code, Codex, Gemini CLI, Copilot CLI, Qwen Code, Factory Droid, Continue
  `cn`, Kimi, Goose, Augment Auggie and Crush, plus OpenCode and Amp
  through plugins and Aider through its notification command.
- Agents whose hooks can't report "waiting for you" still get it when they
  ring the terminal bell.
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
- agents that run outside a terminal (Cursor's desktop app, Windsurf,
  Kiro's IDE, Cline in VS Code): they never run in a tabsh tab;
- guessing "waiting for you" from screen contents, as Herdr does, for agents
  with neither such an event nor a bell;
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

- `tabsh hook` reads an agent's hook JSON from stdin, works out the event
  and maps it to a state (section 3). It needs no agent name.
- `tabsh hook <state>` posts `<state>` directly, for plugins and
  notification commands.

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

- Once a tab has had hook activity in this page, BEL from it depends on its
  state:
  - **while `running`**, a BEL shows as `needs-input`, because a working
    agent that rings is asking for you. This covers agents whose hooks have
    no "waiting for you" event. The display lasts until the next state
    arrives from the daemon; it isn't sent back to the daemon.
  - **while `idle`**, a BEL is ignored, so shell beeps at the prompt (such
    as zsh's focus-code beeps) don't mark the tab.

  Tabs without hook activity keep the BEL behaviour.
- `bell.ts`'s favicon and title badge counts `needs-input` tabs as well as
  ringing ones.
- The spinner respects `prefers-reduced-motion` (a static marker instead).

## 3. The agent side

### Which agents, and how

Only agents that run in a terminal can be in a tabsh tab. Their hook
systems, as documented in October 2026:

| Kind | Agents | Event field on stdin |
|---|---|---|
| Claude's event names | Claude Code, Codex, Qwen Code, Factory Droid, Continue `cn`, Copilot CLI (PascalCase mode), Kimi, Augment Auggie, Crush | `hook_event_name` (Crush: `event`) |
| Claude's names, other field | Goose | `event` |
| Claude's names, field unconfirmed | Kiro CLI | unconfirmed; any of the fields below |
| Own event names | Gemini CLI, Copilot CLI (camelCase mode) | `hook_event_name` |
| JS/TS plugins | OpenCode, Amp | – (the plugin runs `tabsh hook <state>`) |
| Notification command | Aider | – (`tabsh hook idle`) |

Goose, Augment Auggie, Crush, Amp and Kiro's CLI have no event for
"waiting for you"; for them, the BEL rule in section 2 fills the gap. Crush
only has `PreToolUse`, so it reports `running` and relies on the foreground
check to return to `idle`.

### Mapping events to states

`tabsh hook` takes the event name from the first of these fields present:
`hook_event_name`, `event`, `hookName`, `agent_action_name`. It normalises
the name by ignoring case and `_`, so `PreToolUse`, `preToolUse` and
`pre_tool_use` are the same. For `Notification`, it reads the type from
`notification_type` (or `type`), normalised the same way.

| Events (normalised) | State |
|---|---|
| `UserPromptSubmit`, `UserPromptSubmitted`, `BeforeSubmitPrompt`, `BeforeAgent`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `BeforeTool`, `AfterTool` | `running` |
| `PermissionRequest`, `Elicitation` | `needs-input` |
| `Notification` of type `permission_prompt`, `elicitation_dialog`, `agent_needs_input` or `ToolPermission` | `needs-input` |
| `Stop`, `StopFailure`, `AgentStop`, `AfterAgent`, `SessionEnd`, `Interrupt` | `idle` |
| anything else, including JSON it can't parse | no request |

- `PostToolUse` and `AfterTool` move the tab back from `needs-input` once
  you grant a permission.
- `Notification` of type `idle_prompt` is ignored for every agent (Claude,
  Qwen and Droid send it): it's the reminder after a turn ends, and would
  turn "done" back into "needs you".
- Subagent events are ignored; the main agent stays `running` meanwhile.
- The hook prints nothing, so it never answers a `PermissionRequest`.
- The mapping is a pure function in `cli/hook.rs`.

### Setting it up: a prompt for the agent

tabsh doesn't edit agents' config files. It gives you a prompt to paste into
your agent, and the agent sets up its own hooks. The agent knows its config
format; tabsh keeps the part that needs to be right, the mapping.

The prompt tells the agent to:
1. Find the `tabsh` binary's absolute path (`command -v tabsh`) and use it
   in the hooks, so they don't depend on the hooks' `PATH`.
2. Set up hooks in its **user-level** config, keeping every existing hook
   and adding nothing twice, in whichever of these ways it supports:
   - **Command hooks that receive JSON on stdin:** run `<tabsh> hook` on
     each event in the mapping table that it has (by its own spelling).
   - **Plugins (OpenCode, Amp):** a small plugin that runs
     `<tabsh> hook running`, `needs-input` or `idle` on the matching
     events.
   - **A notification command only (Aider):** `<tabsh> hook idle`.
3. Use the prompt's definitions of the three states, with the rules above
   as examples: a permission prompt is `needs-input`, granting it returns to
   `running`, and a reminder after a turn ends changes nothing.
4. Follow its own rules for new hooks, and tell you about them. For
   example, Codex runs a hook you add only after you approve it in
   `/hooks`.
5. Say what it changed, and that the hooks do nothing outside tabsh.
6. Check its work: run `<tabsh> hook needs-input` in its own tab, then
   `<tabsh> hook idle`, so you see the dot appear and clear.

The prompt's text lives in one place, `web/src/app/agents/prompt.ts`, as a
pure module. A test pins every event name in the mapping table into it, so
the prompt and the Rust mapping can't drift apart unnoticed. The README points to the
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
- the mapping, through fixtures of real hook JSON: at least one event per
  state for each agent with command hooks, every spelling (PascalCase,
  camelCase, snake_case) and every event field, `idle_prompt` ignored, and
  unknown or malformed input sending nothing;
- the hook CLI exits 0 silently without `TABSH_SESSION` and with an
  unreachable daemon.

**App (`npm test`):**
- `activity-view.ts`, for every state, seen and unseen;
- `prompt.ts` names every event in the mapping table;
- the BEL rule: a BEL while `running` shows `needs-input`, while `idle` it
  shows nothing;
- `cleanSettings` keeps `agentPromptSeen` and defaults it to `false`.

**By hand:** on a fresh daemon, the dialog opens once and not after a
reload. Paste the prompt into Claude Code, Codex, Gemini CLI and OpenCode,
and check what each wrote to its config. Then, in a tabsh tab, run each,
ask
for something that needs a permission, switch tabs, and check spinner →
orange dot and badge → spinner → ✓.

**Unconfirmed in the docs, to check by hand:** the event field Copilot CLI
uses in camelCase mode, Kimi's notification types, whether Droid needs hooks
enabled, the field Kiro CLI uses, and the shape of Codex's `hooks.json`.
