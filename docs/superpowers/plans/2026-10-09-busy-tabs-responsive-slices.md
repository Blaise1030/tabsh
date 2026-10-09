# Busy tabs stay responsive — Slice Plan

- Spec: `docs/superpowers/specs/2026-10-09-busy-tabs-responsive-design.md` (approach A approved 2026-10-09)
- Base SHA: `bd23536` (re-based 2026-10-09 on `ae92dd2`; feature branch `features/busy-tabs-responsive`)
- Tracker: GitHub Issues, repo `Blaise1030/tabsh` — parent: [#71](https://github.com/Blaise1030/tabsh/issues/71)
- CI checks on PR: `.github/workflows/ci.yml` → `daemon`, `site`, `e2e`
- E2E: Playwright, specs in `web/e2e/`, run with `cd web && TABSH_BIN=../target/debug/tabsh npm run test:e2e`, conventions at `web/e2e/README.md`
- Conventions source: `CLAUDE.md` → `docs/architecture.md`; exemplars: `src/sessions/pty.rs`, `web/src/app/sessions/terminal.ts`

**Standing rules for every slice** (from the conventions source, not repeated below):

- Daemon: routes merge in `state::router()` only; `pub(crate)`/`pub(super)` visibility; tests in the owning file's `mod tests`.
- App: pure logic in its own file with a `*.test.ts` beside it when extracted; one-way dependency order; no `innerHTML`; CSP unchanged.
- Any slice touching `web/` runs `npm run build` in `web/` and commits `src/app.html` + `src/app-assets/`.
- Every slice's PR closes its tracker issue; main stays releasable after each merge.

## Slice 1: walking skeleton — parked tabs still show unread and ring

> Re-scoped 2026-10-09: `main` now parks every off-screen terminal's socket (`f9eaaf9`, `738d27e`), so inactive tabs already stop painting. Parked tabs therefore get no output, and unread/bell (set from socket messages in `terminal.ts`) silently stopped working for them. This slice restores that signal cheaply.

- Issue: [#72](https://github.com/Blaise1030/tabsh/issues/72)
- Depends on: none
- Flow (REQUIRED): With two tabs open, flood the inactive (parked) tab with output while using the active tab → the active tab stays usable (focus, type, switch). The inactive tab shows unread; a BEL printed in it rings that tab as before. Activate the flooded tab → it reconnects, replay shows the caught-up output, unread clears, and it accepts input.
- E2E spec (REQUIRED): `web/e2e/inactive-terminal-pause.spec.ts` —
  1. Open the app; create tabs A and B; keep A active (B is parked).
  2. Make B print a large bounded flood plus a BEL (e.g. via the session's shell started before switching away, or `tabsh`/daemon API the fixtures already use).
  3. While B floods, on A: type a marker command / switch to board and back — interactions succeed within the suite's timeout.
  4. Assert B's tab shows unread (and the bell mark, if the tab chrome shows one) while parked.
  5. Activate B → terminal content includes the flood tail; unread clears; typing in B works.
- Unit tests (REQUIRED):
  - Daemon (`cargo test`): activity throttle — many output chunks within the window publish one activity event; a chunk with a bare BEL publishes a bell event immediately; a BEL inside an OSC sequence (e.g. title set terminated by BEL) does not.
  - App (`npm test`): pure handler deciding what an activity/bell event does to a session (parked & not active → unread / ring; active → nothing; closed/unknown → nothing), DOM-free beside its caller.
- Layers touched:
  - Daemon: `src/sessions/pty.rs` (reader loop publishes on `st.events`), `src/board/` event type (additive variant), tests.
  - App: `web/src/app/board/events.ts` (or sessions) dispatching activity/bell to sessions; small pure helper + test; `terminal.ts` untouched beyond what's needed.
- Out of scope for this slice: rAF coalescing on the active tab (Slice 2); flush/DB (Slice 3); PTY lock scope (Slice 4) — keep the publish outside the `output` lock or trivially cheap; spawn_blocking (Slice 5).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 2: active tab coalesces bursty writes

- Issue: [#73](https://github.com/Blaise1030/tabsh/issues/73)
- Depends on: none (re-scoped Slice 1 no longer provides a client buffer module; this slice owns its helper)
- Flow (REQUIRED): On the *active* tab, a burst of output is painted in coalesced frames → switching to another tab or opening the board during the burst still responds; after the burst settles, the active terminal shows the full output.
- E2E spec (REQUIRED): `web/e2e/active-terminal-coalesce.spec.ts` —
  1. One active tab; drive a short high-rate text flood in its shell.
  2. During the flood, switch to another tab (or board) within timeout → navigation succeeds.
  3. Return to the flooded tab → content is complete (tail of the flood present, within scrollback).
- Unit tests (REQUIRED): coalesce helper — multiple chunks before the frame flush become one write; park/close flushes or drops pending correctly; order preserved; replay path is not coalesced in a way that breaks `parsingReplay`.
- Layers touched: app terminal write path in `web/src/app/sessions/terminal.ts` + new pure coalesce helper and test beside it.
- Out of scope: daemon changes; parking/unread behaviour (Slice 1).
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
1, 2, 3, 4, 5 — all independent
```

All slices can proceed in parallel. Expected overlaps: 1, 4 and 5 touch `src/sessions/pty.rs`; 4 and 5 touch `src/sessions/ws.rs`; 1 and 2 touch the app's sessions code. Whichever merges second rebases onto `features/busy-tabs-responsive`. Parent closes only when all slices are done and a short regression pass (existing e2e + new specs) is green on `main`.
