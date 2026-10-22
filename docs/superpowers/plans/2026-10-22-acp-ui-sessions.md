# ACP UI sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new card start as a TUI (PTY) or UI (ACP chat) session, with the agent chosen in the existing New card provider dropdown and mode chosen beside it.

**Architecture:** The daemon owns an ACP client and transcript per UI card; the browser renders chat over guarded HTTP + SSE and never speaks ACP. TUI cards keep today's PTY path. UI and PTY refuse each other on the same card.

**Tech Stack:** Rust (axum, tokio process/stdio, serde_json, rusqlite), Solid + TypeScript in `web/src/app/`, Playwright e2e, existing settings/providers pattern.

**Spec:** `docs/superpowers/specs/2026-10-22-acp-ui-sessions-design.md`

## Global Constraints

- Every new route is merged only in `state::router()` and listed in `every_route_is_guarded`.
- No `innerHTML` in the app; CSP and token-in-fragment rules unchanged.
- URLs select only; creating/launching agents stays on existing board/create flows.
- Feature folders: daemon `src/chat/`, app `web/src/app/chat/`; `pub(crate)` across features.
- Browser never spawns ACP; demo never talks to a real agent.
- v1 ACP defaults: Cursor `cursor-agent acp` (fallback `agent acp`), OpenCode `opencode acp`, Claude `npx --yes @agentclientprotocol/claude-agent-acp`, Codex `npx --yes @agentclientprotocol/codex-acp`.
- Session `mode` is `tui` | `ui` only; default `tui`.
- Transcript path: `{tabsh_data_dir}/chats/{session_id}.jsonl` (append-only JSON lines).
- Chat stream transport: SSE on `GET /api/sessions/{id}/chat/stream`.

## Review Focus

- Card with `mode=ui` moved to In progress must not type a launch line into a PTY — Task 4 pins launch skip.
- Selected provider without `acp` must not offer UI (control disabled) — Task 5 + schema tests.
- Live PTY on a card rejects ACP start (and the reverse) with a clear error — Task 4.
- Mid-stream browser reconnect resumes via SSE without duplicating finished turns — Task 6.
- Auth/spawn failure surfaces an inline chat error, not a silent empty panel — Task 6/7.

## File map

| Path | Responsibility |
|---|---|
| `src/chat/mod.rs` | Feature root, `routes()`, `ChatManager` in `AppState` |
| `src/chat/acp.rs` | JSON-RPC stdio ACP client (initialize, session, prompt, cancel, permissions) |
| `src/chat/normalize.rs` | ACP events → `UiChunk` for transcript/SSE |
| `src/chat/transcript.rs` | Read/append jsonl under data dir |
| `src/chat/manager.rs` | Per-card ACP lifecycle, exclusion vs PTY |
| `src/chat/routes.rs` | HTTP: history, stream, message, stop, approve |
| `src/board/mod.rs` | `migrate` adds `mode`; launch skips PTY for `ui` |
| `src/sessions/mod.rs` + `store.rs` | `NewSession.mode`, `SessionInfo.mode` |
| `src/state.rs` | Merge chat routes; guard list; hold `ChatManager` |
| `web/src/app/settings/schema.ts` | `Provider.acp?: string`; defaults; clean |
| `web/src/app/board/new-card.tsx` | TUI\|UI control beside agent dropdown |
| `web/src/app/sessions/store.ts` | Pass `mode` on create; expose on card |
| `web/src/app/chat/*` | Panel, composer, stream client, parts render |
| `web/src/app/ui/app.tsx` | Mount chat when card `mode==='ui'` and agent tab on screen |
| `web/src/demo/daemon.ts` | Stub chat APIs |
| `docs/architecture.md` | Document `chat/` feature |

---

### Task 1: Persist `mode` on sessions

**Files:**
- Modify: `src/board/mod.rs` (`migrate`)
- Modify: `src/sessions/mod.rs` (`NewSession`, `SessionInfo`, `create_session`)
- Modify: `src/sessions/store.rs` (`NewCard`, `insert_card`, `info_row` / column list)
- Modify: `web/src/app/sessions/store.ts` (TS `SessionInfo` / create body)
- Test: `src/sessions/mod.rs` `mod tests`

**Interfaces:**
- Produces: `SessionInfo.mode: String` (`"tui"` \| `"ui"`); `POST /api/sessions` accepts optional `"mode"`; omitted → `"tui"`; invalid → 400.

- [ ] **Step 1: Write the failing test** `create_session_accepts_mode_ui` — POST `{cwd, mode:"ui"}` → 200 body `mode=="ui"` and DB column `mode` is `ui`. Also `create_session_rejects_unknown_mode` → 400.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q create_session_accepts_mode_ui create_session_rejects_unknown_mode`
Expected: FAIL (no `mode` field / compile or assertion)

- [ ] **Step 3: Implement migrate + create path**

Add migrate entry `("mode", "ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'tui'")`. Thread `mode` through `NewSession` / `NewCard` / `SessionInfo` / insert / info select. Validate only `tui`|`ui`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -q create_session_accepts_mode_ui create_session_rejects_unknown_mode`
Expected: PASS

- [ ] **Step 5: Update TS create/list types so `mode` round-trips** (compile-only / existing session tests still green)

- [ ] **Step 6: Commit**

```bash
git add src/board/mod.rs src/sessions/mod.rs src/sessions/store.rs web/src/app/sessions/store.ts
git commit -m "$(cat <<'EOF'
feat(sessions): persist tui|ui mode on cards

EOF
)"
```

---

### Task 2: Provider `acp` command in settings

**Files:**
- Modify: `web/src/app/settings/schema.ts`
- Modify: `web/src/app/settings/schema.test.ts`
- Modify: `docs/architecture.md` (providers bullet if present)

**Interfaces:**
- Produces: `Provider { name, command, resume, acp?: string }`; `cleanProviders` keeps optional non-empty `acp`; `DEFAULT_PROVIDERS` include ACP defaults from Global Constraints (Cursor/OpenCode/Claude/Codex; keep OpenCode in defaults if UI mode needs it — add OpenCode back to `DEFAULT_PROVIDERS` with `command`/`resume`/`acp` if absent).

- [ ] **Step 1: Write failing tests** in `schema.test.ts`: default Cursor entry has `acp` containing `acp`; cleaning strips empty `acp: ""`; unknown extra field ignored.

- [ ] **Step 2: Run** `node --test web/src/app/settings/schema.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement `acp` on `Provider` + defaults + `cleanProviders`

- [ ] **Step 4: Run** same test — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/settings/schema.ts web/src/app/settings/schema.test.ts docs/architecture.md
git commit -m "$(cat <<'EOF'
feat(settings): optional ACP command per agent provider

EOF
)"
```

---

### Task 3: ACP client + fake agent

**Files:**
- Create: `src/chat/mod.rs`, `src/chat/acp.rs`, `src/chat/normalize.rs`
- Create: `tests/fixtures/acp/fake_agent.rs` or `src/chat/fake_agent.rs` (test-only binary/helper)
- Modify: `src/main.rs` (`mod chat;`)
- Modify: `Cargo.toml` if tokio process features needed (`process`, `io-util`)
- Test: `src/chat/acp.rs` `mod tests`

**Interfaces:**
- Produces:
  - `AcpClient::spawn(cmd: &str, args: &[String], cwd: &Path) -> Result<AcpClient>`
  - `async fn initialize(&mut self) -> Result<InitializeResult>`
  - `async fn session_new(&mut self, cwd: &Path) -> Result<String>` // session id
  - `async fn prompt(&mut self, session_id: &str, text: &str) -> Result<()>`
  - `async fn cancel(&mut self, session_id: &str) -> Result<()>`
  - `fn event_stream(&mut self) -> impl Stream<Item = AcpEvent>` (or channel)
  - `normalize::to_chunks(ev: &AcpEvent) -> Vec<UiChunk>`
  - `UiChunk` serde type with at least `{ type, ... }` suitable for SSE `data:` lines (AI-SDK-like or thin tabsh shape; pick one and keep stable)

Use newline-delimited JSON-RPC 2.0 on stdio. Implement only methods the fake agent and v1 UI need: `initialize`, `session/new`, `session/prompt`, `session/cancel`, and server→client `session/update` notifications. Permission: `session/request_permission` → later task can answer; for this task, auto-allow in client or record pending.

- [ ] **Step 1: Write failing test** `acp_client_prompt_receives_session_update` — spawn fake agent, initialize, session/new, prompt `"hi"`, expect at least one agent message chunk then stop.

- [ ] **Step 2: Run** `cargo test -q acp_client_prompt_receives_session_update` — Expected: FAIL

- [ ] **Step 3: Implement fake agent + `AcpClient` + minimal `normalize`

- [ ] **Step 4: Run** same test — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat Cargo.toml src/main.rs
git commit -m "$(cat <<'EOF'
feat(chat): ACP stdio client with fake agent tests

EOF
)"
```

---

### Task 4: ChatManager, routes, launch skip, mutual exclusion

**Files:**
- Create: `src/chat/manager.rs`, `src/chat/transcript.rs`, `src/chat/routes.rs`
- Modify: `src/chat/mod.rs` (`routes()`)
- Modify: `src/state.rs` (`AppState.chats`, merge routes, `guarded_routes`)
- Modify: `src/board/mod.rs` / `src/sessions` launch path — **do not** call PTY launch when `mode=="ui"`; instead `ChatManager::ensure_started`
- Modify: PTY start path to refuse if chat live for that card
- Test: `src/chat/routes.rs` or `manager.rs` `mod tests`

**Interfaces:**
- Produces routes (all guarded):
  - `GET  /api/sessions/{id}/chat` → `{ messages: UiChunk[] }` (assembled transcript)
  - `GET  /api/sessions/{id}/chat/stream` → SSE of new `UiChunk`s (replay buffer for reconnect)
  - `POST /api/sessions/{id}/chat/message` body `{ text: string }` → 202 or 200
  - `POST /api/sessions/{id}/chat/stop` → 204
  - `POST /api/sessions/{id}/chat/approve` body `{ requestId, allow: bool }` → 204 (stub OK if permissions not yet wired)
- `ChatManager::start(session_id, provider_acp_cmd, cwd, initial_prompt)`
- `ChatManager::is_live(session_id) -> bool`
- Exclusion: starting chat while agent PTY running for card → 409; starting agent PTY launch while chat live → 409
- UI launch on status→in_progress: starts ACP with `pending_prompt`, never types launch line

- [ ] **Step 1: Write failing tests**
  - `chat_message_round_trip_with_fake_acp`
  - `ui_card_in_progress_does_not_open_pty`
  - `chat_start_conflicts_with_live_pty` (and reverse)

- [ ] **Step 2: Run** those tests — Expected: FAIL

- [ ] **Step 3: Implement manager, transcript, routes, launch branch, exclusion, wire `AppState`

Pass ACP argv from card's `pending_command` provider mapping: resolve provider by matching `agent_command` / stored command to settings is app-side; daemon should receive ACP argv on start — **lock:** store `acp_command` on the session at create time (nullable text column) OR pass in message start. Prefer migrate `acp_command TEXT` set on create from the app (mirrors `pending_command`). Add in this task if not done in Task 1.

- [ ] **Step 4: Run tests** — Expected: PASS; also `cargo test -q every_route_is_guarded` PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat src/state.rs src/board/mod.rs src/sessions docs/architecture.md
git commit -m "$(cat <<'EOF'
feat(chat): ACP session manager, SSE routes, UI launch without PTY

EOF
)"
```

---

### Task 5: New card — mode beside agent dropdown

**Files:**
- Modify: `web/src/app/board/new-card.tsx`
- Modify: `web/src/app/sessions/store.ts` (`openTab` body includes `mode`, `acp_command`)
- Modify: `web/src/app/settings/schema.ts` if last-used `agentMode` wanted (`agentMode?: 'tui'|'ui'`)
- Test: unit for pure helper if extracted; e2e in Task 8

**Interfaces:**
- Produces: New card footer shows agent provider dropdown (unchanged) and **TUI | UI** control beside it. UI disabled when `!provider.acp`. Submit sends `mode` and `acp_command: provider.acp` (UI) or omits acp for TUI.

- [ ] **Step 1: Write failing unit test** for helper `canUseUi(provider) => boolean` / mode payload builder

- [ ] **Step 2: Run** `node --test …` — Expected: FAIL

- [ ] **Step 3: Implement control + wire `openTab`

- [ ] **Step 4: Run** unit test — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/board/new-card.tsx web/src/app/sessions/store.ts web/src/app/settings/schema.ts
git commit -m "$(cat <<'EOF'
feat(board): TUI|UI mode beside New card agent provider

EOF
)"
```

---

### Task 6: Chat panel + SSE client in workspace

**Files:**
- Create: `web/src/app/chat/panel.tsx`, `web/src/app/chat/client.ts`, `web/src/app/chat/composer.tsx`, `web/src/app/chat/parts.tsx`
- Modify: `web/src/app/ui/app.tsx` — when on-screen card has `mode==='ui'` and `place.term` is null, render chat panel instead of that card's `TermHost`; side terminals unchanged
- Modify: `web/src/styles/app.css` — minimal chat layout (column: transcript + composer, soft edge)
- Test: `web/src/app/chat/*.test.ts` for client event parse; Playwright in Task 8

**Interfaces:**
- Consumes: Task 4 routes
- Produces: `ChatPanel` props `{ sessionId }`; composer posts message; panel subscribes to SSE; shows spawn/auth errors from stream

- [ ] **Step 1: Write failing test** for SSE/chunk parse helper

- [ ] **Step 2: Run** — Expected: FAIL

- [ ] **Step 3: Implement client + panel + composer + workspace mount**

Composer v1 may be a footer in the same column (seamless polish can follow); no hard visual “card” chrome beyond existing workspace.

- [ ] **Step 4: Run** unit tests — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/chat web/src/app/ui/app.tsx web/src/styles/app.css
git commit -m "$(cat <<'EOF'
feat(web): ACP chat panel for UI-mode cards

EOF
)"
```

---

### Task 7: Stop, permissions stub, board status mapping

**Files:**
- Modify: `src/chat/acp.rs`, `manager.rs`, `routes.rs`
- Modify: board status hooks path as needed when ACP turn ends without CLI hooks
- Test: daemon tests for stop + approve

**Interfaces:**
- `POST …/chat/stop` cancels ACP turn; composer unlocks
- `session/request_permission` → SSE chunk type `permission` with `requestId`; `POST …/approve` answers
- When turn completes cleanly and no hook fired, set status `completed` (or leave in progress if agent stays interactive — **lock:** map idle after turn to `needs_input` if waiting for user, `completed` only on session end notification if ACP provides it; otherwise keep `in_progress` and rely on hooks when present)

- [ ] **Step 1: Failing tests** for stop and approve round-trip with fake agent

- [ ] **Step 2: Run** — FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run** — PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat
git commit -m "$(cat <<'EOF'
feat(chat): stop, permission approve, status mapping hooks

EOF
)"
```

---

### Task 8: Demo stubs + Playwright smoke + architecture

**Files:**
- Modify: `web/src/demo/daemon.ts`
- Create/modify: `web/e2e/chat-ui.spec.ts` (or extend `board.spec.ts`)
- Modify: `docs/architecture.md` (chat feature row, app folder, dependency order)
- Modify: `src/state.rs` guard list if any route still missing

**Interfaces:**
- Demo: scripted history + SSE that emits a short assistant reply on message
- E2E: onboard → New card → select provider with acp → UI → create In progress → chat composer visible (daemon with fake ACP via `TABSH_CHAT_ACP` env pointing at fake binary built from test helper, or demo-only path). Prefer e2e against real daemon + `fake_agent` binary on `PATH` via env `TABSH_TEST_ACP=1` override of acp_command for the created card.

- [ ] **Step 1: Write Playwright smoke** that creates UI card and sees chat composer (`getByTestId('chat-composer')`)

- [ ] **Step 2: Run** e2e — Expected: FAIL

- [ ] **Step 3: Demo stubs + fake ACP wiring for e2e + architecture.md**

- [ ] **Step 4: Run** e2e smoke + `cargo test -q every_route_is_guarded` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/demo/daemon.ts web/e2e docs/architecture.md src/state.rs
git commit -m "$(cat <<'EOF'
test(chat): demo stubs and UI-session Playwright smoke

EOF
)"
```

---

## Self-review notes (author)

- Spec coverage: mode at New card provider row, ACP providers, daemon client, exclusion, errors, demo, tests, rollout order → tasks 1–8.
- Open plan points from spec resolved: SSE; jsonl transcript; hand-rolled ACP client; side terminals stay PTY on UI cards.
- `acp_command` column added in Task 4 so daemon does not depend on browser settings at launch.
