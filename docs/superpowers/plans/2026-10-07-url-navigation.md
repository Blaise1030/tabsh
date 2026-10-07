# URL Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back/Forward and reload work through the tabsh web app: tab, board, file and line, explorer and palette live in the URL's query string, and every move is a navigation.

**Architecture:** A new `web/src/app/nav/` folder at the bottom of the dependency chain. `place.ts` is pure (the `Place`, its query string, merge rules). `router.ts` owns one Navigation API `navigate` handler that runs the steps features register (`onPlace`) in a fixed order. Features stop moving themselves: their triggers call `go(patch)`, and their step applies the place.

**Tech Stack:** TypeScript (strict, `astro check`), Navigation API (`window.navigation`), `node --test` for pure modules, Playwright e2e against a real daemon, Rust (`src/web/pages.rs`) for one header test.

**Spec:** `docs/superpowers/specs/2026-10-07-url-navigation-design.md`

## Global Constraints

- No new npm dependency. If TypeScript's DOM lib lacks Navigation API types, declare the subset used in `web/src/app/globals.d.ts`.
- Query string only; never read or write the fragment (it carries the pairing token, cleared in `main.ts` before any request).
- Keep `?daemon=` and any other unknown query keys untouched.
- Defaults are left out of the URL: `view=terms`, `explorer` closed, `palette` closed, no `file`/`line`.
- Value limits: `file` ≤ 4096 characters, every other value ≤ 128; `line` a positive integer and only with `file`; `palette` matches `/^[A-Za-z]{1,64}$/`.
- A URL only selects what exists: it never opens a tab, runs a command, sets a `cwd` or saves a file. Applying `explorer` writes only the `explorerOpen` boolean.
- Step order: `tab → view → file → explorer → palette`.
- `nav/` imports no feature module; features import `nav/`.
- Comment and naming style matches the surrounding code (short prose comments, no JSDoc).
- Checks before each commit, in `web/`: `npm run check`, `npm run lint`, `npm test`. Before the last task's commit also `npm run build` (rebuilds `src/app.html` and `src/app-assets/`, which are committed) and `npm run test:e2e`.

## Review Focus

1. **A step that waits while a newer navigation starts** (Back pressed twice fast while a file loads): the older file must not land in the pane. Pinned in Task 4 (e2e "rapid Back").
2. **A URL edited by hand or a stale bookmark** (`?tab=gone&file=../../etc/x&line=abc`): the app opens on a real tab, no error dialog, and the URL is fixed. Pinned in Task 1 (unit) and Task 7 (e2e).
3. **Palette item that navigates** (Toggle board from the palette): Back must land before the palette, not reopen it. Pinned in Task 6.
4. **Settings arriving from the daemon** (`window` focus → `loadSettings`) with a different `explorerOpen` than the URL: the URL's place is not overridden mid-session. Pinned in Task 5.
5. **Keybinding pressed with a dialog open** (New card, About): Back must not fire behind the dialog. Pinned in Task 7.

---

### Task 1: The place and its URL (pure)

**Files:**
- Create: `web/src/app/nav/place.ts`
- Test: `web/src/app/nav/place.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type View = 'terms' | 'board';
  export type Step = 'tab' | 'view' | 'file' | 'explorer' | 'palette';
  export type Place = { tab: string | null; view: View; file: string | null; line: number | null; explorer: boolean; palette: string | null };
  export const HOME: Place;            // all defaults, tab null
  export const STEPS: readonly Step[]; // ['tab','view','file','explorer','palette']
  export function fromQuery(q: URLSearchParams): Partial<Place>;
  export function toQuery(p: Place, keep: URLSearchParams): string; // '?…' or '' ; keys of Place replaced, others kept in order
  export function merge(from: Place, patch: Partial<Place>, how: 'push' | 'replace'): Place;
  export function changed(from: Place, to: Place): Step[];          // in STEPS order
  export function fileAction(from: Place, to: Place): 'keep' | 'adopt' | 'open' | 'close';
  ```

- [ ] **Step 1: Write the failing tests** in `place.test.ts` (style of `board/model.test.ts`):
  - `round-trips a full place`: `fromQuery(new URLSearchParams(toQuery(p, new URLSearchParams())))` deep-equals `p` for `{tab:'7f3a',view:'board',file:'/r/src/main.rs',line:42,explorer:true,palette:'root'}`.
  - `leaves defaults out`: `toQuery({...HOME, tab:'7f3a'}, new URLSearchParams())` → `'?tab=7f3a'`; `toQuery(HOME, …)` → `''`.
  - `keeps other keys`: `toQuery({...HOME, tab:'a'}, new URLSearchParams('daemon=http%3A%2F%2F127.0.0.1%3A9&view=board'))` → `'?daemon=http%3A%2F%2F127.0.0.1%3A9&tab=a'`.
  - `drops bad values`: each of `view=grid`, `palette=../x`, `line=0`, `line=-3`, `line=abc`, `line=4` (no file), `tab=` + 129 chars, `file=` + 4097 chars yields `{}` for that key (and `line` is absent).
  - `merge: a push closes the palette`: `merge({...HOME,tab:'a',palette:'root'}, {view:'board'}, 'push').palette` → `null`; with `'replace'` → `'root'`; with patch `{palette:'theme'}` → `'theme'`.
  - `merge: a new tab drops the file`: `merge({...HOME,tab:'a',file:'/x',line:3}, {tab:'b'}, 'push')` has `file: null, line: null`; `merge(same, {tab:'a'}, 'push')` keeps `file:'/x'`.
  - `changed lists steps in order`: from HOME to `{...HOME, palette:'root', tab:'a'}` → `['tab','palette']`; line-only change → `['file']`.
  - `fileAction`: same tab, same file+line → `'keep'`; tab differs and `to.file` null → `'adopt'`; same tab, `to.file` null, `from.file` set → `'close'`; `to.file` set and differs from `from.file` (or line differs) → `'open'`.

- [ ] **Step 2: Run** `cd web && node --test src/app/nav/place.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement `place.ts`.** Query keys are the field names (`tab`, `view`, `file`, `line`, `explorer=1`, `palette`). `toQuery` builds on a copy of `keep`: delete all six keys, then append the non-default ones in `STEPS`-ish order `tab, view, file, line, explorer, palette`. No DOM, no imports.

- [ ] **Step 4: Run** `node --test src/app/nav/place.test.ts` — expect PASS. Then `npm run check && npm run lint`.

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/app/nav/place.ts web/src/app/nav/place.test.ts
  git commit -m "feat(nav): the place and its query string"
  ```

### Task 2: The router, with tabs as its first step

Delivers: switching tabs is a navigation; Back/Forward walk tabs; reload keeps the tab.

**Files:**
- Create: `web/src/app/nav/router.ts`
- Modify: `web/src/app/globals.d.ts` (Navigation API types, only if `npm run check` lacks them)
- Modify: `web/src/app/sessions/store.ts` (`openTab:76`, `sync:110`, `cycleTab:148`, `removeSession:184`; register the `tab` step)
- Modify: `web/src/app/sessions/terminal.ts:91`, `web/src/app/sessions/groups.ts:114`
- Modify: `web/src/app/main.ts:102-109` (startup)
- Modify: `docs/architecture.md` (`nav/` row, dependency chain, rule)
- Modify: `src/web/pages.rs` (test pinning `no-referrer`)
- Create: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: Task 1's `Place`, `HOME`, `STEPS`, `fromQuery`, `toQuery`, `merge`, `changed`.
- Produces (`nav/router.ts`):
  ```ts
  export type Apply = (to: Place, from: Place, signal: AbortSignal) => void | Partial<Place> | Promise<void | Partial<Place>>;
  export function onPlace(step: Step, apply: Apply): void;          // one apply per step
  export function onLeave(guard: (to: Place, from: Place) => boolean): void; // false refuses the move
  export function go(patch: Partial<Place>, how?: 'push' | 'replace'): void;  // default 'push'
  export function here(): Place;
  export function startRouter(fallback: Partial<Place>): Promise<void>;
  export function back(): void;  export function forward(): void;   // no-ops when !canGoBack / !canGoForward
  ```
  An `Apply` returning a `Partial<Place>` is a correction: after all steps ran, the router merges every correction and does one `go(corrections, 'replace')`.

- [ ] **Step 1: Write the failing e2e tests** in `web/e2e/navigation.spec.ts` (imports from `./fixture.ts`; tab ids from `page.locator('#tabs .tab:not(.mirror)').nth(i)` and the URL via `new URL(page.url()).searchParams.get('tab')`):
  - `Back and Forward walk the tabs`: `openApp`, `newTab` (now on B), click tab A → `goBack()` → B is `.active` and `?tab=` is B's id → `goForward()` → A active.
  - `a reload keeps the tab`: two tabs, click A, `page.reload()` → A active, URL unchanged.
  - `an unknown tab falls back to a shown tab`: `page.goto(app + '?tab=nope')` (token already stored by `openApp`) → a tab is active and `?tab=` is its id.
  - `a tab closed elsewhere is replaced, not pushed`: tabs A, B on B; `DELETE /api/sessions/<B>` through `page.request` with the token → A active, URL `tab` is A; `goBack()` → still a shown tab is active (B is gone, the fallback applies).

- [ ] **Step 2: Run** `cd web && npx playwright test e2e/navigation.spec.ts` — expect FAIL (Back leaves the app / URL has no `tab`).

- [ ] **Step 3: Implement `router.ts`.**
  - State: `current: Place` (starts `HOME`), `steps: Map<Step, Apply>`, `guards`, `queue: Array<[patch, how]>` until started, `started`.
  - `go`: before start, queue. Otherwise compute `to = merge(here(), patch, how)`; **palette rule:** if `how==='push'` and `here().palette` is set and `navigation.currentEntry.key === paletteEntryKey`, use `history: 'replace'` (and `to.palette` is already null from `merge`). Navigate with `navigation.navigate(location.pathname + toQuery(to, new URLSearchParams(location.search)), { history: how, info: { to } })`; skip if the URL is unchanged.
  - `navigate` listener: ignore unless `e.canIntercept`, same document, same pathname, `!e.hashChange`, `!e.downloadRequest`. Parse `to` = `e.info?.to` or `merge(HOME, fromQuery(new URL(e.destination.url).searchParams), 'replace')` with `HOME`'s `tab` replaced by `current.tab` when the query has none. Run guards synchronously; on refusal: `e.cancelable ? e.preventDefault() : refusedTraverse = previousEntryKey` (after the intercepted handler finishes, `navigation.traverseTo(refusedTraverse)`). Then `e.intercept({ handler })`: `from = current; current = to;` run `changed(from, to)` steps in order with `e.signal`, awaiting each; collect corrections; if not aborted and any, `go(corrections, 'replace')`. Remember `paletteEntryKey = navigation.currentEntry.key` when a push set `palette` from null.
  - `startRouter(fallback)`: `to = merge(merge(HOME, fallback,'replace'), fromQuery(location.search),'replace')`; mark started; `navigation.navigate(…, { history: 'replace', info: { to } })` and await its `finished` — with `from = HOME` every step whose value differs runs (the `tab` step always runs); then drain the queue.
  - Abort: steps receive the event's `signal`; a newer navigation aborts it (built into the API).

- [ ] **Step 4: Wire the `tab` step and its triggers.**
  - In `store.ts`, `initTabRouting()` (exported, called from `main.ts` before `startRouter`) registers `onPlace('tab', (to) => …)`: find `to.tab` in `store.sessions`; if missing return `{ tab: (shownSessions()[0] ?? store.sessions[0])?.id ?? null }` after activating it; else `activate(s)` unless already active.
  - Replace `activate(x)` with `go({ tab: x.id })` at `terminal.ts:91`, `groups.ts:114`, `store.ts:76` (`openTab` with focus), `store.ts:148` (`cycleTab`), and `go({ tab }, 'replace')` at `store.ts:110` (`sync`) and `store.ts:184` (`removeSession`, the daemon closed the active tab; `null` when none left). `activate()` stays exported for the router step only.
  - `main.ts` startup: replace the final `activate(...)` with `await startRouter({ tab: (store.sessions.find((s) => s.id === activeId) ?? store.sessions[0]).id })`. Keep `rememberActive` in `activate` (it is the fallback).
  - `links/provider.ts:67` is xterm's link `activate`, not a tab switch: leave it.

- [ ] **Step 5: Docs and header test.**
  - `docs/architecture.md`: add the `nav/` row (`place.ts` pure place and query string; `router.ts` the `navigate` handler, `go`, `onPlace`, `onLeave`); dependency chain becomes `nav` → `daemon` → …; a rule "Only the router changes the active tab, view, file, explorer or palette; everything else calls `go()`"; under Security invariants: "A URL only selects what exists: it never opens a tab, runs a command, sets a `cwd` or saves a file."
  - `src/web/pages.rs`: test `local_app_sends_no_referrer` asserting `local_app()`'s `Referrer-Policy` header is `no-referrer` (file paths are in the URL now).

- [ ] **Step 6: Run** `npx playwright test e2e/navigation.spec.ts e2e/tab-groups.spec.ts e2e/smoke.spec.ts` — expect PASS. At repo root: `cargo test --locked local_app` — PASS. In `web/`: `npm run check && npm run lint && npm test`.

- [ ] **Step 7: Commit**
  ```bash
  git add web/src/app/nav/router.ts web/src/app/globals.d.ts web/src/app/sessions web/src/app/main.ts web/e2e/navigation.spec.ts docs/architecture.md src/web/pages.rs
  git commit -m "feat(nav): tab switches are navigations, so Back and reload keep your tab"
  ```

### Task 3: The board in history

**Files:**
- Modify: `web/src/app/board/view.ts` (`toggleBoard`, lines 63-64, 223-224, 271, 278; register the `view` step in `initBoard`)
- Modify: `web/src/app/palette/palette.ts:33`
- Test: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `go`, `onPlace` (Task 2).
- Produces: `toggleBoard(open?: boolean)` keeps its signature but now calls `go({ view: open ? 'board' : 'terms' })`; the private `showBoard(open: boolean)` holds today's body and is what the `view` step calls.

- [ ] **Step 1: Write the failing e2e test** `the board is a place`: tab A → tab B → `#board-btn` click → `goBack()` twice → A's terminal visible and `#board` hidden → `goForward()` twice → `#board` visible, URL has `view=board`. Use `setOnboarded` from `board.spec.ts` (move it into `fixture.ts` and export it; update `board.spec.ts`'s import).
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement.** `onPlace('view', (to) => showBoard(to.view === 'board'))`. A card click (`:63-64`) and the onboarding setup (`:223-224`) become one `go({ view: 'terms', tab: s.id })`.
- [ ] **Step 4: Run** `npx playwright test e2e/navigation.spec.ts e2e/board.spec.ts` — PASS; `npm run check && npm run lint`.
- [ ] **Step 5: Commit** `feat(board): opening the board is a navigation`.

### Task 4: Files and lines in history

**Files:**
- Modify: `web/src/app/files/pane.ts` (add `showFile`, report resolved path and cursor line)
- Modify: `web/src/app/files/editor.ts` (`onCursor` option)
- Modify: `web/src/app/files/open.ts` (register `file` step and leave guard; `openInPane` becomes a `go`)
- Modify: `web/src/app/palette/palette.ts:30` (`closeFile`)
- Test: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `go`, `here`, `onPlace`, `onLeave` (Task 2); `fileAction` (Task 1).
- Produces:
  - `pane.showFile(sessionId: string, path: string | null, line: number | null, opts: { focus: boolean; signal: AbortSignal }): Promise<string | null>` — opens (or with `null`, forgets) **without** `confirmDiscard`; resolves to the daemon's absolute path, or `null` if the file couldn't be read (then the tab shows no file).
  - `pane.fileOf(sessionId: string): string | null` — the tab's current absolute path.
  - `pane.isDirty(sessionId: string): boolean`.
  - `createEditor` option `onCursor(line: number): void`, fired at most every 300 ms on selection changes.
  - `openInPane(s, f)` keeps its signature and calls `go({ tab: s.id, file: f.text, line: f.line ?? null })`; `col` is dropped.

- [ ] **Step 1: Write the failing e2e tests** (use the `project` fixture; open a file by typing its path in the terminal and clicking the link, as `explorer.spec.ts` does, or by clicking an explorer row):
  - `a file and line survive a reload`: open `src/main.rs` at line 1 via `go` (link `src/main.rs:1`), `reload()` → pane shows `main.rs`, URL `file` is the absolute path.
  - `Back closes the file, Forward reopens it`.
  - `unsaved edits ask before Back`: open, type in the editor, `page.once('dialog', d => d.dismiss())`, `goBack()` → still on the file with the edit; `goForward()` is not broken (URL equals the file's).
  - `rapid Back keeps the latest`: open README, then `src/main.rs`, then `goBack(); goBack()` without waiting → pane shows no file, URL has no `file`.
  - `a deleted file is dropped quietly`: open README, close it, `rm` it on disk, `goBack()` (back to README) → no pane, no error, URL has no `file`.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.**
  - `open.ts` registers `onLeave((to, from) => !(['open','close'].includes(fileAction(from, to)) && pane?.isDirty(from.tab) && !pane.confirmDiscard(from.tab)))` (only same-tab changes reach `open`/`close` with a dirty file; `adopt` never asks).
  - `onPlace('file', …)`: `keep` → nothing; `adopt` → return `{ file: pane?.fileOf(to.tab) ?? null, line: null }`; `close` → `showFile(tab, null, …)`; `open` → load the pane module if needed (`filePane()`), `const abs = await showFile(to.tab, to.file, to.line, { focus: userMove, signal })`; return `{ file: abs, line: abs ? to.line : null }` when `abs !== to.file`. `userMove` is false only for `startRouter`'s first apply (pass it via `navigate` `info`).
  - The pane reports cursor moves with `go({ line }, 'replace')`, and calls `rememberFile` as today, so other tabs' files still come back from `restoreFiles`.
  - The pane's own close button and `palette.ts:30` call `go({ file: null })`.
- [ ] **Step 4: Run** `npx playwright test e2e/navigation.spec.ts e2e/explorer*.spec.ts` — PASS; `npm run check && npm run lint && npm test`.
- [ ] **Step 5: Commit** `feat(files): the open file and line are part of the place`.

### Task 5: The explorer in history

**Files:**
- Modify: `web/src/app/explorer/explorer.ts` (`toggleExplorer:45`, `searchFiles:53`, `onApply` at `:104`, register `explorer` step; row click `:221` already goes through `openInPane`)
- Test: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `go`, `here`, `onPlace`.
- Produces: `toggleExplorer()` → `go({ explorer: !here().explorer })`; `searchFiles()` opens with `go({ explorer: true })` when closed.

- [ ] **Step 1: Write the failing e2e tests:**
  - `Back closes the explorer and saves it`: toggle open (`#explorer-btn`), `goBack()` → `#explorer` hidden; `GET /api/settings` has `explorerOpen: false`.
  - `settings from the daemon don't move you`: open the explorer, then `PUT /api/settings` with `explorerOpen:false` through `page.request`, dispatch `window` `focus` (`page.evaluate(() => dispatchEvent(new Event('focus')))`) → explorer still open and URL still has `explorer=1`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The step shows/hides the sidebar (today's `onApply` body for open/close) and `saveSetting('explorerOpen', to.explorer)` when it differs. `onApply` keeps width only; open/close comes from the place. `startRouter`'s fallback in `main.ts` gains `explorer: current.saved.explorerOpen`.
- [ ] **Step 4: Run** `npx playwright test e2e/navigation.spec.ts e2e/explorer*.spec.ts` — PASS; checks.
- [ ] **Step 5: Commit** `feat(explorer): opening the explorer is a navigation`.

### Task 6: The palette in history

**Files:**
- Modify: `web/src/app/palette/palette.ts` (`openPalette:117`, `openGroupPalette:130`, close listener `:178-186`, page changes `:162`, `:172`, `:107`; register `palette` step)
- Test: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `go`, `here`, `onPlace`, `back` (Task 2), and the router's palette-entry rule.
- Produces: `openPalette(at = 'root')` → `go({ palette: at })` (or closes as today when open); user page changes call `go({ palette: name }, 'replace')`; the step calls a private `showPalette(page: string | null)` holding today's open/`showPage`/close code, which never calls `go`.

- [ ] **Step 1: Write the failing e2e tests:**
  - `Back closes the palette`: open with `#settings-btn` → `goBack()` → `#palette` not open.
  - `Esc leaves no dead step`: tab A → tab B → open palette → `Escape` → `goBack()` → A active (not the palette).
  - `a palette action replaces the palette's step`: open palette, run "Toggle board" (type `board`, Enter) → board visible → `goBack()` → board hidden, palette closed.
  - `a reload reopens the palette page`: open the Theme page, `reload()` → palette open on Theme.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The dialog's `close` listener: if `here().palette` is null, nothing (a navigation closed it); else if the current entry is the palette's (`navigation.currentEntry.key` equals the key the router recorded — expose it as `isPaletteEntry(): boolean` from `router.ts`), `back()`; else `go({ palette: null }, 'replace')`. An unknown page id in the step falls back to `'root'` and returns `{ palette: 'root' }`.
- [ ] **Step 4: Run** `npx playwright test e2e/navigation.spec.ts e2e/tab-groups.spec.ts` — PASS; checks.
- [ ] **Step 5: Commit** `feat(palette): the palette is a place; Back closes it`.

### Task 7: Back/Forward keybindings, palette entries, and stale URLs

**Files:**
- Modify: `web/src/app/settings/keys.ts` (`KeyId`, `keybindings`)
- Modify: `web/src/app/settings/schema.ts` (`Settings`, `defaults`, `chosen`, `cleanSettings`)
- Modify: `web/src/app/settings/schema.test.ts`, `web/src/app/settings/keys.test.ts`
- Modify: `web/src/app/palette/pages.ts` (root page entries, `ctx`), `web/src/app/palette/palette.ts` (capture-phase listener, `ctx`)
- Modify: `docs/architecture.md` (`nav/` row mentions the keybindings)
- Test: `web/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `back`, `forward` (Task 2); `navigation.canGoBack` / `canGoForward`.
- Produces: `KeyId` gains `'keyBack' | 'keyForward'`; `Settings` gains `keyBack: string; keyForward: string`.

- [ ] **Step 1: Write the failing unit tests:**
  - `keys.test.ts` `back and forward presets are valid`: for both `isMac` values, every preset of `keyBack` / `keyForward` has `comboProblem(p, id, defaults(isMac), isMac) === null` for its own id except where another action holds it; Mac presets are exactly `['ctrl+shift+Minus','meta+BracketLeft']` and `['ctrl+shift+Equal','meta+BracketRight']`, others `['alt+shift+ArrowLeft','ctrl+alt+shift+ArrowLeft']` and `['alt+shift+ArrowRight','ctrl+alt+shift+ArrowRight']`.
  - `schema.test.ts` `cleanSettings fills keyBack and keyForward`: `cleanSettings({}, true).keyBack === 'ctrl+shift+Minus'`; a stored `keyBack` equal to `keyPalette`'s combo gives way to a free preset.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** the keys (names "Go back" / "Go forward", keywords `history previous last navigate` / `history next navigate`) and schema entries.
- [ ] **Step 4: Write the failing e2e tests:**
  - `the Back key works from the terminal`: tab A → tab B, click into B's terminal, press the platform default (`ControlOrMeta` is wrong here: use `process.platform === 'darwin' ? 'Control+Shift+Minus' : 'Alt+Shift+ArrowLeft'`) → A active.
  - `the Back key does nothing behind a dialog`: open the New card dialog (`#new-card`, the way `board.spec.ts` opens it), press Back → dialog still open, tab unchanged.
  - `the palette offers Go back`: palette, type `go back`, Enter → previous tab active.
  - `a stale URL is fixed`: `page.goto(app + '?tab=nope&file=../../nope&line=abc&view=grid')` → a tab active, no pane, URL has a real `tab` and none of `file`, `line`, `view`.
- [ ] **Step 5: Implement.** One capture-phase `keydown` listener in `palette.ts` (beside the tab-cycling one): skip when any `dialog[open]` other than `#palette` is open; on `keyBack` / `keyForward`, `preventDefault`, `stopPropagation`, call `back()` / `forward()`. Root page gains a "Navigate" group with "Go back" and "Go forward" (`hint` from `keyLabel`), each `run` calling `back()` / `forward()`; when `!navigation.canGoBack` / `!canGoForward` the item gets `aria-disabled="true"` and no `run`.
- [ ] **Step 6: Run the full suite.** In `web/`: `npm run check && npm run lint && npm test && npm run build && npm run test:e2e` — all PASS. Repo root: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked` — PASS.
- [ ] **Step 7: Commit**
  ```bash
  git add web/src docs/architecture.md web/e2e src/app.html src/app-assets
  git commit -m "feat(nav): Back and Forward keybindings and palette entries; rebuild the embedded app"
  ```
