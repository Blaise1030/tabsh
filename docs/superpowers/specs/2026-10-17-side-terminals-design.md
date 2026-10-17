# Side terminals: more shells inside a card

Status: approved design, 2026-10-17.

## Intent

**Who and when:** you, with an agent working in a card, needing a dev
server, `git` or a test run next to it. Today the only way is another
session, which is another card on the board.

**Success looks like:** a card has its own bar: Agent first, then any side
terminals, then `+`. `+` opens a shell in the agent's folder; it lives like
the agent's shell (page reload and daemon restart included); it never shows
on the board; closing the card closes it.

**Out of scope:** several files open per card, the file explorer as a tab,
a menu behind `+` (Terminal is its only entry), agents launched in side
terminals, side terminals of side terminals, moving a side terminal to
another card, keyboard shortcuts for the session bar.

**Constraints:**
- A card's status stays driven by its agent tab alone.
- `sessionList` keeps meaning cards: the board, groups, tags, filters and
  tab order must not see side terminals.
- The same token guard and remote-device rules cover side terminals; they
  are sessions like any other.

## Decisions

| Question | Choice |
|---|---|
| Purpose | Side shells next to the agent, without new board cards |
| `+` offers | Terminal only |
| Lifetime | Like the agent's shell: survives reload and daemon restart, same folder, scrollback kept |
| Signals | Output marks only the side tab unread; a bell also rings the card |
| Model | A side terminal is a `sessions` row with a `parent` (approach A) |

Rejected: a separate `shells` table (duplicates the PTY, persistence,
replay and restart paths) and multiplexing in the agent's PTY with tmux
(needs tmux, fights xterm's scrollback and the agent's UI).

## 1. What you see

```text
Main strip:    [Board] [card A] [card B]  [+]  [Group] [Explorer] [Settings]
Inside card A: [● Agent] [Terminal 1 ×] [Terminal 2 ×] [+]
               the selected tab's terminal | the card's file pane
```

- **The session bar** is a thin row at the top of the workspace frame, in
  the terminals view and in the board's drawer. It always shows.
- **Agent** is first and has no ×. Closing the card (main strip) closes
  everything.
- **`+`** opens a side terminal at once in the agent shell's current
  folder, named `Terminal N` (the lowest N its card's side terminals don't
  use). A
  program's terminal title may rename it, as tabs are renamed today.
- **×** on a side terminal kills its shell and removes its tab; `exit` in
  it does the same. If it was on screen, Agent shows.
- **Unread and bell:** a side terminal's output marks only its own tab
  while it isn't on screen. Its bell marks its tab and rings the card (the
  card's strip mark and the app badge, as a bell does today), unless that
  side terminal is on screen in a focused window.
- **URL:** `term=<id>` names the side terminal on screen. Without it, Agent
  shows.
- **File pane:** still the card's; it stays while you switch tabs in the
  session bar.
- **Unchanged:** the main strip's `+`, the board, the explorer sidebar, one
  file per card.

## 2. The daemon

**Schema.** `board::migrate` adds `parent TEXT` (idempotent, like its other
columns). `parent` null: a card. Set: a side terminal of that card. One
level only.

**Create.** `POST /api/sessions` takes `{parent}`:
- 400 unless the parent exists and its own `parent` is null.
- 400 if `parent` comes with `prompt`, `command` or `resume`.
- `cwd` defaults to the parent's (`sessions::cwd`, live then saved); an
  explicit `cwd` wins and is checked as today.
- Named `Terminal N`, the lowest N not used by the parent's side terminals
  (closing `Terminal 1` beside `Terminal 2` makes the next one
  `Terminal 1`).

**List.** `SessionInfo` gains `parent: Option<String>`, serialised as
`parent: string | null`. `GET /api/sessions` keeps returning every row.

**Side terminals are not cards.** Each of these skips rows with a parent:
- `board/mod.rs`'s ordering and column queries (today's lines 240, 368,
  625);
- `PATCH /api/sessions/{id}/status` and `/prompt` return 409 for a side
  terminal, so a hook run in a side shell changes nothing (`tabsh status
  --hook` already exits 0 quietly);
- `counts()` (the About dialog) counts cards.

`/api/board/agents/...` never matches one: side terminals have no
`agent_session`.

**Close.** `close_children(st, parent)` closes each child through
`close()`. It runs from:
- `close()` for a card (its ×, `DELETE /api/sessions/{id}`);
- the reader thread, when a card's shell exits and its row is deleted
  (`pty.rs`, after `DELETE FROM sessions`; not on restart).

A side terminal's shell exiting removes only that row.

**Unchanged:** socket attach, replay and resume; scrollback flushing;
restore on startup (children come back like any row); restart;
`TABSH_SESSION_ID` (a side shell gets its own id); auth and remote rules.

## 3. The web app

**Store (`sessions/store.ts`).**
- `sessionList` holds cards only.
- `Session` gains `parent: string | null` and `sides: State<Session[]>`
  (its side terminals, in position order; empty on a side terminal).
- A side terminal is a full `Session` made by `openSession` (its own xterm,
  socket, bell, unread), never added to `sessionList`.
- `splitSessions(list)` (pure): cards, and side terminals by parent; a row
  whose parent isn't in the list is dropped. `sync` uses it: cards as
  today, then each card's `sides`.
- `findTerm(id)`: a card or a side terminal. `board/events.ts`' activity
  and bell use it.
- `onScreen()`: the active card's side terminal named by the place's
  `term`, else the active card. `store.active` stays the active card.

**On screen, not active, for terminal work.** These use `onScreen()`:
`terminalInView` (it compares the on-screen id; only that terminal holds a
socket, so the agent's parks while a side terminal shows), which terminal
element shows, `sendSize`, `typeKey`, the touch key bar, `probeActive`,
`focusTerminal`, and drops (paths typed where you're looking). The file
pane's comment paste still goes to the card id: the agent.

**Router (`nav/place.ts`).**
- `Place.term: string | null`, query `term`, the same limit as `tab`.
- `merge`: a change of `tab` without `term` clears `term`, as it clears
  `file`.
- A `term` step after `tab`: an id that isn't one of the active card's
  sides is replaced with null.

**Session bar (`sessions/session-bar.ts`).**
- Agent; each side terminal (name, unread and bell marks, ×); `+`.
- `+`: `POST /api/sessions {parent}`, open the returned session in the
  card's `sides`, `go({ term: id })`.
- ×: `DELETE /api/sessions/{id}`; if it was on screen, `go({ term: null })`.
- Placed in `ui/app.ts`' workspace frame, above the terminals, so the
  terminals view and the drawer both get it.

**Bell and unread.** A side terminal's output sets its own `unread` while
it isn't on screen. `ring(s)` (`sessions/bell.ts`) skips a terminal that is
`onScreen()` in a focused window, rather than the active card: a side
terminal's bell marks it and its card even while its card is active, and
the agent's bell still rings while a side terminal shows. A parked side
terminal's output and bell arrive as board activity events, as a parked
card's do.

**Removal.** Removing a card disposes its side terminals (xterm and
socket). Removing a side terminal drops it from its card's `sides`.

## 4. Testing

**Daemon (`mod tests`):**
- Create with `parent`; 400 for a missing parent, a side terminal as
  parent, and `parent` with `prompt`, `command` or `resume`.
- Default `cwd` is the parent's; names take the lowest free `Terminal N`.
- The list carries `parent`; board ordering and columns skip side
  terminals.
- `PATCH .../status` and `.../prompt` return 409 for a side terminal.
- Closing a card closes its side terminals; a card's shell exiting removes
  them; a side terminal's shell exiting leaves the card.
- `migrate` stays idempotent on an old database.

**Web unit (`node --test`):**
- `place.ts`: `term` read and written; a `tab` change clears it.
- `splitSessions`: cards, side terminals, an orphan dropped.
- `terminalInView` with the on-screen id.
- `ring`'s skip rule as a pure check: the on-screen terminal in a focused
  window is skipped; its card, or a side terminal of the active card, is
  not.

**E2E (`web/e2e/side-terminals.spec.ts`, a real daemon):**
1. Open a card; the session bar's `+` adds `Terminal 1`, selected, with
   `term=` in the URL.
2. `echo side` in it; Agent's terminal doesn't show it.
3. Reload: `Terminal 1` and its output are back.
4. The board shows one card.
5. Close the card: the daemon's list has no side terminal left.
6. A bell (`sleep 1; printf '\a'` typed in a side terminal, then Agent
   selected) marks the side tab and the card's strip tab, with the card
   active.

**Docs.** `docs/architecture.md`: the `parent` column, the 409 rule,
`close_children`, `session-bar.ts`, `term` in the place.
