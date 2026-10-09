# Busy tabs stay responsive

**Status:** approved approach (2026-10-09) — Approach A: pause inactive clients + shorten daemon locks  
**Goal:** With several agent tabs printing, switching tabs, opening the board, and status hooks stay smooth. Scrollback still survives restart; attach/replay still works.

## Problem

Today every open session keeps a live xterm and WebSocket. Inactive terminals are only CSS-hidden; each output chunk still runs through `term.write`. On the daemon, the PTY reader holds the session `output` mutex across scrollback append, mode trim, and broadcast; the 2s flusher holds the global SQLite mutex while copying up to ~512KB scrollback per dirty session. Opening a tab runs `openpty`/spawn on the async runtime before the WebSocket upgrades.

## Non-goals (this feature)

- Explorer watch / tree scan cost
- Board drag indicators / column regroup
- Upload streaming
- Disposing xterm for cold tabs (Approach B)
- A dedicated DB actor or full WS backpressure redesign (Approach C)

## User-visible outcomes

1. **Inactive tabs stay cheap.** Switch away from a busy agent tab → the page stays responsive while that agent keeps printing. The tab still shows unread when there is new output. Switch back → the terminal catches up and is usable.
2. **Active bursts don't freeze the UI.** On the focused tab, a flood of agent output does not stall tab switching, board chrome, or typing elsewhere in the page for long stretches.
3. **Board and hooks stay snappy while agents print.** Moving a card / `tabsh status` / listing sessions does not hitch on the 2s scrollback flush under load.
4. **Opening or reattaching tabs does not stall other work.** Creating or reattaching several tabs quickly still lets other API and board traffic proceed.

## Design

### Client — pause inactive terminal paint

- Keep the session, xterm instance, and tab chrome for every open session (no dispose in this feature).
- When a session is not the active tab (and, when the board is up without the drawer, terminals are not on screen): do not call `term.write` for live chunks.
- Still scan for bell / unread as today (or an equivalent cheap path) so badges and unread markers keep working.
- On activate: flush any buffered bytes (or reattach and accept replay — pick one strategy in the walking skeleton and stick to it). Prefer a small in-memory byte buffer per paused session with a cap; if the cap is exceeded, close and reconnect so the daemon's scrollback replay restores the view.
- Optional in a later slice: rAF/microtask coalescing of writes for the *active* session under bursty output.

Security / architecture invariants unchanged: token handling, no `innerHTML`, URLs select-only, CSP.

### Daemon — shorter critical sections

- **PTY output:** Append to scrollback and set `dirty` under the `output` lock; send on the broadcast channel without holding that lock across client attach/history copy longer than necessary. Attach should not block the producer for the full 512KB copy duration if avoidable (copy under lock, send after; or double-buffer).
- **Flush:** Collect dirty scrollback copies session-by-session without holding `db` for the whole live set; do not hold `db` while waiting on `output`. Prefer: snapshot dirty blobs, then one short DB write section (or per-session writes without holding other session locks). `PRAGMA busy_timeout` is allowed if tests show contention.
- **Spawn:** Run `get_or_spawn` / `openpty` work in `spawn_blocking` (or equivalent) so axum workers are not blocked on fork/pty setup. Release `live` before slow syscalls where safe.

No new routes required for the client pause path. No change to the pairing guard.

## Testing shape

- E2E: multi-tab busy output + switch (responsiveness asserted via continued UI interaction: open board / switch tabs / type in another tab while a background tab is flooded).
- Unit: pure buffer/pause policy on the client if extracted; daemon tests for flush not holding locks incorrectly and spawn off the async path where testable.
- Existing replay, smoke, and board e2e stay green.

## Success criteria

- Several busy background tabs do not make the active UI feel stuck.
- Restart still restores scrollback within the existing cap.
- Reattach still replays history; unread/bell behaviour preserved for inactive tabs.
