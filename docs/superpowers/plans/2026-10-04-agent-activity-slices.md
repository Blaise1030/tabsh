# Agent activity — Slice Plan

- Spec: `docs/superpowers/specs/2026-10-04-agent-activity-design.md` (approved 2026-10-04)
- Base SHA: `f9f0622` (tip of `refactor/modules`, merged to `main` before Slice 0 starts — see Prerequisite)
- Tracker: GitHub Issues, repo `Blaise1030/tabsh` — parent: [#10](https://github.com/Blaise1030/tabsh/issues/10)
- CI checks on PR: `.github/workflows/ci.yml` → `daemon` (fmt, clippy, `cargo test --locked` on ubuntu + macos), `site` (`astro check`, biome, `npm test`, `npm run build` + committed app copy), and (added by Slice 0) `e2e` (Playwright chromium)
- E2E: Playwright (`@playwright/test`), specs in `web/e2e/`, run with `cd web && TABSH_BIN=../target/debug/tabsh npm run test:e2e`, conventions doc at `web/e2e/README.md` (written by Slice 0)
- Conventions source: `CLAUDE.md` → `docs/architecture.md` (module layout, route rules, dependency order, pure-logic testability); exemplars: `src/sessions/` (daemon feature), `web/src/app/sessions/bell.ts` + `bell-scan.ts` (app feature with pure logic)

**Standing rules for every slice** (from the conventions source, not repeated below):

- Daemon: routes merge in `state::router()` only; add each route to `every_route_is_guarded`; `pub(crate)`/`pub(super)` visibility; tests live in the owning file's `mod tests`.
- App: pure logic in its own file with a `*.test.ts` beside it, importable without touching the DOM; one-way dependency order (`daemon → settings → … → sessions → palette/ui → main`); no inline scripts (CSP).
- Any slice touching `web/` runs `npm run build` in `web/` and commits `src/app.html` + `src/app-assets/` (the e2e drives the daemon's embedded copy of the app, so it must be current).
- Every slice's PR closes its tracker issue; main stays releasable after each merge.

## Prerequisite: land the base

- `refactor/modules` (`f9f0622`) holds the approved spec and this plan but `origin/main` (`af93bac`) doesn't. Open PR `refactor/modules` → `main`, merge it. Slice 0 branches from the resulting `main`. Not a slice: no product flow, no issue beyond the PR itself.

## Slice 0: e2e harness — CI proves the real app in a real browser

- Issue: [#11](https://github.com/Blaise1030/tabsh/issues/11)
- Depends on: Prerequisite
- Flow (REQUIRED): A contributor opens a PR → CI runs a smoke e2e that starts a real daemon, opens the real app page in chromium, creates a tab, types into the terminal, and sees the tab renamed — proving the whole loop (page → daemon → PTY → page) before any feature work lands.
- E2E spec (REQUIRED): `web/e2e/smoke.spec.ts` —
  1. Harness (global fixture) builds/locates the daemon binary (`TABSH_BIN`, default `../target/debug/tabsh`), starts it with `TABSH_DB` in a temp dir on a free port, waits for `listening`.
  2. Test reads the pairing token from `<state dir>/token`, opens `http://127.0.0.1:<port>/app/#token=<token>`, waits for the tab strip.
  3. Creates a tab, clicks the terminal, types `printf '\033]0;smoke-test\007'`.
  4. Asserts the tab's label becomes `smoke-test` (real DOM; xterm's canvas is not assertable — see conventions doc).
- Unit tests (REQUIRED): none new (harness only); `npm test` and `cargo test --locked` stay green untouched.
- Layers touched: `web/package.json` (`@playwright/test` dev-dependency, `test:e2e` script), new `web/playwright.config.ts`, new `web/e2e/` (fixture + `smoke.spec.ts` + `README.md`), `.github/workflows/ci.yml` (new `e2e` job: checkout, rust toolchain, `cargo build --locked`, node 24, `npm ci`, `npx playwright install --with-deps chromium`, run with `TABSH_BIN`).
- `web/e2e/README.md` (the conventions doc) must cover: how the daemon fixture works (temp state dir, free port, token file, cleanup), the auth fixture (open `/app/#token=…`), selector rules (element IDs and existing classes in `web/src/pages/app/index.astro`; never canvas pixels; drive output assertions through DOM effects — tab name via title escape, tab classes, `document.title`, favicon `href`), typing into xterm (click terminal, `keyboard.type`), and the run command.
- Out of scope for this slice: any activity/hook behaviour (Slice 1+); parallelising workers; macos e2e in CI (chromium on ubuntu only).
- Done when: e2e + existing suites pass locally, all CI checks green including the new `e2e` job, PR closes the issue.

## Slice 1: walking skeleton — `tabsh hook <state>` shows the agent's state on its tab

- Issue: `<filled in Phase 3>`
- Depends on: 0
- Flow (REQUIRED): In a tabsh tab you run `tabsh hook running`, then `tabsh hook needs-input`, then `tabsh hook idle` → the tab strip shows a spinner, then an orange dot (and the favicon + title get badged while you're elsewhere), then a ✓ "done" that clears when you visit the tab. This is the thinnest full path: env vars → CLI → route → daemon state → WebSocket → page, and it creates the types/shape (`Event::Activity`, `{"activity":"…"}` frame, activity-view states) that every later slice extends.
- E2E spec (REQUIRED): `web/e2e/hook-state.spec.ts` —
  1. Open the app (fixture), create two tabs; keep tab A active.
  2. In tab B (click it, type): `tabsh hook running` → B's tab element gets the running marker (spinner).
  3. `tabsh hook needs-input` → B shows the orange-dot marker; `document.title` starts with 🔔; favicon href is the badged one.
  4. Click tab B (visit it, page focused) → dot still shown (needs-input clears on the agent moving on, not on visiting); `document.title` no longer badged.
  5. `tabsh hook running` → spinner again, badge gone; `tabsh hook idle` → ✓ done marker; switch to A and back to B → ✓ cleared.
  6. `tabsh hook needs-input` in the *active* tab while the page is focused → no badge on title/favicon (only the dot).
- Unit tests (REQUIRED):
  - Daemon (`cargo test`): route returns 204 on set, 404 unknown session, 400 malformed body/unknown state; without Origin and no token → 401; foreign Origin → 403; `every_route_is_guarded` lists the route; setting the same state twice broadcasts `Event::Activity` once; ws attach sends the current state right after the history (only when not `idle`); hook CLI exits 0 silently without `TABSH_SESSION` and with an unreachable `TABSH_URL`.
  - App (`npm test`): `activity-view.test.ts` — for every state × tab seen/unseen × page focused/hidden: which tab marker, whether the favicon/title badge is on, what clears it.
- Layers touched:
  - Daemon: `src/sessions/pty.rs` (set `TABSH_SESSION`, `TABSH_URL`, `TABSH_TOKEN_FILE` on spawned shells; `TABSH_URL` from the bound address), `src/main.rs` (argument split: no subcommand or a port → daemon as today; `hook` → CLI), new `src/cli/mod.rs` + `src/cli/hook.rs` (`<state>` mode: token from `TABSH_TOKEN_FILE`, `Authorization: Bearer`, minimal HTTP/1.1 POST over `TcpStream` to `TABSH_URL`'s host/port, 1s overall timeout, swallows every error, prints nothing, always exits 0), `src/sessions/mod.rs` (`POST /api/sessions/{id}/activity` route; `Session.activity: Activity` in-memory, starts `Idle`; set broadcasts on change only), `src/sessions/ws.rs` (forward `Event::Activity` as `{"activity":"…"}`; send current state after replayed history on attach when not idle), `src/web/guard.rs` (`admits_without_origin`: the activity route needs the token without an Origin, like `/api/files*`), `src/state.rs` (route list), `docs/architecture.md` (security-invariant bullet names the activity route; module table gets `cli/`).
  - App: new `web/src/app/sessions/activity.ts` (frame handling, wiring into `store`/`terminal.ts`), new `web/src/app/sessions/activity-view.ts` (pure: state + seen/focused → markers/badges/clears) + test, `web/src/app/sessions/store.ts` (`Session.activity`), `web/src/app/sessions/bell.ts` (`updateBadge` counts needs-input tabs as well as ringing ones), `web/src/app/sessions/tabs.ts`/`terminal.ts` (render/clear markers), `web/src/styles/app.css` (spinner — `prefers-reduced-motion` gets a static marker; dot; ✓), `web/src/pages/app/index.astro` only if markup is needed.
- Out of scope for this slice: stdin JSON mapping (`tabsh hook` with no argument — Slice 2); the BEL rule (Slice 3); foreground/crash recovery (Slice 4); the setup prompt/dialog (Slice 5); `PostToolUse`-style transitions beyond what `<state>` commands show.
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 2: `tabsh hook` maps agent hook JSON from stdin

- Issue: [#13](https://github.com/Blaise1030/tabsh/issues/13)
- Depends on: 0, 1
- Flow (REQUIRED): An agent with command hooks runs `tabsh hook` with its hook JSON on stdin (no argument) → the event is recognised wherever the field is (`hook_event_name`, `event`, `hookName`, `agent_action_name`) and however it's spelled (`PreToolUse`/`preToolUse`/`pre_tool_use`) → the tab shows the mapped state: `PreToolUse` → spinner, `Notification` of `permission_prompt` → orange dot, `Stop` → ✓; unknown events and unparseable input send nothing.
- E2E spec (REQUIRED): `web/e2e/hook-mapping.spec.ts` —
  1. In a tab: `echo '{"hook_event_name":"PreToolUse","tool_name":"Bash"}' | tabsh hook` → spinner.
  2. `echo '{"event":"Notification","notification_type":"permission_prompt"}' | tabsh hook` → orange dot (Goose-style `event` field).
  3. `echo '{"hook_event_name":"Notification","type":"ToolPermission"}' | tabsh hook` → still the dot (alternate type field/spelling).
  4. `echo '{"hook_event_name":"Stop"}' | tabsh hook` → ✓ done.
  5. `echo '{"hook_event_name":"Notification","notification_type":"idle_prompt"}' | tabsh hook` while ✓ is showing → ✓ stays (idle_prompt ignored).
  6. `echo 'not json' | tabsh hook` → whatever state is showing stays; nothing changes; exit is silent and 0 (`echo $?` → 0).
- Unit tests (REQUIRED): the mapping as a pure function in `src/cli/hook.rs`, driven by fixtures of real hook JSON: at least one event per state for each agent with command hooks (Claude Code, Codex, Gemini CLI, Copilot CLI both modes, Qwen Code, Factory Droid, Continue `cn`, Kimi, Goose, Augment Auggie, Crush, Kiro CLI's candidate fields); every spelling (PascalCase, camelCase, snake_case) and every event field; `Notification` type from `notification_type` and `type`; `idle_prompt` ignored; subagent events ignored (fall through to no request); unknown or malformed input → no request.
- Layers touched: `src/cli/hook.rs` (stdin reading when no argument; event-field resolution, name/type normalisation ignoring case and `_`, mapping table — all as pure functions; still 1s overall timeout, silent, exit 0), its `mod tests` with fixtures (e.g. `tests/hook-json/*.json` beside it as `include_str!` data).
- Out of scope for this slice: anything in the page or daemon beyond what Slice 1 shipped (the route/state/frames are unchanged); the prompt that tells agents to install these hooks (Slice 5).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 3: a BEL from a hooked agent means "needs you"; from an idle tab, nothing

- Issue: [#14](https://github.com/Blaise1030/tabsh/issues/14)
- Depends on: 0, 1 (independent of 2 — can run in parallel with it)
- Flow (REQUIRED): A tab whose agent is `running` rings the bell (Goose/Auggie/Crush/Amp, which have no "waiting for you" event) → the tab shows `needs-input` (orange dot + badge) until the next state arrives from the daemon; the display is page-local, never posted back. A beep while `idle` (zsh's focus-code beeps at the prompt) → nothing at all. A tab that never had hook activity keeps today's bell behaviour.
- E2E spec (REQUIRED): `web/e2e/bell-rule.spec.ts` —
  1. Tab B: `tabsh hook running` → spinner; `printf '\a'` → orange dot + 🔔 title badge.
  2. `tabsh hook idle` → ✓ (the display-level needs-input is replaced by the real state).
  3. `printf '\a'` while idle → no dot, no badge (stray BEL can't override).
  4. Tab C with no hook activity: `printf '\a'` → existing bell pulse/badge behaviour (unchanged).
- Unit tests (REQUIRED): pure logic (extend `activity-view.test.ts` or a sibling pure module): BEL × {running, needs-input, idle, never-hooked} → resulting display state; a later daemon state replaces a BEL-derived needs-input; BEL-derived state is not sent to the daemon (pure function returns no such action).
- Layers touched: `web/src/app/sessions/activity.ts` + `activity-view.ts` (+ tests), `web/src/app/sessions/terminal.ts` (BEL dispatch now depends on the tab's hook state), `web/src/app/sessions/bell.ts` (ring still applies to never-hooked tabs).
- Out of scope for this slice: the "unread" dot for background output; fixing zsh's focus beeps themselves (spec: out of scope); daemon changes (none).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 4: a crashed agent stops lying — foreground check resets to idle

- Issue: [#15](https://github.com/Blaise1030/tabsh/issues/15)
- Depends on: 0, 1 (independent of 2 and 3 — can run in parallel with them)
- Flow (REQUIRED): An agent dies without sending `idle` (crash, `kill -9`) → when its shell next prints anything (the prompt after the agent quits), the tab's state resets to `idle`, so it doesn't stick at "running" forever.
- E2E spec (REQUIRED): `web/e2e/crash-recovery.spec.ts` —
  1. Tab B: `tabsh hook running; sleep 300` → spinner (the sleep is the foreground process).
  2. From tab A: `pkill -x sleep` (or kill the pgid) → tab B's shell prints its prompt.
  3. Tab B's spinner disappears without any `tabsh hook` call (the ✓-on-visit rule may then apply as plain idle).
- Unit tests (REQUIRED): daemon test in `src/sessions/pty.rs` (or its owning file): with a live spawned session set to `running`, output arriving while the PTY's foreground process group (`MasterPty::process_group_leader()`) equals the shell's pid → an `Event::Activity(Idle)` is broadcast once; output while a child (e.g. `sleep`) is in front → no reset; no output → no check runs (cost stays zero while idle).
- Layers touched: `src/sessions/pty.rs` (reader-thread check on output when activity ≠ idle), `src/sessions/mod.rs` (reset path broadcasts through the existing setter).
- Out of scope for this slice: detecting "needs-input" agents that died (only idle reset); page changes (the frame from Slice 1 already covers it).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Slice 5: one copied prompt — first-run dialog and palette entry

- Issue: [#16](https://github.com/Blaise1030/tabsh/issues/16)
- Depends on: 0, 1, 2 (the prompt pins the mapping table from Slice 2; independent of 3 and 4)
- Flow (REQUIRED): On a fresh machine, once the page is paired and tabs are restored, a dialog opens: two lines on what the hooks do, the prompt read-only, **Copy prompt** (clipboard + "Copied — paste it into your agent") and **Not now**. It never auto-opens again after either button or Escape (`agentPromptSeen` setting on the daemon), and doesn't open at all if a tab has already reported activity. Any time later, the settings palette's "Set up agent hooks" opens the same dialog.
- E2E spec (REQUIRED): `web/e2e/setup-dialog.spec.ts` —
  1. Fresh daemon (empty temp state) → open app → after tabs restore the dialog is visible with the prompt text.
  2. Click **Not now** → dialog closes; reload → no dialog.
  3. Open the palette (its keybinding), type "agent", run "Set up agent hooks" → dialog visible.
  4. Click **Copy prompt** (clipboard permission granted) → label shows "Copied — paste it into your agent"; clipboard content non-empty and mentions `tabsh hook`.
  5. A daemon whose tab already reported activity (`tabsh hook running` earlier) → reload → no auto-open.
- Unit tests (REQUIRED): `web/src/app/agents/prompt.test.ts` — the prompt names every event in the spec's mapping table and the three state definitions; pinning both ways: this node test, plus a cargo test in `src/cli/hook.rs` that reads `prompt.ts` (`include_str!`) and asserts every event name in the Rust mapping appears in the prompt; `schema.test.ts` (or existing settings tests): `cleanSettings` keeps `agentPromptSeen` and defaults it to `false`.
- Layers touched: new `web/src/app/agents/` (`prompt.ts` pure module, `dialog.ts`), `web/src/app/main.ts` (`initAgents()` between sessions and palette), `web/src/app/palette/pages.ts` ("Set up agent hooks" item), `web/src/app/settings/schema.ts` (`agentPromptSeen: boolean`, default `false`, kept by `cleanSettings`), `web/src/pages/app/index.astro` (the `<dialog>` like About's), `web/src/styles/app.css` if needed, `README.md` (points to the dialog instead of copying the text), `docs/architecture.md` (app folder table + dependency order show `agents` between `sessions` and `palette`).
- Out of scope for this slice: tabsh editing agents' config files itself (the agent does it, from the prompt); browser desktop notifications; verifying each agent's config by hand (the spec's "unconfirmed" list stays a by-hand checklist).
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue.

## Phase 5 (after all slices merge): regression + finalization

1. Pull `main`; run everything CI runs locally: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`, and in `web/`: `npm run check && npm run lint && npm test && npm run build && npm run test:e2e`.
2. Audit `f9f0622..main` against `docs/architecture.md` and neighbouring modules, including cross-slice seams: duplicated types/helpers between `cli/hook.rs` and the app's `activity-view.ts`/`prompt.ts`, naming drift between slices, the architecture doc matching what actually merged.
3. Numbered findings (`file:line`, convention broken, code to match, fix size) → shown for a pick, or all fixed in one finalization PR if pre-authorised; regression suite must stay green. Close the parent issue when it merges (or when the human declines all findings).
