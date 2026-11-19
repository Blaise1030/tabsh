# Board Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's one checkbox filter with a small query language and named, saved views.

**Architecture:** A pure `board/query.ts` parses and matches queries; a pure `board/views.ts` holds the saved views and the current query, with migration from the old filter. `board/view.tsx` swaps its tag/folder signals for a query + active view, and its Filter menu gains the views list, query field, autocomplete and a chip. The palette lists views.

**Tech Stack:** TypeScript, SolidJS (`.tsx`), `node --test`, Playwright e2e, Biome.

**Spec:** `docs/superpowers/specs/2026-11-19-board-views-design.md`

## Global Constraints

- Pure files (`query.ts`, `views.ts`) never touch the DOM; tests sit beside them as `*.test.ts` and are listed in `docs/architecture.md`'s pure-files rule.
- No `innerHTML`/`outerHTML`/`insertAdjacentHTML` (`ui/no-markup.test.ts`); user text goes in as children or attribute values.
- `localStorage` keys: `tabsh.boardViews` (views), `tabsh.boardFilter` (now `{ query, viewId }`). Every read/write in try/catch.
- Views don't store a layout; `boardLayout` stays as is.
- Only saved views sync between pages (`storage` event); the current query is per page.
- Only the last valid applied query is saved as current.
- Run `npm run build` at the end: it refreshes the committed `src/app.html` and `src/app-assets/`.

## Review Focus

1. A tag name with spaces or quotes, picked from a checkbox or autocomplete → written quoted (`tag:"two words"`), matches, unticks cleanly.
2. Typing `tag:b` on the way to `tag:bug` → board keeps the previous cards, never blanks.
3. Old `tabsh.boardFilter` `{ tags, folders }` in storage → becomes the equivalent query; nothing lost.
4. Corrupt `tabsh.boardViews` / `tabsh.boardFilter` JSON → board shows every card, no throw.
5. Ticking a box when the query's top level is `or` → wraps in brackets, precedence preserved.

Each has a test in the owning task below.

---

### Task 1: Query parser and matcher

**Files:**
- Create: `web/src/app/board/query.ts`
- Test: `web/src/app/board/query.test.ts`

**Interfaces:**
- Consumes: `Status`, `STATUSES` from `./model.ts`; `STATUS_NAMES` from `./glyph.ts` (check `glyph.ts` stays DOM-free on import; if not, copy the names into `query.ts`); `shortPath` from `./model.ts`.
- Produces:
  ```ts
  export type Field = 'tag' | 'folder' | 'status';
  export type QueryNode =
    | { kind: 'term'; field: Field; value: string; start: number; end: number }
    | { kind: 'not'; child: QueryNode }
    | { kind: 'and'; children: QueryNode[] }
    | { kind: 'or'; children: QueryNode[] };
  export interface QueryError { message: string; start: number; end: number }
  export type Parsed = { ok: true; node: QueryNode | null } | { ok: false; error: QueryError };
  export interface Subject { status: Status; cwd: string | null; tags: string[] }
  export function parseQuery(text: string): Parsed;
  export function matches(node: QueryNode | null, s: Subject): boolean;
  export function formatTerm(field: Field, value: string): string;
  ```

Grammar: `or` < `and` (explicit or by adjacency) < `not`/`-` prefix < atom (`field:value` | `( expr )`). Values: bare (up to space or `)`), or `"…"` with `\"` escape. Keywords and fields case-insensitive. Empty/whitespace → `{ ok: true, node: null }`.

Matching: `tag` exact ignoring case against any of `s.tags`. `folder`: strip a trailing `/` from the value; matches when `cwd` or `shortPath(cwd)` equals it or starts with it + `/` (case-sensitive). `status`: value lowercased, spaces → `_`, or a `STATUS_NAMES` value lowercased; unknown status is a parse error `Unknown status "x"`.

- [ ] **Step 1: Write the failing tests**

```ts
const s = (tags: string[], cwd: string | null = '/Users/me/app', status: Status = 'backlog') => ({ tags, cwd, status });
const m = (q: string, subj: Subject) => { const p = parseQuery(q); assert.ok(p.ok); return matches(p.node, subj); };

test('an empty query matches every card', () => { assert.equal(m('', s([])), true); assert.equal(m('   ', s(['x'])), true); });
test('a tag term matches ignoring case', () => { assert.equal(m('tag:Bug', s(['bug'])), true); assert.equal(m('tag:bug', s(['bugs'])), false); });
test('adjacent terms and "and" both mean both', () => {
  assert.equal(m('tag:a tag:b', s(['a'])), false); assert.equal(m('tag:a AND tag:b', s(['a', 'b'])), true);
});
test('or, not and minus', () => {
  assert.equal(m('tag:a or tag:b', s(['b'])), true);
  assert.equal(m('-tag:wip', s(['wip'])), false); assert.equal(m('not tag:wip', s([])), true);
});
test('and binds tighter than or; brackets regroup', () => {
  assert.equal(m('tag:a tag:b or tag:c', s(['c'])), true);
  assert.equal(m('tag:a (tag:b or tag:c)', s(['c'])), false);
  assert.equal(m('-(tag:a or tag:b)', s(['b'])), false);
});
test('quoted values keep spaces', () => { assert.equal(m('tag:"two words"', s(['Two Words'])), true); });
test('folder matches itself and anything inside, full or ~ form', () => {
  assert.equal(m('folder:~/app', s([], '/Users/me/app/web')), true);
  assert.equal(m('folder:/Users/me/app/', s([], '/Users/me/app')), true);
  assert.equal(m('folder:~/app', s([], '/Users/me/apple')), false);
  assert.equal(m('folder:~/app', s([], null)), false);
});
test('status by id or name', () => {
  assert.equal(m('status:"needs input"', s([], null, 'needs_input')), true);
  assert.equal(m('status:in_progress', s([], null, 'in_progress')), true);
  assert.equal(m('STATUS:Backlog', s([], null, 'backlog')), true);
});
test('errors say where and hint', () => {
  const bare = parseQuery('tag:a bug'); assert.ok(!bare.ok);
  assert.equal(bare.error.message, 'Unknown term "bug". Did you mean tag:bug?'); assert.deepEqual([bare.error.start, bare.error.end], [6, 9]);
  for (const bad of ['(tag:a', 'tag:a)', 'tag:a or', 'colour:red', 'status:soon', 'tag:', 'tag:"open']) assert.equal(parseQuery(bad).ok, false, bad);
});
test('formatTerm quotes only when needed', () => {
  assert.equal(formatTerm('tag', 'bug'), 'tag:bug');
  assert.equal(formatTerm('tag', 'two words'), 'tag:"two words"');
  assert.equal(formatTerm('tag', 'say "hi"'), 'tag:"say \\"hi\\""');
  assert.equal(formatTerm('tag', 'or'), 'tag:or');
});
```

- [ ] **Step 2: Run** `cd web && node --test src/app/board/query.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `parseQuery`, `matches`, `formatTerm` in `query.ts` (tokenizer + recursive descent). Quote a value when it contains whitespace, `(`, `)`, `"`, or is empty.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(board): a query language for filtering cards`

### Task 2: Query editing helpers, live query, migration

**Files:**
- Modify: `web/src/app/board/query.ts`
- Test: `web/src/app/board/query.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export function hasTerm(text: string, field: 'tag' | 'folder', value: string): boolean; // a plain positive top-level term (or the whole query)
  export function withTerm(text: string, field: 'tag' | 'folder', value: string): string;
  export function withoutTerm(text: string, field: 'tag' | 'folder', value: string): string;
  export interface Completion { field: Field | null; partial: string; start: number; end: number }
  export function completionAt(text: string, caret: number): Completion | null;
  export interface Known { tags: string[]; folders: string[] } // folders in shortPath form
  export function liveQuery(text: string, caret: number, known: Known): Parsed;
  export function migrateFilter(raw: unknown): string;
  ```

`withTerm`/`withoutTerm` work on the source text using term positions; on invalid text `withTerm` appends and `withoutTerm` returns it unchanged. `withTerm` wraps in `( … )` when the top level is `or`. `completionAt`: the word under the caret; `field: null` while typing a bare word (suggest fields), else the field and the partial value after `:`; null inside quotes that are closed or in whitespace. `liveQuery`: when the caret is at the end of the last term and that term's value isn't a whole known tag/folder/status (ignoring case) but is a prefix of one, parse with that term removed; otherwise `parseQuery(text)`.

- [ ] **Step 1: Write the failing tests**

```ts
test('ticking adds a term; unticking removes it', () => {
  assert.equal(withTerm('', 'tag', 'bug'), 'tag:bug');
  assert.equal(withTerm('tag:a', 'tag', 'two words'), 'tag:a tag:"two words"');
  assert.equal(withoutTerm('tag:a tag:"two words" -tag:c', 'tag', 'two words'), 'tag:a -tag:c');
  assert.equal(withoutTerm('tag:bug', 'tag', 'BUG'), '');
});
test('ticking under a top-level or keeps its meaning', () => {
  assert.equal(withTerm('tag:a or tag:b', 'tag', 'c'), '(tag:a or tag:b) tag:c');
});
test('a box is ticked only for a plain top-level term', () => {
  assert.equal(hasTerm('tag:a tag:b', 'tag', 'b'), true);
  assert.equal(hasTerm('-tag:b', 'tag', 'b'), false);
  assert.equal(hasTerm('tag:a or tag:b', 'tag', 'b'), false);
  assert.equal(hasTerm('folder:~/app', 'folder', '~/app'), true);
});
test('completion knows the field and what is typed', () => {
  assert.deepEqual(completionAt('ta', 2), { field: null, partial: 'ta', start: 0, end: 2 });
  assert.deepEqual(completionAt('-tag:bu', 7), { field: 'tag', partial: 'bu', start: 5, end: 7 });
  assert.equal(completionAt('tag:a ', 6), null);
});
test('a value still being typed does not blank the board', () => {
  const known = { tags: ['bug'], folders: [] };
  const live = liveQuery('tag:x tag:b', 11, known); assert.ok(live.ok);
  assert.equal(matches(live.node, { tags: ['x'], cwd: null, status: 'backlog' }), true);
  const done = liveQuery('tag:b', 2, known); assert.ok(done.ok); // caret elsewhere: taken as typed
  assert.equal(matches(done.node, { tags: ['bug'], cwd: null, status: 'backlog' }), false);
});
test('an old filter becomes the same query', () => {
  assert.equal(migrateFilter({ tags: ['a', 'two words'], folders: ['/Users/me/app'] }), '(tag:a or tag:"two words") folder:~/app');
  assert.equal(migrateFilter({ tags: ['a'], folders: [] }), 'tag:a');
  assert.equal(migrateFilter(null), '');
  assert.equal(migrateFilter({ tags: 'a' }), '');
});
```

- [ ] **Step 2: Run** `cd web && node --test src/app/board/query.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** the six functions in `query.ts`. Single-item groups in `migrateFilter` drop their brackets.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(board): edit, complete and migrate filter queries`

### Task 3: Saved views

**Files:**
- Create: `web/src/app/board/views.ts`
- Test: `web/src/app/board/views.test.ts`

**Interfaces:**
- Consumes: `migrateFilter` (Task 2).
- Produces:
  ```ts
  export interface View { id: string; name: string; query: string }
  export interface Current { query: string; viewId: string | null }
  export function parseViews(raw: unknown): View[];
  export function parseCurrent(raw: unknown): Current; // old { tags, folders } → migrated query, viewId null
  export function nameTaken(views: View[], name: string, exceptId?: string): boolean; // trimmed, ignoring case
  export function addView(views: View[], view: View): View[];      // unchanged if name empty or taken
  export function renameView(views: View[], id: string, name: string): View[]; // same rule
  export function updateView(views: View[], id: string, query: string): View[];
  export function deleteView(views: View[], id: string): View[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('saved views read back, dropping anything malformed', () => {
  assert.deepEqual(parseViews([{ id: 'a', name: 'Bugs', query: 'tag:bug' }, { id: 'b', name: 3 }, null]), [{ id: 'a', name: 'Bugs', query: 'tag:bug' }]);
  assert.deepEqual(parseViews('nope'), []);
});
test('the current filter reads back, migrating the old shape', () => {
  assert.deepEqual(parseCurrent({ query: 'tag:a', viewId: 'v1' }), { query: 'tag:a', viewId: 'v1' });
  assert.deepEqual(parseCurrent({ tags: ['a'], folders: [] }), { query: 'tag:a', viewId: null });
  assert.deepEqual(parseCurrent(undefined), { query: '', viewId: null });
});
test('views are added, renamed, updated and deleted; names stay unique', () => {
  let v = addView([], { id: '1', name: ' Bugs ', query: 'tag:bug' });
  assert.deepEqual(v, [{ id: '1', name: 'Bugs', query: 'tag:bug' }]);
  assert.equal(addView(v, { id: '2', name: 'bugs', query: '' }), v);
  assert.equal(addView(v, { id: '2', name: '  ', query: '' }), v);
  v = renameView(v, '1', 'Defects'); assert.equal(v[0].name, 'Defects');
  v = updateView(v, '1', 'tag:defect'); assert.equal(v[0].query, 'tag:defect');
  assert.deepEqual(deleteView(v, '1'), []);
});
```

- [ ] **Step 2: Run** `cd web && node --test src/app/board/views.test.ts` → FAIL.
- [ ] **Step 3: Implement** `views.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(board): saved views and the current filter`

### Task 4: The board filters by query; the Filter menu gets views

**Files:**
- Modify: `web/src/app/board/view.tsx` (filter state ~lines 75–100, `toggleFilter`/`openFilterMenu`/`FilterMenu`/`FilterButton` ~135–290, `Board` memo ~1010, init listeners ~1114–1130)
- Modify: `web/src/app/board/model.ts` (remove `BoardFilter`, `parseFilter`, `matchesFilter`) and `model.test.ts` (drop their two tests)
- Modify: `web/src/styles/app.css` (near `.tab-menu .menu-*`, ~line 170)
- Test: `web/e2e/board.spec.ts` (`the board filters cards by tag and folder`, ~line 747; add a views test after it)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (exported from `view.tsx`, for Task 5): `boardViews(): View[]`, `activeViewId(): string | null`, `applyView(id: string | null): void` (null clears the filter).

State: `query` (applied, valid) and `viewId` signals loaded via `parseCurrent`; `views` via `parseViews`; `draft` (the field's text) local to the menu, starting from `query`. Applying: `liveQuery(draft, caret, known)` after 300 ms idle, and at once on Enter, a completion pick, a checkbox, or a view click; when `ok`, set `query` and save `tabsh.boardFilter`; when not, show `error.message` in a `.query-error` line under the field. `known` = tags in use and `shortPath` of folders in use. Modified = `viewId` set and `query !==` that view's query. Drop the `onTagsChange` pruning (queries are never rewritten).

Menu (`.board-filter-menu`), top to bottom:
- "Views" heading and one row per view (`role="menuitemradio"`, `aria-checked` for the active one; click applies, clicking the active one clears), each with a ⋯ button opening Rename (inline text field, Enter saves, Esc cancels, refused while `nameTaken`) and Delete (no confirm; if active, `viewId` → null, query stays). Hidden when there are no views.
- Query field: `aria-label="Filter query"`, placeholder `tag:bug -tag:wip`, focused on open. Under it, while `completionAt` is non-null and has candidates: a `role="listbox"` of up to 8 suggestions (fields as `tag:`/`folder:`/`status:`; values from tags in use, `shortPath` folders, status names), ↑↓ to move, Enter/Tab to pick (replaces `start..end` with `formatTerm` for values or the field prefix for fields), Esc closes the list first, then the menu.
- Buttons: **Save as view** (opens an inline name field; Enter saves via `addView` with `crypto.randomUUID()`, making it active; disabled while the draft is invalid or empty) and **Update "<name>"** (only when modified).
- Today's search field and Tags/Folders checkboxes, now driven by `hasTerm`/`withTerm`/`withoutTerm` on the draft (folders by their `shortPath` form).

Chip: a `button#board-view-chip` before `#board-filter-btn`, shown while `query` is non-empty or a view is active; text is the view's name or `Custom filter`, plus a `.modified` dot when modified; click opens the menu. Filter button `aria-pressed` = `query !== ''`.

Storage: `storage` event on `tabsh.boardViews` reloads `views` (and clears `viewId` if its view is gone, keeping the query).

- [ ] **Step 1: Rewrite the e2e filter test and add a views test.** In the existing test, keep the tag/folder steps but focus expectations on `getByRole('textbox', { name: 'Filter query' })` (focused on open), and assert the query text follows the boxes: after ticking `ship`, the field reads `tag:ship`; after also ticking Alpha's folder it reads `tag:ship folder:<alpha short path>`. Add:

```ts
test('a filter query saves as a view and comes back after a reload', async ({ page, daemon, twins }) => {
  // set up Alpha (tag ship) and Beta as in the test above
  const filters = page.locator('.board-filter-menu');
  const field = filters.getByRole('textbox', { name: 'Filter query' });
  await page.locator('#board-filter-btn').click();
  await field.fill('-tag:ship'); await field.press('Enter');
  await expect(card(page, 'Alpha')).toHaveCount(0); await expect(card(page, 'Beta')).toBeVisible();
  await field.fill('tag:ship oops'); await field.press('Enter');
  await expect(filters.locator('.query-error')).toHaveText('Unknown term "oops". Did you mean tag:oops?');
  await expect(card(page, 'Beta')).toBeVisible(); // last valid query still applied
  await field.fill('-tag:ship'); await field.press('Enter');
  await filters.getByRole('button', { name: 'Save as view' }).click();
  await filters.getByRole('textbox', { name: 'View name' }).fill('Not shipping');
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-view-chip')).toHaveText('Not shipping');
  await page.reload();
  await expect(page.locator('#board-view-chip')).toHaveText('Not shipping');
  await expect(card(page, 'Alpha')).toHaveCount(0);
  await page.locator('#board-filter-btn').click();
  await filters.getByRole('menuitemradio', { name: 'Not shipping' }).click(); // clears
  await expect(card(page, 'Alpha')).toBeVisible();
  await expect(page.locator('#board-view-chip')).toBeHidden();
});
```

Also add one assertion each for Review Focus 2 and 4: typing `tag:shi` (no Enter, wait 500 ms) with the caret at the end keeps Alpha and Beta visible; and an `addInitScript` setting `tabsh.boardViews` to `'{'` and `tabsh.boardFilter` to `'{"tags":["ship"],"folders":[]}'` opens with the field reading `tag:ship` and only Alpha shown.

- [ ] **Step 2: Build and run to see them fail:** `cargo build --locked && cd web && npm run build && npx playwright test e2e/board.spec.ts -g "filter"` → FAIL.
- [ ] **Step 3: Implement** the state, menu, chip and CSS in `view.tsx`/`app.css`; remove the old filter from `model.ts`/`model.test.ts`. If `view.tsx`'s filter code passes ~300 lines, move it to `board/filter-menu.tsx` and export `FilterButton` from there (update `ui/app.tsx`'s import).
- [ ] **Step 4: Run** `cd web && npm run check && npm run lint && npm test && npm run build && npx playwright test e2e/board.spec.ts` → all PASS.
- [ ] **Step 5: Commit** `feat(board): filter by query and save views`

### Task 5: Views in the palette

**Files:**
- Modify: `web/src/app/palette/pages.ts` (ctx type ~line 73, Tabs group ~line 165)
- Modify: `web/src/app/palette/palette.tsx` (ctx wiring ~line 81)
- Test: `web/e2e/palette.spec.ts`

**Interfaces:**
- Consumes: `boardViews`, `activeViewId`, `applyView` (Task 4).
- Produces: ctx fields `views: { id: string; name: string }[]`, `activeView: string | null`, `applyView(id: string | null): void`.

Items in the Tabs group after "Board layout": one per view, label `View: <name>`, icon `icons.listFilter`, hint `Active` for the active one, keywords `board filter saved query`, `run: () => ctx.applyView(id)`; and `Clear view` (only while one is active) running `ctx.applyView(null)`.

- [ ] **Step 1: Write the failing e2e test** in `palette.spec.ts`: seed `tabsh.boardViews` with `[{"id":"v","name":"Shipping","query":"tag:ship"}]` via `addInitScript`, open the palette, type `View: Ship`, Enter → `#board-view-chip` reads `Shipping`; open the palette, run `Clear view` → chip hidden.
- [ ] **Step 2: Run** `cd web && npm run build && npx playwright test e2e/palette.spec.ts -g "View"` → FAIL.
- [ ] **Step 3: Implement** the ctx fields and items.
- [ ] **Step 4: Run** `npm run check && npm run lint && npm run build && npx playwright test e2e/palette.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(palette): pick a board view from the palette`

### Task 6: Docs, full checks, screenshot, PR

**Files:**
- Modify: `docs/architecture.md` (board row: the Filter's query, views, chip; pure-files list: `board/query.ts`, `board/views.ts`)
- Modify: `.github/scripts/select-e2e.mjs` only if `board/query.ts`/`views.ts` aren't already covered by the board rule.

- [ ] **Step 1:** Update `docs/architecture.md`.
- [ ] **Step 2: Full checks** at the repo root: `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`; in `web/`: `npm run check && npm run lint && npm test && npm run build && npm run test:e2e -- e2e/board.spec.ts e2e/palette.spec.ts` → all PASS.
- [ ] **Step 3: Screenshot** the Filter menu open with two saved views, a query and autocomplete showing, and the chip, via Playwright against the built daemon; also one of the list layout with a view active.
- [ ] **Step 4: Commit** (`docs: board views in the architecture`, plus the rebuilt `src/app.html` and `src/app-assets/`), push `feat/board-views`, open the PR against `main` with the screenshots in its description.
