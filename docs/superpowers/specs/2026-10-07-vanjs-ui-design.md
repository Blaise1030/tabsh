# Declarative UI with VanJS

Status: approved design, 2026-10-07. Builds on the URL navigation design
(`2026-10-07-url-navigation-design.md`) and starts after it merges.

## Intent

**Problem:** the app's UI code is imperative and hard to read. A view is
built with `el()`, then patched line by line (`dataset`, `setAttribute`,
`innerHTML` for icons, `on…` handlers), and every change calls a
`render()` or toggles `hidden` and classes by hand. You cannot see the
shape of the markup without reading the whole function.

**Success looks like:**
- Every view reads as one expression shaped like its markup.
- State changes update the DOM by themselves: no `render()`, no manual
  `hidden`/class/`aria-*` syncing for state a feature owns.
- `index.astro`'s body is one mount point; the whole UI is components.
- Behaviour is unchanged: every existing e2e spec passes unedited.

**Non-goals:**
- Bundle size. The first load is the app's own code; VanJS adds about
  2 KB gzipped and removes nothing.
- Rewriting xterm, CodeMirror or `@pierre/trees`. They stay imperative
  inside containers the components hand them.
- Tailwind. Basecoat stays as it is, from the CDN.
- Changing the router. It keeps its ordered async steps and abort signal.

## Decisions

- **VanJS (`vanjs-core`), bundled from npm**, like CodeMirror and
  `@pierre/trees`. About 1.8 KB gzipped, its own types, no `innerHTML`,
  `eval` or `new Function`. It imports in Node without a DOM, so pure
  modules may import it without breaking the `node --test` rule.
  Considered: lit-html (templates through `<template>`, which strains the
  no-`innerHTML` rule), Preact + htm and Solid (more framework than the
  app needs, Solid adds a compiler).
- **Everything moves, the page shell included.** `index.astro` keeps the
  `<head>` (metas, fonts, SRI-pinned CDN scripts, the CSS import) and a
  body of `<div id="app">` plus the module script.
- **Features own their state.** Each feature exports its `van.state`s;
  the router's steps assign them; components derive from them. No global
  store: it would fight the router's step order and couple every feature
  to one file.
- **No `vanjs-ext`.** Its `list()` brings proxy-based reactive objects
  and a second state style. A small local `keyed()` covers lists.
- **One branch, one PR**, in the commit order below.

## Layout

`main.ts` mounts the app with `van.add(app, App())`. Every element id in
today's `index.astro` survives, so `app.css` and e2e selectors still
match.

| File | Holds |
|---|---|
| `ui/icons.ts` | Every SVG icon as SVG-namespace tags: today's inline SVGs in `index.astro`, `board/glyph.ts`'s glyphs, the board's `FOLDER` |
| `ui/keyed.ts` | `keyed(list, key, render)`: one node per key; adds, removes and reorders without rebuilding |
| `ui/app.ts` | `App()`: the tab bar, the workspace containers, the empty state, and every dialog |
| `ui/gate.ts` | The offline, Safari and pair screens |
| `sessions/` | `Tab`, `TabStrip`, the group labels (`#tab-template` goes) |
| `board/view.ts` | `Board`, `Column`, `Card` |
| `palette/` | `Palette`, its page items |
| `files/pane.ts` | The pane's chrome: header, buttons, preview `iframe`/`img`; the CodeMirror host |
| `explorer/` | The sidebar's root, note and message lines; the `@pierre/trees` host |
| `board/new-card.ts`, `ui/about.ts` | Their dialogs |

**Dependencies:** the one-way chain is unchanged. `ui/app.ts` composes
every feature's components, so it sits at the top beside `main.ts`, and
no feature imports it. `nav/` imports neither `van` nor any feature.

**State each feature exports** (names indicative; the plan fixes them):
`sessions.list`, `sessions.active`, `board.shown`, `explorer.open`,
`palette.page`, and the pane's per-tab file view.

## How state reaches the DOM

**Conventions:**
- A component is a function returning a node: `Card(s)`, `Column(status)`.
  Static values pass as values; reactive ones as a `State` or a
  `() => value`, which VanJS binds.
- **States are replaced, never mutated.** A list state gets a new array;
  a session change replaces the session object. VanJS only sees `.val =`.
- Attributes go in one object at creation: `class`, `data-*`, `aria-*`,
  `onclick`. No `dataset` or `setAttribute` after the fact.
- **User text is a child string or an attribute value**, which VanJS
  writes as text nodes and `setAttribute`. "Names and notes are user
  text: textContent only" and "file content never goes through
  `innerHTML`" hold by construction.

**Lists** go through `keyed()`, so focus, a drag in progress and the tab
strip's scroll survive a change. Used by the tab strip, board columns and
the palette menu.

**Flow** (a board card click):
1. The click calls `go({ view: 'terms', tab: s.id })`.
2. The view step sets `board.shown.val = false`; the tab step sets
   `sessions.active.val = s.id`.
3. The board's `hidden`, the board button's `aria-pressed`, and the tab's
   `aria-selected` and `.active` update themselves.

Daemon events (status changes, sessions closed elsewhere) replace entries
in `sessions.list`; cards and tabs follow.

**Imperative islands:** the xterm host per session, the CodeMirror host
and the `@pierre/trees` host are created once by their component and
handed to the library; they never re-render. Drag-and-drop pointer maths
stays as code; it moves nodes through `keyed()`'s order.

**Basecoat:** its runtime (`basecoat.min.js`, `command.min.js`) watches
`document.body` with a `MutationObserver` and initialises components
added later, so dialogs and the command menu built by VanJS keep their
behaviour. The palette's keyboard navigation and filtering inside the
menu stay Basecoat's. `command.js` caches the menu's items when it
initialises, so, as `palette.ts` does today, the palette calls
`#palette-command`'s `refresh()` after its item list changes (once per
`keyed()` update, not per item).

## Order of work

One branch off `main` after navigation merges. Each commit leaves the app
working and the e2e suite green.

1. **Foundation:** `vanjs-core`, `ui/icons.ts`, `ui/keyed.ts` with its
   test, `architecture.md` rows and rules.
2. **Shell:** `ui/app.ts`, `ui/gate.ts`; `index.astro`'s body becomes
   `<div id="app">`. Features still find their containers by id.
3. **Sessions:** `sessions.list` / `sessions.active` states; `Tab`,
   `TabStrip`, group labels; `#tab-template` deleted.
4. **Board:** `board.shown`; `Board`, `Column`, `Card`; `render()` gone;
   the view step only sets `shown`.
5. **Palette:** `palette.page`; page items through `keyed()`.
6. **Explorer chrome:** `explorer.open`; root, note and message lines.
7. **File pane:** header, buttons, preview choice; sandbox attributes and
   `blob:` URLs written once in the component.
8. **Dialogs:** About and New card.
9. **Cleanup:** `el()` deleted; `npm run build` refreshes `src/app.html`
   and `src/app-assets/`; `architecture.md` final.

**Risk:** the file pane (7) and the tab strip (3) carry the most
behaviour. If the work must stop early, it stops after 6 and stays
coherent, with `el()` left for the pane and dialogs.

## Errors

- A component that throws in a derive: VanJS logs it and keeps the old
  DOM. Components add no `try` blocks; daemon errors keep today's
  handling (the connection gate, existing messages).
- A daemon event for a session already gone: the list state drops it and
  `keyed()` removes its node. No special case.

## Security

Unchanged invariants, now enforced by construction where possible:
- No `innerHTML` in `web/src/app` after cleanup. A test greps the
  source, alongside `entry_script_does_not_bundle_the_editor`.
- Preview sandboxes unchanged: HTML in `sandbox="allow-scripts
  allow-popups"`, Markdown and SVG in `sandbox=""`, images and PDFs from
  `blob:` URLs.
- CSP and `web/public/_headers` unchanged: VanJS sets handlers as
  properties, so no `'unsafe-inline'` and no `on…=` attributes.
- Lazy loading unchanged: CodeMirror and `@pierre/trees` only through
  `import()`; the daemon's bundle test stays green.

## Testing

**End to end:** every existing spec (`board`, `explorer*`, `tab-groups`,
`replay`, `smoke`, `navigation`) passes **unedited** after every commit.
The only allowed edit is a selector into `#tab-template` internals, with
the reason in the spec.

**Unit:**
- `ui/keyed.test.ts`: add, remove, reorder; a kept key keeps its node.
- Logic pulled out of a component (a card's meta line, a tab's label)
  goes into the feature's existing pure file and its test.

No component snapshot tests and no DOM test library.

## Done when

- `el()` and `#tab-template` are gone; `index.astro`'s body is one mount
  point.
- No `render()` or manual `hidden`/class/`aria-*` syncing remains for
  state a feature owns.
- All checks pass: `cargo fmt --check`, `cargo clippy --all-targets
  --locked -- -D warnings`, `cargo test --locked`; in `web/`
  `npm run check`, `lint`, `test`, `build`, `test:e2e`.
- The first-load bundle grows by at most about 2 KB gzipped.
- `docs/architecture.md` documents the component conventions, `ui/icons.ts`,
  `ui/keyed.ts`, `ui/app.ts` and the state rule.
