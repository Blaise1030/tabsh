# Board views: saved filters with a small query language

## Why

The board's Filter today is one unnamed filter: checked tags (any of them)
and checked folders (any of them), kept in this browser. You can't exclude a
tag, require several tags, mix and/or, or keep more than one filter and switch
between them. People want to save a filter under a name and pick it again
later from a list, the way they pick tags, in both the columns and the list
layout. Linear and Jira are the reference; a simple query language is welcome.

## Goals

- Write a filter as a short query: include, exclude, and, or, brackets.
- Save it as a named **view**; list the views and switch between them in one
  click, like ticking a tag.
- Works the same in the columns and list layouts.
- The quick checkboxes keep working for people who never type a query.

## Non-goals

- Storing views in the daemon or syncing them across browsers or devices.
  Views live in this browser, like tags (`tabsh.tags`).
- Putting the view in the URL, or Back/Forward between views.
- A layout (columns or list) per view.
- Searching card titles, prompts or notes.
- Jira-scale queries: dates, functions, sorting, `ORDER BY`.
- Sharing views, or a `tabsh list --query` CLI flag (possible later).

## Anti-goals (a failure even if it works)

- Cards seem to vanish: a filter is on and nothing on screen says so. The
  active view or query must always be visible while it hides cards.
- A query is needed for the basics: ticking a tag must still filter.
- A typo wipes the board: a half-typed or invalid query must not blank it.

## Approaches considered

1. **Query box (picked).** A query field in the Filter menu, with
   autocomplete; Save as view names it. The tag/folder checkboxes stay and
   edit the query. Expresses everything (and, or, not, brackets). Small to
   medium.
2. Linear-style condition builder: rows "Tag · any of / all of / none of ·
   [tags]" and a match-all/any switch. Friendlier, but no brackets, so it
   can't say "(A and B) or C", and more UI to build.
3. Both, editing one view. Most expressive and friendliest, but the largest.

The user picked 1.

## The query language

```
tag:ide (tag:bug or tag:urgent) -tag:wip folder:~/app status:"needs input"
```

| Piece | Meaning |
|---|---|
| `tag:x` | The card has tag `x` (exact, ignoring case) |
| `folder:x` | The card's folder is `x` or inside it. `x` may be a full path or start with `~` (as `shortPath` shows it) |
| `status:x` | The card's status, by name or id, ignoring case: `backlog`, `"in progress"` or `in_progress`, `"needs input"`, `completed`, `archived` |
| space, or `and` | Both sides must match |
| `or` | Either side matches |
| `-term`, `not term` | The term must not match (also before brackets: `-(…)`) |
| `( … )` | Grouping |
| `"…"` | A value with spaces: `tag:"two words"` |

- Precedence: `not` binds tightest, then `and`, then `or`. So `a b or c` is
  `(a and b) or c`.
- Keywords (`and`, `or`, `not`) and field names are case-insensitive.
- An empty query matches every card.
- An unknown field or a bare word is an error with a hint
  ("Unknown term `bug`. Did you mean `tag:bug`?"). Unbalanced brackets or a
  dangling `or` are errors too.
- An invalid query shows its error under the field and the board keeps showing
  the last valid query's cards.
- **When typing filters** (builder's call): the board updates after a short
  pause in typing (about 300 ms), and at once on Enter, on picking an
  autocomplete item, a checkbox or a view. A last term that is still being
  typed (the caret at its end) and whose value matches no tag, folder or
  status in use is left out until it does, so `tag:b` on the way to
  `tag:bug` doesn't blank the board.
- The chip always describes the filter actually applied, not half-typed text.

## Views

A view is `{ id, name, query }`. Views are listed in the order they were
made. A view doesn't store a layout: columns or list stays the shared
`boardLayout` setting, switched by the Board button and ⌘B as today, so
picking a view never changes another device's board (user's call).

**The Filter menu** (opened from the Filter icon, as today):

```
┌────────────────────────────────┐
│ Views                          │
│  ✓ My bugs                  ⋯  │   ⋯: Rename, Delete
│    Frontend, not WIP        ⋯  │
│ ────────────────────────────── │
│ tag:bug -tag:wip_              │   query field, autocomplete
│ Unknown term "wip". Did you…   │   error line, only when invalid
│ [Save as view] [Update "My…"]  │
│ ────────────────────────────── │
│ Tags     ☑ bug  ☐ ide  ☐ wip   │   today's checkboxes and search
│ Folders  ☐ ~/app  ☐ ~/web      │
└────────────────────────────────┘
```

- Clicking a view applies its query. Clicking the ticked view again clears
  it, back to every card.
- **Save as view** asks for a name inline and saves the current query as a
  new view, which becomes active.
- **Update "<name>"** appears only when the active view's query has been
  changed; it overwrites that view.
- Editing the query while a view is active doesn't change the view until
  Update. The view shows as modified meanwhile.
- **Rename** edits the name inline. **Delete** removes the view at once (no
  confirm); if it was active, the query it had stays as an unsaved query.
- **Autocomplete** under the field: field names (`tag:`, `folder:`,
  `status:`) while typing a word, then values after a field (tags in use,
  folders in use, statuses), filtered by what's typed. ↑↓ and Enter or Tab
  pick, Esc closes the list (a second Esc closes the menu).
- **Checkboxes** edit the query text. Ticking a tag appends `tag:x` (and);
  unticking removes that term. A box is ticked when the query has `tag:x` as
  a plain top-level term. Folders work the same with `folder:x`. Ticking two
  tags therefore means both, not either (today it means either); for either,
  type `tag:a or tag:b`.

**Next to the Filter icon**, while a view or a non-empty query is on: a chip
with the view's name (or "Custom filter" for an unsaved query), with a dot when
modified. Clicking it opens the Filter menu. The Filter icon stays
`aria-pressed` while any filter is on, as today.

**The palette (⌘K)** lists one entry per view ("View: <name>") and
"Clear view" while one is active.

## Storage

- `tabsh.boardViews` in `localStorage`: the list of views. Read with a
  `parseViews` that drops anything malformed (as `parseFilter` does now).
- `tabsh.boardFilter`: now `{ query, viewId }`, the current query and the
  active view (or null).
- **Migration:** an old `{ tags, folders }` value is turned into a query:
  `(tag:a or tag:b) (folder:x or folder:y)`, leaving out empty groups, with
  no active view. Nothing the user had is lost.
- Other open tabsh pages pick up changes to the **saved views** through the
  `storage` event, as tags do. The current query and active view stay per
  page, as the filter does today, so typing in one window never rewrites
  another's (builder's call).
- What's saved as the current query is the last valid one applied, never
  invalid text, so a reload shows the same cards (builder's call).
- Queries and views are never rewritten when a tag falls out of use (today's
  filter drops unused tags; a saved view keeps them) (builder's call).
- Ticking a box when the query's top level is an `or` wraps the query in
  brackets first, so `tag:a or tag:b` plus `tag:c` becomes
  `(tag:a or tag:b) tag:c` (builder's call). Folder values are written as
  `shortPath` shows them, quoted when they contain spaces.
- Every read and write is wrapped in try/catch; the board still works with
  storage unavailable.

## Code layout

Following `docs/architecture.md`:

- `web/src/app/board/query.ts` (new, pure, with `query.test.ts`): tokenize,
  parse to a tree, errors with a position and hint, `matches(tree, card,
  tags)`, the checkbox helpers (is `tag:x` a top-level term, add it, remove
  it), autocomplete context (which field and partial value are at the
  caret), and migration from the old filter shape. No DOM.
- `web/src/app/board/views.ts` (new, pure, with a test): the view type,
  `parseViews`, and the small updates (add, rename, delete, update).
- `web/src/app/board/model.ts`: `BoardFilter`, `parseFilter` and
  `matchesFilter` give way to the query; the board's card list filters with
  `query.ts`'s `matches`.
- `web/src/app/board/view.tsx`: the Filter menu gains the views list, the
  query field, autocomplete, the buttons and the chip. If it grows large,
  the menu moves to its own `filter-menu.tsx`.
- `web/src/app/palette/pages.ts`: the view entries, through the same `ctx`
  pattern as `toggleBoardLayout`.
- `docs/architecture.md`: the board row and the pure-files list updated.

## Checks

As in `docs/architecture.md`: `npm run check`, `npm run lint`, `npm test`,
`npm run build` (which refreshes the embedded app), and the cargo checks.
Tests cover the grammar (precedence, quotes, negation, brackets, errors and
hints), matching, the checkbox helpers, migration, and `parseViews`.

## Left to the builder

- Exact styling of the chip, the error line and the autocomplete list, within
  the existing menu styles.
- Whether the Filter menu moves to its own file.
- Error message wording beyond the hint shown above.
