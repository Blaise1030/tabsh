# URL navigation: Back and Forward through the app

Status: approved design, 2026-10-07.

## Intent

**Problem:** the app has no history. Switching tabs, opening the board, a
file, the explorer or the palette changes in-memory state only, so the
browser's Back button leaves the app and a reload forgets where you were
(only the active tab and each tab's file survive, through `localStorage`).

**Success looks like:**
- Back and Forward (browser buttons, gestures, mouse buttons, and in-app
  keybindings) walk through the places you have been: tab, board, file and
  line, explorer, palette.
- A reload lands you exactly where you were.
- The URL is the source of truth for the current place. Every interaction
  that moves you is a navigation; one handler applies it.

**Non-goals:**
- Links shared between browsers or browser tabs. Two app tabs on one daemon
  fight over terminal sizes; modifier clicks stay in the same page.
- The About and New card dialogs in history (they are transient forms).
- Scroll positions of the board or the explorer.

## Decisions

- **URL-first on the Navigation API** (`window.navigation`), not the History
  API. Its one `navigate` event covers link clicks, `navigation.navigate()`
  and Back/Forward, so there is no click interception and no separate
  `popstate` path. Baseline in all major browsers since early 2026, which is
  fine for an app the user opens from their own daemon.
- **No library.** Path routers (`history`, `navaid`, `page.js`) have nothing
  to route on a single page; framework routers (TanStack, wouter, `nuqs`)
  need React; Astro's router reloads the page. The work is tabsh-specific:
  the place's shape, the order to apply it in, and recovery.
- **Query string, not fragment.** The fragment carries the pairing token
  and is cleared before any request (security invariant); app state must
  not share it.

## The place and its URL

`web/src/app/nav/place.ts`, pure (no DOM), tested with `node --test`:

```ts
type Place = {
  tab: string | null;         // session id
  view: 'terms' | 'board';
  file: string | null;        // the active tab's file, as the absolute path the daemon resolved
  line: number | null;        // 1-based
  explorer: boolean;
  palette: string | null;     // open palette page id
};
fromQuery(q: URLSearchParams): Partial<Place>    // strict: unknown or bad values dropped
toQuery(p: Place, keep: URLSearchParams): string // keeps ?daemon=, leaves defaults out
merge(from: Place, patch: Partial<Place>): Place // what go(patch) navigates to
fileAction(from: Place, to: Place): 'keep' | 'adopt' | 'open' | 'close'
```

**The file when the tab changes.** Each tab keeps its own file, so a
place whose `tab` differs from the current one and has no `file` means
"whatever that tab shows" (`adopt`): the router fills in that tab's file
with a replace, and never closes it. With the same tab, no `file` means
close it. `merge` drops `file` and `line` when `patch.tab` changes and
`patch` has no `file`.

**Resolved paths.** A terminal link gives a path relative to the shell's
cwd, which changes. Once a file loads, the URL's `file` is replaced with the
absolute path the daemon resolved, so a reload after a `cd` reopens the same
file.

Examples:

```
/app?tab=7f3a                                     terminal (defaults left out)
/app?tab=7f3a&view=board                          board open
/app?tab=7f3a&file=src/main.rs&line=42&explorer=1 file at line 42, sidebar open
/app?tab=7f3a&palette=root                        palette on its root page
```

`fromQuery` drops: a `view` or `palette` id it doesn't know, a `line` that
isn't a positive integer, `line` without `file`, and any value over a length
limit (`file` 4096 characters, others 128).

**The URL is the truth, with two exceptions:**
- Applying `explorer` also saves the `explorerOpen` setting when it differs,
  so the preference still follows the user across browsers.
- The other tabs' files stay in `files/remember.ts`; the URL holds only the
  active tab's.

**Push or replace:**

| Change | How |
|---|---|
| Switching tabs | push |
| Closing the active tab | replace, like a tab closed elsewhere (a push would leave a Back entry onto a gone tab) |
| Opening or closing the board | push |
| Opening a file, jumping to a line from a terminal link | push |
| Closing a file | push |
| Opening or closing the explorer | push |
| Opening the palette | push |
| Changing the palette page | replace |
| The cursor line moving while you edit | replace |
| Fixes caused by the daemon (a tab closed elsewhere, a file gone) | replace |

**Closing the palette** with Esc or an outside click: if the current entry
is the one that opened it, `navigation.back()`; otherwise replace with
`palette: null`. Back never brings back a palette you already dismissed.

**Moving from inside the palette** (an item that opens the board, the
explorer, closes a file…): `go()` with a push while the current entry is
the one that opened the palette turns into a replace with `palette: null`.
The palette's entry becomes the destination, so Back goes to where you were
before the palette, never back into it. Every push clears `palette` unless
the patch sets it.

## The router

`web/src/app/nav/router.ts`. `nav/` sits at the bottom of the dependency
chain (`nav` → `daemon` → …) and imports no feature; features register
with it, like `onApply`.

```ts
go(patch: Partial<Place>, how: 'push' | 'replace' = 'push'): void
here(): Place
onPlace(step: 'tab' | 'view' | 'file' | 'explorer' | 'palette',
        apply: (to: Place, from: Place, signal: AbortSignal) => void | Promise<void>): void
startRouter(fallback: Partial<Place>): Promise<void>
```

**One `navigate` handler.** For a same-document navigation that only
changes the query, it calls `e.intercept({ focusReset: 'manual' })`, then
runs the registered steps in a fixed order: **tab → view → file → explorer →
palette**. Focus is the steps' (the tab's terminal, the file's editor); the
browser's default reset would drop the keyboard on the page after every move
that focuses nothing (amended after a bug report). Each step
compares `to` with `from` and does nothing when its part is unchanged.

| Step | Registered by | Does |
|---|---|---|
| tab | `sessions` | `activate()` (unchanged inside; its callers switch to `go({ tab })`) |
| view | `board` | shows or hides the board |
| file | `files/open.ts` | opens or closes the active tab's file, goes to the line; focuses only for a user move, as `restore()` does today |
| explorer | `explorer` | opens or closes the sidebar; saves `explorerOpen` if it differs |
| palette | `palette` | `showModal()` and the page, or `close()` |

**Overlapping navigations:** a newer navigation aborts the older one's
`signal`. A step still awaiting (a file load) drops its result; `signal`
feeds the pane's existing per-tab `seq` guard.

**A place that can't be applied** is fixed with a replace, and the rest
still applies:

| Case | Result |
|---|---|
| Unknown or closed tab | the first shown tab |
| No tabs | `tab` dropped, the empty screen |
| File can't be read | `file` and `line` dropped, the pane stays closed, no error |
| `line` past the end | clamped by the editor, as now |

**Unsaved edits:** leaving a dirty file in the same tab asks
`confirmDiscard`; switching tabs doesn't (each tab keeps its own file). On
Cancel:
- push or replace: `e.preventDefault()`, nothing moves;
- Back/Forward: `e.preventDefault()` when `e.cancelable`; otherwise, once
  the move has happened, `navigation.traverseTo(previous.key)` returns
  without losing forward entries.

**Changes from the daemon:** when the active tab is closed elsewhere,
`removeSession` calls `go({ tab: neighbour }, 'replace')`.

**Triggers:** every interaction that moves you calls `go()`: tab and
card clicks, the board button, explorer rows, keybindings, drag and drop,
terminal links, palette commands, `/` search. No element becomes an
`<a href>` (amended while planning): tabs and board cards are draggable,
middle-click on a tab already closes it, and explorer rows are drawn by
`@pierre/trees`. So modifier clicks need no special handling, and no click
can open a second copy of the app.

**Startup:** `main.ts` still waits for the daemon and `sync()`, then calls
`startRouter({ tab: savedActive(), … })` instead of its final `activate()`.
The router merges the URL over the fallback, applies it, and writes it
back with a replace. `go()` calls made before then are queued.

## Keybindings and palette

- New settings `keyBack` and `keyForward` in `settings/keys.ts`,
  rebindable and listed in the palette's keybinding pages. ⌃- can't be a
  default (amended while planning): `comboProblem` keeps Ctrl+key without
  Shift for the shell, and ⌃- is readline's undo. Presets, first is the
  default:
  - Mac: Back `ctrl+shift+Minus`, `meta+BracketLeft`; Forward
    `ctrl+shift+Equal`, `meta+BracketRight`.
  - Others: Back `alt+shift+ArrowLeft`, `ctrl+alt+shift+ArrowLeft`;
    Forward `alt+shift+ArrowRight`, `ctrl+alt+shift+ArrowRight`.
- Caught in the capture phase like ⌘B, so they work from the terminal and
  the editor; they call `navigation.back()` / `forward()` and do nothing
  when `canGoBack` / `canGoForward` is false.
- Palette entries "Go back" and "Go forward", greyed out on the same
  conditions.

## Security

- **New invariant:** a URL can only select something that already exists:
  a tab, a file to view, a panel to show. It never opens a tab, runs a
  command, sets a `cwd` or saves a file. A link from another site to
  `tabsh.localhost/app?file=…` can only show the user a file they can
  already see; HTML previews keep their sandbox. Applying `explorer` writes
  only the `explorerOpen` boolean.
- **Referrer:** file paths are now in the URL. The daemon already sends
  `Referrer-Policy: no-referrer` (`src/web/pages.rs`), and the hosted page's
  `strict-origin-when-cross-origin` (`web/public/_headers`) sends only the
  origin cross-site. No header changes; add a test in `pages.rs` pinning
  `no-referrer`.
- The token stays in the fragment and is cleared before any request, as
  today; the router never reads the fragment.

## Testing

**Unit** (`nav/place.test.ts`): `toQuery` / `fromQuery` round-trip; defaults
left out; `?daemon=` kept; bad input dropped (unknown `view` / `palette`,
`line=0`, `line=-3`, `line=abc`, `line` without `file`, oversized values);
`merge` rules.

**End to end** (`web/e2e/navigation.spec.ts`, existing daemon fixture):
1. Tab A → tab B → board; Back twice: A's terminal; Forward twice: the board.
2. Open a file from a terminal link at line 42, reload: same tab, file, line.
3. Open the palette, Back: closed. Open, Esc, Back: the place before the
   palette, no dead step.
4. Toggle the explorer, Back: closed, and the setting saved.
5. Edit a file, Back, Cancel the prompt: still on the file with the edit;
   Forward still works.
6. Close the active tab from another client, Back to it: a shown tab, and
   the URL fixed.
7. The Back keybinding with the terminal focused goes back.
8. A tab switch, then a `cd` and a reload: the same file reopens (resolved path).

The existing `board`, `explorer*` and `tab-groups` specs pass unchanged;
a failure there points to a call site that still moves state directly.

## Docs

`docs/architecture.md`:
- a `nav/` row (`place.ts`, `router.ts`) and its place at the bottom of the
  dependency chain;
- the rule: only the router changes the active tab, view, file, explorer or
  palette; everything else calls `go()`;
- the new security invariant above.
