# e2e

Playwright specs that drive the real app against a real daemon, in a real
(chromium) browser. The smoke spec proves the whole loop — page → daemon →
PTY → page — before any feature work builds on it.

## Running

```sh
cargo build --locked                 # at the repo root: builds target/debug/tabsh
cd web
npx playwright install chromium      # once per machine
npm run test:e2e                     # or: TABSH_BIN=/path/to/tabsh npm run test:e2e
```

`TABSH_BIN` says which daemon binary to start; it defaults to
`../target/debug/tabsh` relative to `web/`. CI builds it with
`cargo build --locked` and sets `TABSH_BIN` the same way.

## The daemon fixture

`daemon.ts` (`startDaemon()`) gives every worker its own daemon:

1. a **temp state dir** (`TABSH_DB` under `mkdtemp`), so specs never see each
   other's tabs or settings — the state dir starts empty, which the app
   answers by opening a first terminal on its own (`main.ts`);
2. a **free port**, taken by binding to `127.0.0.1:0` and passing the port as
   the daemon's argv;
3. `TABSH_NO_BROWSER=1`, because the browser here is playwright's to open;
4. it **waits for the daemon's own `tabsh listening on …` line** on stdout,
   not for a ping: that line means the port is bound, the database is open
   and the token file exists;
5. it reads the **pairing token from `<state dir>/token`** (beside the
   database, exactly where the daemon puts it).

The daemon's `PATH` starts with its own binary's directory, so shells it
spawns can run the `tabsh` CLI (`tabsh hook …`) without installing anything.
A login shell on some systems (CI's bash reads `/etc/profile`) rebuilds PATH
from scratch and drops it — specs that need the CLI spell out `daemon.bin`
instead.

`cleanup()` SIGTERMs the daemon (its own flush-and-exit path) and deletes the
temp dir; the worker-scoped fixture in `fixture.ts` calls it after the last
test in the worker.

## The auth fixture

The token rides in the URL fragment, exactly as in the link the daemon
prints, and the page clears it before talking to the API:

```ts
await openApp(page, daemon); // goto http://127.0.0.1:<port>/app/#token=<token>
```

`openApp` waits for the tab strip and for the app's auto-opened first
terminal, so tests start from a settled page.

## Helpers

`fixture.ts` exports `test` (with the `daemon` fixture), `expect`, and:

- `newTab(page)` — clicks `.tabbar [data-new-session]` and waits for one more
  tab (the empty state has a second new-terminal button; scope to the tabbar);
- `typeInTerminal(page, text)` — clicks `.term.active` and `keyboard.type`s.

`daemon.bin` (from the fixture) is the daemon binary's absolute path, for
specs that run the `tabsh` CLI inside a tab.

## Selector rules

- Use **element IDs and classes that exist in
  `web/src/pages/app/index.astro`**: `#tabs`, `.tab`, `.term.active`,
  `[data-new-session]`, `#palette`, `#gate`, … Do not invent selectors the
  page doesn't have; if a spec needs one, add it in the page first.
- **Never assert on canvas pixels.** xterm paints its screen to a canvas,
  which cannot be asserted. Drive output assertions through **DOM effects**:
  - a tab's name — `setName` writes the label: the OSC 0 title escape
    (`printf '\033]0;name\007'`) renames the tab, so assert
    `#tabs .tab[aria-selected="true"] span` text;
  - tab classes — `unread`/`entering`/`leaving` on `.tab`, and the agent
    activity markers `running`/`needs`/`done` (see `hook-state.spec.ts`);
  - `document.title` and the favicon `href` (`#favicon`);
  - the bell — `bell.ts` updates the badge and `title`.
- Typing: click the terminal first (the click focuses xterm's hidden
  textarea), then `page.keyboard.type(...)` — real key events through the
  page, the socket and the PTY. Prefer `expect(...).toPass()` around
  type-then-assert if a keystroke could land before the tab's socket opens.

## Conventions

- Specs import from `./fixture.ts`; only `daemon.ts` knows how to spawn the
  daemon, and only `fixture.ts` knows playwright.
- One worker, one daemon, chromium only. Parallel workers are a later slice.
- Each spec leaves the daemon's state dir throw-away: never rely on state
  from a previous spec.
