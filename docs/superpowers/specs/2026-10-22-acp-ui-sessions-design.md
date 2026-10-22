# ACP UI sessions: chat alternative to the agent TUI

Status: approved design, 2026-10-22.

## Intent

**Who and when:** you, running coding agents on the tabsh board, wanting a
web chat surface instead of (or as well as) the agent's own TUI in a PTY.

**Success looks like:** creating a card offers **TUI** or **UI**. A UI
session shows a seamless chat thread and composer (no hard boundary between
transcript and input). The daemon drives the agent over the Agent Client
Protocol (ACP). Usage still bills to each agent's normal subscription or
API key. A TUI session keeps today's PTY + xterm path.

**Out of scope (v1):**
- Multiplayer / Zed-style collaboration
- Replacing the board or `tabsh status` hooks
- Scraping or driving agent TUIs from the PTY
- Codex `app-server` or `code-mode-host` as the primary chat protocol
- A full permissions/policy editor (only minimal in-thread approve/deny)
- Switching an existing card between TUI and UI mid-flight (chosen at create)

**Constraints:**
- Same token guard, CSP, and remote-device rules as every other route.
- Feature-folder layout: daemon `chat/` (or equivalent) with `routes()`,
  app `web/src/app/chat/`; no global store; place changes only via `nav`.
- One active agent surface per card: UI (ACP) and TUI (PTY) refuse each
  other while the other is live.
- Browser never speaks ACP; only the daemon does.
- Demo must stub chat without a real agent.

## Decisions

| Question | Choice |
|---|---|
| UI transport to agents | ACP (JSON-RPC over stdio) |
| Alternative rejected for v1 primary | Per-CLI headless JSON translators (cms/orso style); keep as future fallback if needed |
| Session modes | `tui` \| `ui`, chosen on the New card dialog |
| Where agent is picked | Existing New card **agent provider** dropdown (Claude Code, Codex, Cursor CLI, opencode, …) — same chip as today |
| Where mode is picked | Same New card footer row as that provider chip: **TUI** \| **UI** |
| v1 providers | Cursor + OpenCode native ACP; Claude + Codex via ACP adapters |
| Composer UX | In-flow with the transcript (Zed-like); soft footer OK if polish lands later |
| Process model | One long-lived ACP agent process per UI card (not one CLI per turn) |
| Billing | Unchanged: agent's own subscription / API |

Rejected as v1 primary: cms-style `stream-json` / `codex exec --json` only
(higher per-agent translator churn; fine later as fallback), and Codex
app-server alone (Codex-specific, not multi-provider).

## 1. What you see

**New card.** The agent is chosen in the existing provider dropdown (the
chip that lists Claude Code, Codex, Cursor CLI, opencode, …). In that same
footer row, add mode **TUI** | **UI** (not a separate settings screen, not
a second agent list).
- **TUI** (default for existing muscle memory): today's launch into a PTY
  with that provider's startup command.
- **UI**: same provider, but the card opens on the chat surface and the
  daemon starts that provider's ACP command; no xterm for the agent tab.
  Side terminals (`+`) still available as PTYs under the card.
- If the selected provider has no ACP command configured, **UI** is
  disabled (or hidden) with a short reason; **TUI** remains available.

**UI workspace.** Same card chrome (session bar, file pane, drawer) with
the agent pane replaced by:
- Scrollable transcript (markdown, tool/trace steps, errors, approvals)
- Composer in the same column (no heavy divider); streaming indicator can
  float above the input
- Stop / interrupt while a turn runs

**TUI workspace.** Unchanged xterm attach.

**Board.** Cards still move through backlog → in progress → needs input →
completed → archived. Status prefers existing hooks when the agent fires
them under ACP; otherwise the daemon maps ACP idle / needs-input /
finished onto board status so the kanban does not go dark.

## 2. Architecture

```text
Browser (Solid chat UI)
    ↕ HTTP + SSE (or WS), guarded
Daemon chat feature (ACP client + transcript)
    ↕ stdio JSON-RPC (ACP)
Agent (cursor-agent acp | opencode acp | claude-acp | codex-acp)
```

## 3. The daemon

**Feature folder.** `src/chat/` (name may be `acp/` if clearer at
implement time) with `routes()` merged only in `state::router()`, listed
in `every_route_is_guarded`.

**Pieces:**
- **Provider ACP map** — built-in defaults, overridable like agent
  providers in settings:

  | Provider | ACP command (default) |
  |---|---|
  | Cursor CLI | `cursor-agent acp` (or `agent acp`) |
  | OpenCode | `opencode acp` |
  | Claude Code | `npx @agentclientprotocol/claude-agent-acp` |
  | Codex | `npx @agentclientprotocol/codex-acp` |

  UI mode is offered only when an ACP command is configured for that
  provider.

- **AcpClient** — spawn, `initialize`, session new/load, prompt, cancel /
  interrupt, permission callbacks, clean shutdown.
- **ChatManager** — at most one live ACP session per card; start refused
  if that card has a live agent PTY (and `Terminal`/session start refused
  while ACP is live).
- **Transcript** — append-only history for reload/resume (SQLite column(s)
  or state-dir jsonl; implementation picks one store, not both).

**HTTP (illustrative; exact paths in the plan):**
- History / resume stream for a card's UI session
- Post user message (and optional attachments later)
- Stop / interrupt
- Respond to an in-thread approval

All behind the existing guard. URLs select only; they do not start agents
by themselves beyond today's board launch rules.

**Launch.** A card created with `mode=ui` and moved to In progress (or
created there) starts the ACP process with cwd = card folder, env still
including `TABSH_SESSION_ID` / `TABSH_URL` when useful for hooks. Initial
prompt from `pending_prompt` is the first ACP prompt, not a PTY type-in.

**Resume.** After daemon restart, if the agent advertised `loadSession` and
we stored its session id, reconnect; else start fresh and keep transcript
as read-only history above a new session (plan picks the exact UX).

## 4. The app

**Folder.** `web/src/app/chat/` — panel, composer, message/parts rendering,
client for chat routes. Wired from the workspace when the open card's mode
is `ui`.

**New card.** Extend `new-card`: keep the current agent provider dropdown
as the selector; add the TUI|UI control beside it. Create payload includes
`mode` plus the chosen provider (as today). Settings/schema may persist
last-used mode. Per-provider ACP command overrides live with the existing
agent provider settings in the palette — selection at create time stays on
this New card chip.

**Place / nav.** Prefer a place field or session flag so deep links open
the UI surface (e.g. no forced `term=` to xterm for UI cards). Exact shape
in the plan; must stay select-only.

**Demo.** `demo/daemon.ts` answers chat routes with a scripted stream so
`/demo/` never spawns real agents.

## 5. Data flow

**UI send:**
1. Composer → `POST` message for the card
2. Daemon appends user message → ACP prompt
3. Agent events → normalized UI chunks → transcript + SSE/WS to browser
4. Turn end → board status via hooks and/or ACP-derived mapping

**TUI:** unchanged PTY launch + xterm.

## 6. Errors

| Case | Behavior |
|---|---|
| ACP binary missing / spawn fail | Inline error; hint install or switch to TUI |
| Auth / not logged in | Inline error; login via that agent's own CLI/TUI |
| Protocol / version reject | Incompatible-agent message; keep transcript |
| Process death mid-turn | Failed turn; retry/resume if `loadSession` allows |
| Permission request | Minimal in-thread approve/deny over ACP |
| User stop | Cancel/interrupt; composer re-enabled |
| UI ↔ TUI conflict | Refuse (409-style); one mode active per card |

## 7. Testing

- **Rust:** fake ACP agent over stdio — handshake, prompt, stream, cancel,
  auth-fail, mutual exclusion with PTY
- **Normalize:** fixture ACP events → UI chunks
- **App:** mode on new card, send, stream render (unit + Playwright smoke)
- **Demo:** stubbed stream
- **Guard:** new routes pinned in `every_route_is_guarded`
- **Not in CI:** live cloud calls to Cursor/Claude/Codex/OpenCode

## 8. Rollout

1. Daemon ACP client + fake agent tests + guarded routes
2. Transcript + stream to a minimal chat panel (composer can be footer)
3. New-card mode + provider ACP defaults (Cursor, OpenCode first)
4. Claude/Codex adapter commands wired
5. Composer polish toward seamless in-flow
6. Board status mapping gaps closed where hooks do not fire under ACP

## 9. Open points for the plan (not blockers for this spec)

- SSE vs WebSocket for the chat stream (either is fine if reconnect works)
- Transcript storage: SQLite vs jsonl under `~/.tabsh`
- Exact ACP method names / crate vs hand-rolled client (follow current ACP
  version at implement time)
- Whether side terminals are enabled on UI cards in v1 (default: yes, as
  PTYs; agent tab stays chat)
