# A Solid UI for tabsh

Status: proposed design, 2026-10-21. Replaces the component conventions of
`2026-10-07-vanjs-ui-design.md`; the URL navigation design
(`2026-10-07-url-navigation-design.md`) is unchanged.

## Intent

**Problem.** VanJS fixed the app's first UI problem: views were built
imperatively with `el()` and patched by hand. Two weeks and ~17k lines later,
its costs dominate:

- no JSX and no typed props, so a component's shape and its inputs cannot be
  checked;
- a hand-rolled keyed list (`ui/keyed.ts`) and disposal helper (`scoped`);
- `.val` state with no owner, no lifecycle and no cleanup, which is why five
  modules carry waits for VanJS to apply a change;
- no context, effects, transitions or suspense, so each new feature invents
  its own wiring;
- a one-maintainer, ~1.8 KB library as the foundation of a 17k-line app.

**Success looks like:**

- Every view is a typed Solid component in TSX; props are typed; lists are
  `<For>`, conditionals `<Show>`.
- Feature-owned state is signals with Solid's ownership; `keyed()`, `scoped()`
  and every "wait for VanJS" microtask are gone.
- Behaviour is unchanged: all 29 Playwright specs pass unedited, and the
  daemon, CSS, selectors, CSP and security invariants are untouched.
- First load (page HTML plus every script statically reachable from the entry)
  grows by at most 8 KB gzipped.

**Non-goals:**

- Solid Router. `nav/router.ts` is framework-free, ordered, abortable and
  covered by e2e; it stays.
- Stores, context or a global state tree. Features keep owning their state;
  the router's steps keep assigning it.
- A DOM test library. Node tests stay pure; Playwright stays the parity gate.
- Reorganising features or splitting the large view files.
- Rewriting xterm, CodeMirror or `@pierre/trees`; they stay imperative inside
  hosts created once.
- Any behaviour, CSS, selector, URL or daemon change.

## Decisions

- **`solid-js` 1.9.x with `@astrojs/solid-js` 7.1.x.** The integration brings
  `vite-plugin-solid` 2.11 and Vite 8, which matches Astro 7.3.5's Vite. It is
  the official path and configures the JSX transform and dependency
  optimisation; no island or hydration feature is used. Considered: wiring
  `vite-plugin-solid` by hand (same compiler, more config to own) and keeping
  VanJS (rejected: the ergonomics are the point).
- **No `solid-devtools`.** It is an optional peer of the integration.
- **Feature-owned signals, not stores.** `createSignal` for lists, ids,
  strings, booleans and objects replaced whole. The `Session` record keeps its
  shape — a live object holding xterm, its socket and its coalescer, never
  replaced — but each changing field becomes an accessor plus a setter on the
  record (`s.name()` / `s.setName(v)`). `createMutable` was considered and
  rejected: it proxies the record, and `sides` holds session objects whose
  identity must survive (comparisons and resource lookups use `===`).
- **Custom router kept.** Steps still run in order tab → view → drawer → file
  → explorer → palette, and only the router moves.
- **Temporary interop.** `ui/interop.ts` bridges a migrated feature to an
  unmigrated one while both runtimes coexist on the branch. It is deleted
  before the final commit; nothing in the design depends on it.
- **One branch, one PR** (`feat/solid-ui`), cut from the commit that lands this
  spec. Every commit compiles and leaves the app working; e2e runs at each
  slice. The PR is not merged until every check below passes.
- **Unused dependencies go.** `vanjs-core` leaves with the last VanJS module;
  `react` and `react-dom` (unused since `16ee973`) go in the foundation
  commit.

## Build and mount

- `web/astro.config.mjs`: add `integrations: [solid()]`.
- `web/tsconfig.json`: `"jsx": "preserve"`, `"jsxImportSource": "solid-js"`
  on top of `astro/tsconfigs/strict`.
- `web/src/app/main.ts` mounts with
  `render(() => <App />, document.getElementById('app')!)` and runs the
  feature wiring inside one `createRoot`, so computations made outside
  components have an owner.
- `web/src/pages/app/index.astro` keeps its `<head>` and its
  `<div id="app">`; only the module script's import target changes name, not
  behaviour. PWA, SRI, CSP and `web/pages.rs` are untouched.
- `npm run build` still copies `dist/app/index.html` to `src/app.html` and
  `dist/_astro` to `src/app-assets`; both are rebuilt and committed in the
  last slice.

## State

**Rules.**

- A feature owns its signals and exports the accessor and the setter
  (`export const [sessions, setSessions]`). A collection is replaced whole.
- The `store` facade in `sessions/store.ts` stays as a convenience
  (`store.sessions`, `store.active`), now reading accessors.
- Reads happen in JSX expressions, effects and event handlers, never at the
  top of a component body expecting later updates.
- `batch` is used where several signals must change before observers see them
  (tab activation: active, noTab, screen).
- Long-lived feature computations live in components or in `main.ts`'s root;
  a module-level `createEffect` is allowed only inside that root.
- `Session` fields: `name`, `bell`, `unread`, `card`, `tags`, `repo`,
  `leaving`, `sides` become accessors with setters. Non-reactive fields
  (`term`, `fit`, `el`, `ws`, `out`, `stream`, `pinned`, `parent`) stay plain.
- `Card` objects are plain data replaced whole.

**Timing.** The seven waits below exist only because VanJS applied DOM
changes later. Each is replaced by the lifecycle that actually guarantees the
node, and each is pinned by the e2e spec named:

| Site | Today | Replacement | Pinned by |
|---|---|---|---|
| `store.activate` | `queueMicrotask` then scroll, fit, focus | post-render effect on `screen()` | `tabs`, `replay` |
| `store.reveal` | `queueMicrotask` then fit, focus | post-render effect on `screen()` | `side-terminals` |
| `board.showBoard` | `queueMicrotask` then fit, focus | effect on `shown()` / `drawer()` | `board` |
| board drawer focus | `queueMicrotask` | effect on `drawer()` | `board`, `pane` |
| `files/open.ts` layout | `van.derive` + `queueMicrotask` | effect on `paneShown()` | `pane` |
| `files/pane.ts` `applied()` | await a microtask after setting states | the pane's own effect after its view state settles | `pane`, `editor-comments` |
| `explorer/explorer.ts` `load` | `await Promise.resolve()` | draw the tree from the ref/effect that follows the host's state | `explorer`, `explorer-live` |

**Interop.** Two functions, ~10 lines, used only at a seam:

- `fromVan(state)` — an accessor pushed by `van.derive`, memoised per state
  object so every reader shares one derive.

`toVan` is deliberately not built: no Solid state needs to be read by a VanJS
view under this order, and adding it would put an async effect under legacy
code.

An adapter may live for one slice only. The final slice greps them out.

## Components

- A component is a function returning JSX, in a `.tsx` file, with typed props.
- Props are not destructured (that breaks reactivity); use `splitProps` when
  a component forwards some.
- Hosts: xterm, CodeMirror and `@pierre/trees` are created once via `ref` and
  `onMount`, never inside a reactive expression. `onCleanup` releases
  observers, sockets and timers the component own.
- Lists use `<For each={...}>`; keys are object identity, which is stable for
  sessions and cards. Where a list is keyed by a field, it is mapped to stable
  wrapper objects first. `<Show>` replaces `hidden`/`if` helpers only where
  the element must leave the DOM; `hidden` attributes stay for CSS/layout
  parity.
- **Event delegation.** Solid delegates `click`, `input`, key, mouse, pointer
  and touch events to `document`. Thirty-four call sites use
  `stopPropagation` to keep a child's event from reaching an ancestor (menus,
  card buttons, drag handles). Those use the native `on:click` / `on:keydown`
  form, which attaches to the element, instead of the delegated
  `onClick`/`onKeyDown`. An element-level capture handler uses `oncapture:`;
  the window-level capture listeners in the board stay `addEventListener`.
  All other handlers keep the delegated form. Pinned by `board`, `dialogs`,
  `palette`.
- Menus that live inside a component (`move-menu`, `tags-submenu`, the
  new-card filter popover) use `<Portal>` so Solid owns them. The tag
  popover is opened imperatively from a tab and keeps the host it appends to
  `document.body`, rendered by `render` and disposed on close.
- Exit animations: `ui/presence.tsx` holds a key's node while it animates out
  (`animationend` or a timeout) and cancels the exit if the key returns. Its
  list arithmetic lives in `ui/presence.ts` with a `node --test` test. It
  replaces `keyed()`'s `exit` option and `scoped()`'s disposal.
- `ui/icons.tsx` returns JSX `<svg>` elements; no markup strings.
- `ui/no-markup.test.ts` gains `.tsx` in its source walk, so the rule keeps
  covering components.
- The editor, tree and QR stay behind `import()`; the daemon's
  `entry_script_does_not_bundle_the_editor` stays green.
- Basecoat keeps working unchanged: its MutationObserver initialises dialogs
  and the command menu added later, and the palette still calls `refresh()`
  after its item list changes.

## Layout

| Path | Change |
|---|---|
| `ui/app.tsx`, `ui/gate.tsx`, `ui/icons.tsx` | VanJS → Solid |
| `ui/presence.tsx`, `ui/presence.ts`, `ui/presence.test.ts` | new |
| `ui/interop.ts` | new, temporary; deleted in the last slice |
| `ui/keyed.ts`, `ui/keyed.test.ts` | deleted |
| `sessions/tab.tsx`, `groups.tsx`, `session-bar.tsx`, `keybar.tsx`, `tags.tsx`, `terminal.tsx` | VanJS → Solid |
| `sessions/store.ts`, `tabs.ts`, `labels.ts`, `activity.ts`, `bell.ts`, `coalesce.ts`, `split.ts`, `order.ts`, `reconnect.ts`, `heartbeat.ts`, `gestures.ts`, `extra-keys.ts`, `touch.ts` | stay `.ts`; state accessors where they own state |
| `board/view.tsx`, `new-card.tsx`, `move-menu.tsx`, `tags-submenu.tsx`, `folder-picker.tsx` | VanJS → Solid |
| `board/model.ts`, `events.ts`, `status.ts`, `glyph.ts`, `folders.ts`, `notify.ts` | stay `.ts` |
| `palette/palette.tsx`; `palette/pages.ts` | palette → Solid; pages stay data |
| `explorer/sidebar.tsx`, `view.tsx`; `explorer/explorer.ts` | chrome and tree host → Solid; state stays |
| `files/pane.tsx`, `notes.tsx`, `open.tsx`; `editor.ts`, `comments.ts`, `api.ts` | pane, notes, view step → Solid; editor stays imperative |
| `welcome/view.tsx`; `welcome/steps.ts` | dialog → Solid; steps stay data |
| `remote/*`, `pwa/*`, `demo/*` | unchanged; the demo starts the same `main.ts` |
| `main.ts` | mounts Solid, owns the root, keeps the wiring order |
| `web/package.json`, lock | add Solid; remove VanJS, React, React DOM |
| `docs/architecture.md` | Components, State and Timing rules; `ui/` row; pure-file list |

Modules that build markup become `.tsx`; modules that only hold state, API
calls or imperative hosts stay `.ts` and keep their Node tests.

## Order of work

Each slice ends with `npm run check`, `npm run lint`, `npm test`, the listed
e2e specs, and leaves the app usable. The full suite runs at slices 1, 4, 8.

1. **Foundation and shell.** Deps, Astro/TS config, `ui/app.tsx` rendering the
   same ids and classes as today, `main.ts` render + root, `ui/icons.tsx`,
   `ui/presence.*`, `ui/interop.ts`, `no-markup` widened to `.tsx`.
   Features still initialise into their containers. e2e: `smoke`,
   `navigation`, `welcome`.
2. **Sessions.** `terminal.tsx`, `session-bar.tsx`, `keybar.tsx`, `tab.tsx`,
   `groups.tsx`, `tags.tsx`. The VanJS states stay canonical; Solid reads
   them through `fromVan`.
   e2e: `tabs`, `tab-groups`, `side-terminals`, `replay`, `resume`,
   `inactive-terminal-pause`, `active-terminal-coalesce`, `touch`,
   `spawn-under-load`, `attach-under-load`, `flush-under-load`.
3. **Board.** `view.tsx`, `new-card.tsx`, `move-menu.tsx`,
   `tags-submenu.tsx`, `folder-picker.tsx`; remove the board adapters.
   e2e: `board`, `providers`, `tooltips`.
4. **Palette, dialogs, gate.** `palette.tsx`, `about`, `new-card` dialog,
   `gate.tsx`; palette pages stay data. e2e: `palette`, `dialogs`,
   `providers`, `remote`.
5. **Explorer.** `sidebar.tsx`, `view.tsx`, `explorer.ts` state.
   e2e: `explorer`, `explorer-search`, `explorer-actions`, `explorer-chrome`,
   `explorer-follow`, `explorer-live`.
6. **Files.** `pane.tsx`, `notes.tsx`, `open.tsx`; editor host.
   e2e: `pane`, `editor-comments`.
7. **Welcome and remote.** `welcome/view.tsx`, remote pages.
   e2e: `welcome`, `remote`.
8. **State flip.** The remaining shared states and every `Session` field
   become signals with accessors and setters; every `.val` call site moves in
   one mechanical pass, by directory, and the `fromVan` imports go. Full e2e
   suite. This is the only slice that changes a state's shape, and it lands
   once no VanJS consumer is left.
9. **Cleanup.** Delete `interop`, `keyed.*`, VanJS and React from
   `package.json`/lock; grep for `vanjs-core`, `van.`, `.val`, `scoped`,
   `State<`; rewrite `architecture.md`; `npm run build`; commit
   `src/app.html` and `src/app-assets/`; full suite and cargo checks.

**State order.** Keeping VanJS canonical while the UI moves means an
unmigrated feature is bit-identical through every slice, and `fromVan` is a
synchronous read rather than a Solid effect pushing into VanJS. The cost is
one mechanical pass at slice 8, covered by the full e2e suite. The
alternative — signals first, `toVan` mirrors for unmigrated VanJS — puts an
async hop under every legacy view for the length of the migration and is why
it was rejected.

**Risk.** The largest behaviour surfaces are the tab strip (slice 2), the
board's drag and menus (slice 3) and the file pane (slice 6). If work stops,
it stops after a slice whose e2e group is green; the interop layer keeps the
app runnable for whichever slices remain.

## Errors

- Components add no error boundary: an error in an effect or handler reaches
  `window.onerror` as it does today. Daemon failures keep the connection gate
  and the existing messages.
- A daemon event for a session already gone drops the entry; `<For>` removes
  the node. No special case.
- A lazy `import()` failure keeps today's behaviour (the pane or tree reports
  it through the feature's message state).

## Security

The invariants in `docs/architecture.md` are unchanged and must not weaken:

- No `innerHTML`, `outerHTML` or `insertAdjacentHTML` in `web/src/app`, now
  including `.tsx`; the source test enforces it. JSX compiles to DOM calls.
- User text stays a child string or an attribute value; JSX never builds
  markup from strings.
- Preview sandboxes unchanged: HTML `allow-scripts allow-popups`; Markdown and
  SVG `sandbox=""`; images and PDFs from `blob:` URLs.
- CSP unchanged: Solid sets handler properties; no inline script, no
  `on…=` attributes, no `eval` in the production build.
- Token handling, the URL-selects-never-acts rule and the demo's isolation are
  untouched.
- The editor and tree stay lazy; the daemon test enforces it.

## Testing

- **E2E:** all 29 specs pass unedited. The only permitted edit is a selector
  that reaches into removed VanJS internals, with a comment saying why; none
  is expected.
- **Unit:** `ui/presence.test.ts` for exit/return/order; every existing pure
  test stays and passes. `ui/no-markup.test.ts` scans `.tsx` too.
- **Bundle:** after the final build, measure gzipped `src/app.html` plus every
  chunk statically reachable from the entry (the same walk as
  `entry_script_does_not_bundle_the_editor`); record before/after in the PR.
  Budget: +8 KB.
- **Manual parity:** a phone-sized pass over touch gestures, the key bar, the
  welcome dialog and typing sounds, which e2e covers only partly.

## Done when

- No `vanjs-core`, `react` or `react-dom` in `web/package.json` or the lock;
  no import of `vanjs-core` or `van.` in `web/src`.
- `ui/keyed.ts`, `scoped`, `ui/interop.ts` and every "wait for VanJS"
  microtask are gone.
- Every view is a `.tsx` Solid component; pure modules are unchanged `.ts`.
- `npm run check`, `lint`, `test`, `build`, `test:e2e`; `cargo fmt --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`
  all pass.
- First load within +8 KB gzipped.
- `docs/architecture.md` documents the Solid conventions and the state and
  timing rules; the pure-file list is current.
- `src/app.html` and `src/app-assets/` are rebuilt and committed.

## Rollback

The work lands as one merge. Reverting that merge restores the VanJS app; no
runtime flag or parallel page exists.
