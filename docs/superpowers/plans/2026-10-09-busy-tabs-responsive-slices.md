# Busy tabs stay responsive — Slice Plan

- Spec: `docs/superpowers/specs/2026-10-09-busy-tabs-responsive-design.md` (approach A approved 2026-10-09)
- Base SHA: `bd23536`
- Tracker: GitHub Issues, repo `Blaise1030/tabsh` — parent: [#71](https://github.com/Blaise1030/tabsh/issues/71)
- CI checks on PR: `.github/workflows/ci.yml` → `daemon`, `site`, `e2e`
- E2E: Playwright, specs in `web/e2e/`, run with `cd web && TABSH_BIN=../target/debug/tabsh npm run test:e2e`, conventions at `web/e2e/README.md`
- Conventions source: `CLAUDE.md` → `docs/architecture.md`; exemplars: `src/sessions/pty.rs`, `web/src/app/sessions/terminal.ts`

**Standing rules for every slice** (from the conventions source, not repeated below):

- Daemon: routes merge in `state::router()` only; `pub(crate)`/`pub(super)` visibility; tests in the owning file's `mod tests`.
- App: pure logic in its own file with a `*.test.ts` beside it when extracted; one-way dependency order; no `innerHTML`; CSP unchanged.
- Any slice touching `web/` runs `npm run build` in `web/` and commits `src/app.html` + `src/app-assets/`.
- Every slice's PR closes its tracker issue; main stays releasable after each merge.

## Slice 1: walking skeleton — inactive tabs stop painting into xterm

- Issue: [#72](https://github.com/Blaise1030/tabsh/issues/72)
- Depends on: none
- Flow (REQUIRED): With two tabs open, flood the inactive tab with output (e.g. a long `yes` / agent-style dump in that shell) while using the active tab → the active tab stays usable (focus, type, switch). The inactive tab shows unread. Activate the flooded tab → its terminal shows the caught-up output (via buffer flush or reconnect+replay) and accepts input.
- E2E spec (REQUIRED): `web/e2e/inactive-terminal-pause.spec.ts` —
  1. Open the app; create tabs A and B; keep A active.
  2. In B, start a high-volume printer that would previously keep the main thread busy (fixture-driven: write a large payload through the session or run a bounded flood command).
  3. While B floods, on A: type a marker command / switch to board and back / click A's terminal — interactions succeed within the suite's timeout (page does not wedge).
  4. Assert B's tab shows unread while inactive.
  5. Activate B → terminal content includes the flood (or post-replay content); typing in B works.
- Unit tests (REQUIRED):
  - App (`npm test`): pure pause/buffer policy (when paused, bytes enqueue; on activate flush or signal reconnect; cap exceeded → reconnect) in a DOM-free module beside `terminal.ts`.
  - Daemon: none required for this slice unless a reconnect path needs a small assert.
- Layers touched:
  - App: `web/src/app/sessions/terminal.ts`, `store.ts` (activate/deactivate hooks), new pure buffer/pause helper + test, possibly `bell-scan` wiring so unread/bell still update while paused.
  - Daemon: none for the minimal path (WS may stay open).
- Out of scope for this slice: rAF coalescing on the active tab (Slice 2); flush/DB (Slice 3); PTY lock (Slice 4); spawn_blocking (Slice 5).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 2: active tab coalesces bursty writes

- Issue: [#73](https://github.com/Blaise1030/tabsh/issues/73)
- Depends on: 1 (#72)
- Flow (REQUIRED): On the *active* tab, a burst of output is painted in coalesced frames → switching to another tab or opening the board during the burst still responds; after the burst settles, the active terminal shows the full output.
- E2E spec (REQUIRED): `web/e2e/active-terminal-coalesce.spec.ts` —
  1. One active tab; drive a short high-rate binary/text flood on its socket (or shell).
  2. During the flood, switch to another tab (or board) within timeout → navigation succeeds.
  3. Return to the flooded tab → content is complete (no permanent gaps vs a control run without coalesce, within scrollback).
- Unit tests (REQUIRED): coalesce helper — multiple chunks before rAF flush become one write; deactivate flushes pending; order preserved.
- Layers touched: app terminal write path + coalesce helper/test from Slice 1's module or sibling.
- Out of scope: daemon changes; inactive-path changes beyond what Slice 1 shipped.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 3: scrollback flush no longer hitches board and hooks

- Issue: [#74](https://github.com/Blaise1030/tabsh/issues/74)
- Depends on: none (independent of 1–2)
- Flow (REQUIRED): While several live sessions are dirty with large scrollback, a board status change or session list / `tabsh status` completes promptly → the UI or CLI is not blocked on the 2s flusher holding the DB across all scrollback copies.
- E2E spec (REQUIRED): `web/e2e/flush-under-load.spec.ts` —
  1. Create multiple sessions; produce dirty scrollback in each (daemon test harness or shell output).
  2. Trigger a board card status change (or equivalent API the page uses) during an imminent flush window.
  3. Assert the status update is visible / acknowledged within a tight timeout that would fail if flush held the DB for multi-hundred-ms copies serially on the request path.
  - If full browser timing is too flaky, pair with a daemon integration test that asserts flush lock ordering (see unit tests) and keep e2e as a lighter “status still works under concurrent output” check.
- Unit tests (REQUIRED):
  - Daemon (`cargo test`): `flush` does not hold `db` while locking `output` (or documents/tests the new collect-then-write order); concurrent `list_sessions` / status update can proceed while a large dirty scrollback is being copied out of `output`.
- Layers touched: `src/sessions/store.rs` (`flush`), possibly `main.rs` flusher thread; `PRAGMA busy_timeout` if needed; docs/architecture note only if behaviour is user-visible.
- Out of scope: PTY broadcast lock (Slice 4); spawn (Slice 5); client pause.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 4: busy PTY output does not stall attach/replay

- Issue: [#75](https://github.com/Blaise1030/tabsh/issues/75)
- Depends on: none (independent; pairs well after 3)
- Flow (REQUIRED): While a session's shell is printing heavily, a second client attach (or tab reload) receives replay and live output without a long freeze; the producer keeps running.
- E2E spec (REQUIRED): `web/e2e/attach-under-load.spec.ts` —
  1. Open a tab; start heavy output.
  2. Reload the app / reattach the same session while output continues.
  3. Terminal shows replay then live continuum; page remains interactive (second tab or board click succeeds during attach).
- Unit tests (REQUIRED): daemon — broadcast/send path does not hold `output` for the full history copy + send; attach history copy is bounded/tested for lock scope.
- Layers touched: `src/sessions/pty.rs` (reader loop), `src/sessions/ws.rs` (replay under lock).
- Out of scope: client coalesce; flush (Slice 3) except shared lock hygiene.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 5: opening tabs does not block other daemon work

- Issue: [#76](https://github.com/Blaise1030/tabsh/issues/76)
- Depends on: none
- Flow (REQUIRED): Opening or reattaching several tabs in quick succession → other requests (e.g. `/api/settings`, board events, or an already-open terminal's input) still complete; PTY spawn work runs off the async worker via `spawn_blocking` (or equivalent).
- E2E spec (REQUIRED): `web/e2e/spawn-under-load.spec.ts` —
  1. From the page, create several new tabs back-to-back.
  2. Interleave a settings round-trip or board open; assert it completes within timeout while spawns proceed.
  3. Each new tab's terminal becomes usable.
- Unit tests (REQUIRED): daemon — `get_or_spawn` / WS upgrade path uses blocking pool for pty spawn (test via hook/counter or by ensuring the async path doesn't call `openpty` directly — project-appropriate assert).
- Layers touched: `src/sessions/ws.rs`, `src/sessions/pty.rs` (`get_or_spawn` / `spawn_session`).
- Out of scope: client pause; flush internals beyond what's needed to avoid holding `live`+`db` during spawn.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Dependency sketch

```
1 ──► 2
3 (parallel)
4 (parallel)
5 (parallel)
```

Slices 3–5 can proceed in parallel with each other and with 1; Slice 2 follows 1. Parent closes only when all slices are done and a short regression pass (existing e2e + new specs) is green on `main`.
