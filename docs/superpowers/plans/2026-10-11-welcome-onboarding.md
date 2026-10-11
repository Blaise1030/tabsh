# Welcome onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a six-screen full-page welcome on first load, let it set the view, theme, font, and typing sound, and set up a chosen agent's hooks, with the same tour available from the command palette.

**Architecture:** A pure `welcome/steps.ts` holds the screen list, view mapping, and the settings patch for setup. `welcome/view.ts` is a modal dialog mounted by `App()`. It writes existing settings immediately as choices are made, and adds `welcomeSeen` plus `startView`. The board's setup button and the welcome share `openSetupCard`, which opens the card and writes nothing.

**Tech Stack:** VanJS, the existing settings JSON and `saveSetting` path, Basecoat dropdown, Playwright e2e, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-welcome-onboarding-design.md`

## Global Constraints

- No new daemon route. `welcomeSeen` and `startView` are fields on the settings JSON.
- The welcome is not a URL place. Reload does not restore a half-finished tour.
- No `innerHTML`. Strings are text nodes. Icons come from `ui/icons.ts`.
- `welcome/` must not import `palette/` or `ui/app.ts`. `palette` and `ui` may import `welcome`. `welcome` may import `settings` and the board helper.
- The board's own button stays "Set up with Claude Code", passes `DEFAULT_COMMAND`, leaves focus false, and saves only `boardOnboarded`.
- Escape does not close the dialog (`cancel` is prevented). The provider menu is the only Escape exception.
- Clicking the backdrop does nothing.
- Skip, and Continue on the last screen, write `welcomeSeen: true` only. They do not write `boardOnboarded`.
- Set up writes `welcomeSeen`, `boardOnboarded`, and `agentProvider` in one save.
- Before each commit, in `web/`: `npm run check`, `npm run lint`, and `npm test`. A commit that changes app source also runs `npm run build` and includes `src/app.html` and `src/app-assets/`.
- Add `web/src/app/welcome/` to `featureRules` in `.github/scripts/select-e2e.mjs` when the first welcome spec lands, or CI treats that path as unmapped and runs the full suite.

## Review Focus

- Escape on the intro does not close the welcome. A person expects Escape to dismiss a dialog; this one stays. Test in Task 3.
- Skip after picking a theme keeps that theme and leaves `boardOnboarded` false, so the board setup screen remains. Test in Task 4.
- An explicit `view=terms` in the URL wins over a stored `startView` of `board`. Test in Task 4.
- If the setup card fails to open, the dialog stays on Agents and `welcomeSeen` is not written. Test the decision in Task 2; Task 5 calls it.
- Show welcome, then Skip without touching the view, leaves the current page and does not clear `boardOnboarded`. Test in Task 6.

## File structure

- Create `web/src/app/welcome/steps.ts` — screen copy, step clamps, view mapping, setup patch. No DOM.
- Create `web/src/app/welcome/steps.test.ts` — beside it.
- Create `web/src/app/welcome/view.ts` — dialog, choices, `showWelcome()`, `initWelcome()`.
- Modify `web/src/app/settings/schema.ts` — `welcomeSeen`, `startView`.
- Modify `web/src/app/settings/settings.ts` — `saveSettings` for one PUT of several fields.
- Modify `web/src/app/board/view.ts` — export `openSetupCard`; the board button calls it.
- Modify `web/src/app/ui/app.ts` — mount the dialog.
- Modify `web/src/app/main.ts` — open after settings load; pass `startView` when the URL names no view.
- Modify `web/src/app/palette/pages.ts` and `palette.ts` — Show welcome.
- Modify `web/src/styles/app.css` — full-page column, footer, dots, choice rows.
- Modify `web/e2e/fixture.ts` — `openApp` writes `welcomeSeen: true`.
- Modify `web/src/demo/daemon.ts` — `welcomeSeen: true`.
- Modify `web/e2e/welcome.spec.ts` — the tour.
- Modify `docs/architecture.md` — `welcome/` row and the pure-module list.
- Modify `.github/scripts/select-e2e.mjs` — welcome rule, and `welcome` on the palette rule.

---

### Task 1: Settings fields

**Files:**
- Modify: `web/src/app/settings/schema.ts`
- Test: `web/src/app/settings/schema.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `Settings.welcomeSeen: boolean`, `Settings.startView: 'terms' | 'board'`. `defaults` sets `welcomeSeen` false and `startView` `'terms'`. `cleanSettings` keeps `welcomeSeen` only when the stored value is `true`, and `startView` only when it is `'terms'` or `'board'`.

- [ ] **Step 1: Write the failing test**

Add to `schema.test.ts`:

```ts
test('welcomeSeen and startView keep only the allowed values', () => {
  const d = defaults(true);
  assert.equal(d.welcomeSeen, false);
  assert.equal(d.startView, 'terms');
  assert.equal(cleanSettings({}, true).welcomeSeen, false);
  assert.equal(cleanSettings({ welcomeSeen: true }, true).welcomeSeen, true);
  assert.equal(cleanSettings({ welcomeSeen: 'yes' }, true).welcomeSeen, false);
  assert.equal(cleanSettings({ startView: 'board' }, true).startView, 'board');
  assert.equal(cleanSettings({ startView: 'kanban' }, true).startView, 'terms');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --test src/app/settings/schema.test.ts`
Expected: FAIL because `welcomeSeen` is not on `Settings`.

- [ ] **Step 3: Add the two fields**

In `schema.ts`, add the properties, the defaults, and the `cleanSettings` lines described in Interfaces. No other field changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --test src/app/settings/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run the global checks. This task does not change the app shell, so do not rebuild `src/app.html`.

```bash
git add web/src/app/settings/schema.ts web/src/app/settings/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(web): remember whether the welcome was seen and where the app opens

EOF
)"
```

---

### Task 2: Screen list and pure decisions

**Files:**
- Create: `web/src/app/welcome/steps.ts`
- Test: `web/src/app/welcome/steps.test.ts`

**Interfaces:**
- Consumes: `BoardLayout` from `settings/schema.ts` (`'columns' | 'list'`)
- Produces:

```ts
export interface WelcomeScreen {
  id: 'intro' | 'view' | 'theme' | 'font' | 'sound' | 'agents';
  title: string;
  body: string;
  skip: boolean;
  setup: boolean;
}
export const WELCOME_SCREENS: readonly WelcomeScreen[];
export function clampStep(index: number): number;
export function viewSettings(
  choice: 'tabs' | 'kanban' | 'list',
  boardLayout: BoardLayout,
): { startView: 'terms' | 'board'; boardLayout: BoardLayout };
export function agentSetupPatch(providerName: string): {
  welcomeSeen: true;
  boardOnboarded: true;
  agentProvider: string;
};
export function dismissWelcome(): { welcomeSeen: true };
export function closesAfterSetup(opened: boolean): boolean;
```

`clampStep` clamps to `0 .. WELCOME_SCREENS.length - 1`. `closesAfterSetup` is true only when `opened` is true. `viewSettings('tabs', layout)` returns `{ startView: 'terms', boardLayout: layout }`. `'kanban'` returns `startView: 'board'` and `boardLayout: 'columns'`. `'list'` returns `startView: 'board'` and `boardLayout: 'list'`.

Copy, exact:

| id | title | body | skip | setup |
|---|---|---|---|---|
| intro | Shells that outlive this tab. | Close the tab, reload, or shut the laptop. Your shells keep running, and tabsh reattaches when you come back. | true | false |
| view | How you look at the work. | Tabs for the terminals, a kanban for the cards, or the same cards as a list. | true | false |
| theme | Theme. | The colours of the terminal and the page. | true | false |
| font | Font. | The face the terminal draws in. | true | false |
| sound | Typing sound. | The click of a mechanical keyboard. Your girlfriend never has to hear it. Pick one. | true | false |
| agents | Connect your agents. | Cards move on their own when your coding agent reports what it is doing. Pick one and let it wire up its own hooks. | false | true |

- [ ] **Step 1: Write the failing test**

`steps.test.ts` asserts `WELCOME_SCREENS` equals that table (ids, titles, bodies, `skip`, `setup`), `clampStep(-1) === 0`, `clampStep(0) === 0`, `clampStep(5) === 5`, `clampStep(6) === 5`, the three `viewSettings` rows above with `'list'` and `'columns'` as the incoming layout, `agentSetupPatch('Codex')` deep-equals `{ welcomeSeen: true, boardOnboarded: true, agentProvider: 'Codex' }`, `dismissWelcome()` deep-equals `{ welcomeSeen: true }`, `closesAfterSetup(false) === false`, and `closesAfterSetup(true) === true`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --test src/app/welcome/steps.test.ts`
Expected: FAIL with the module not found.

- [ ] **Step 3: Implement the signatures in `steps.ts`**

No DOM. The table above is the whole screen list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --test src/app/welcome/steps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run the global checks. No app-shell rebuild.

```bash
git add web/src/app/welcome/steps.ts web/src/app/welcome/steps.test.ts
git commit -m "$(cat <<'EOF'
feat(web): define the welcome screens and the settings they write

EOF
)"
```

---

### Task 3: The dialog, intro, and Skip

**Files:**
- Create: `web/src/app/welcome/view.ts`
- Modify: `web/src/app/ui/app.ts`, `web/src/app/main.ts`, `web/src/styles/app.css`, `web/e2e/fixture.ts`, `web/src/demo/daemon.ts`, `.github/scripts/select-e2e.mjs`
- Test: `web/e2e/welcome.spec.ts`

**Interfaces:**
- Consumes: `WELCOME_SCREENS`, `clampStep`, `dismissWelcome` from Task 2. `saveSetting` from `settings/settings.ts`. `gateMode` from `daemon/client.ts`.
- Produces:

```ts
export function Welcome(): HTMLDialogElement;
export function showWelcome(): void;
export function initWelcome(): void;
```

`Welcome()` is one `<dialog id="welcome" aria-label="Welcome">`. `showWelcome()` calls `showModal()` and resets the step to 0, and does nothing when `gateMode.val !== null`. `initWelcome()` calls `showWelcome()` when `current.saved.welcomeSeen` is false. It is called from `main.ts` only after `waitForDaemon()` and `loadSettings()` have finished.

Footer: screen 0 shows Skip and Continue. Later screens with `skip: true` show Back, Skip, and Continue. Continue on a non-last screen advances and Back goes back, both through `clampStep`. Continue on the last screen does nothing until Task 5. Skip calls `saveSetting('welcomeSeen', true)` and closes the dialog. Escape fires `cancel`; prevent it so the dialog stays open.

The footer has one dot per `WELCOME_SCREENS` entry. The current dot has `aria-current="step"`.

`openApp` PUTs `welcomeSeen: true` before `goto` whenever the stored value is not `true` (fold it into the existing settings PUT, and PUT even when the sidebar is already closed). `demo/daemon.ts` starts settings as `{ boardOnboarded: true, welcomeSeen: true }`.

Add a `featureRules` entry: paths `[/^web\/src\/app\/welcome\//]`, specs `['welcome', 'board', 'palette']`.

- [ ] **Step 1: Write the failing test**

`web/e2e/welcome.spec.ts`:

```ts
test('the intro stays up on Escape, and Skip hides it across reload', async ({ page, daemon }) => {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...now, welcomeSeen: false, boardOnboarded: false },
  });
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Shells that outlive this tab.');
  await expect(page.locator('#gate')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await expect(welcome).toContainText('How you look at the work.');
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  await page.reload();
  await expect(welcome).toHaveCount(0);
});
```

Use the fixture's `expect`, `test`, and daemon the way `web/e2e/board.spec.ts` does. Do not call `openApp` here; it will force `welcomeSeen: true`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts`
Expected: FAIL because the dialog is missing. The daemon binary is `../target/debug/tabsh` (`cargo build --locked` at the repo root first if it is absent).

- [ ] **Step 3: Implement the dialog and the fixture**

Mount `Welcome()` from `App()` as a sibling of the stage. Style it as a full-page opaque column with the footer pinned to the bottom: dots on the left, buttons on the right. Screens in this task render title and body from `WELCOME_SCREENS`. Choice controls wait for Task 4 and Task 5; those screens still show their title and body so Continue can walk through. `initWelcome()` runs at the point in `main.ts` specified above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts e2e/board.spec.ts`
Expected: PASS, including the board spec that turns `boardOnboarded` off and still sees "Set up with Claude Code" (the fixture kept `welcomeSeen` true).

- [ ] **Step 5: Commit**

Run the global checks, including `npm run build`.

```bash
git add web/src/app/welcome/view.ts web/src/app/ui/app.ts web/src/app/main.ts web/src/styles/app.css web/e2e/fixture.ts web/e2e/welcome.spec.ts web/src/demo/daemon.ts .github/scripts/select-e2e.mjs src/app.html src/app-assets
git commit -m "$(cat <<'EOF'
feat(web): open a welcome on first load and let Skip dismiss it

EOF
)"
```

---

### Task 4: View, theme, font, and typing sound

**Files:**
- Modify: `web/src/app/welcome/view.ts`, `web/src/app/main.ts`, `web/src/app/settings/settings.ts`, `web/e2e/welcome.spec.ts`

**Interfaces:**
- Consumes: `viewSettings`, `dismissWelcome` from Task 2. `THEMES`, `FONTS`, `TYPING_SOUNDS` from `settings/catalog.ts`. `previewSound(setting: string)` from `sound/packs.ts`. `go` from `nav/router.ts`.
- Produces:

```ts
export function saveSettings(patch: Partial<Settings>): void
```

in `settings/settings.ts`. It assigns every key in `patch` onto `current.saved`, notifies the saved listeners, applies, and PUTs once. `saveSetting` calls it with one key so there is still a single writer.

`startRouter`'s fallback in `main.ts` includes `view: current.saved.startView`. The URL merge already happens after the fallback, so a `view` query wins.

On a view pick, call `saveSettings(viewSettings(choice, current.saved.boardLayout))` and remember that this opening changed the view. On theme, font, or sound pick, `saveSetting` that one field. A sound pick also calls `previewSound` with the sound id.

Every close goes through one function in `view.ts`:

```ts
function closeWelcome(): void
```

It closes the dialog and, only if the view was changed this opening, calls `go({ view: current.saved.startView })`. It writes nothing. Skip, and Task 5's Continue and successful Set up, call it after their own save.

View choices are three buttons named Tabs, Kanban, and List. Theme choices are one button per `THEMES` entry, labelled with `theme.name`. Font choices are one button per `FONTS` entry, labelled with `font.name`, drawn in `fontStack`. Sound choices are one button per `TYPING_SOUNDS` entry, labelled with the record's value.

- [ ] **Step 1: Write the failing tests**

Append to `welcome.spec.ts`:

```ts
test('Kanban is where a later visit opens, unless the URL says otherwise', async ({ page, daemon }) => {
  // welcomeSeen false, then open the app as in the intro test
  // Continue to the view screen, click Kanban, click Skip
  // expect #board visible and not .list
  // goto the app URL with the token and no search query
  // expect #board visible
  // goto the same URL with ?view=terms
  // expect #board hidden
});

test('a theme chosen before Skip is still the page theme', async ({ page, daemon }) => {
  // welcomeSeen false, boardOnboarded false
  // Continue to Theme, click the button named Nord, click Skip
  // expect documentElement to use Nord's background (THEMES.nord.colors.background)
  // open the board and expect .board-onboarding to contain "Set up with Claude Code"
});
```

Fill the commented steps with the same settings PUT and `goto` as Task 3. Nord's background is the value already in `THEMES.nord.colors.background`; read it in the test rather than copying a hex into the plan.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts`
Expected: FAIL because Kanban and Nord are not on the page.

- [ ] **Step 3: Implement the four choice screens and `saveSettings`**

The sketches for Tabs, Kanban, and List are divs (a strip, three columns, stacked rows), not images. The chosen view button has `aria-pressed="true"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run the global checks, including `npm run build`.

```bash
git add web/src/app/welcome/view.ts web/src/app/main.ts web/src/app/settings/settings.ts web/e2e/welcome.spec.ts src/app.html src/app-assets
git commit -m "$(cat <<'EOF'
feat(web): let the welcome set the view, theme, font, and typing sound

EOF
)"
```

---

### Task 5: Agents

**Files:**
- Modify: `web/src/app/board/view.ts`, `web/src/app/welcome/view.ts`, `web/e2e/welcome.spec.ts`

**Interfaces:**
- Consumes: `agentSetupPatch`, `dismissWelcome`, `closesAfterSetup`, `SETUP_PROMPT` and `DEFAULT_COMMAND` from `board/model.ts`, `openTab` and `Session` from `sessions/store.ts`, `setStatus` from the board module that already moves a card, `saveSettings` from Task 4.
- Produces:

```ts
export async function openSetupCard(opts: {
  command: string;
  resume?: string;
  focus: boolean;
}): Promise<Session | null>
```

in `board/view.ts`. It `openTab`s `{ name: 'Set up tabsh hooks', prompt: SETUP_PROMPT, command, resume }` with the given focus, and returns null if that throws. It does not write settings and does not call `setStatus`.

The board button calls `openSetupCard({ command: DEFAULT_COMMAND, focus: false })`, then on a session saves `boardOnboarded` and calls `setStatus(session, 'in_progress')`, matching today's order.

The welcome's Set up calls `openSetupCard` with the chosen provider's `command` and `resume`. Focus is false when this opening changed the view to the board; otherwise true. If `closesAfterSetup` is false, it does not call `saveSettings` and does not call `closeWelcome`. If true, it calls `saveSettings(agentSetupPatch(name))` once, then `setStatus`, and a rejected `setStatus` is logged and still calls `closeWelcome`. While the request is in flight, Set up, Back, and Continue are disabled. Continue on this screen calls `saveSettings(dismissWelcome())` and then `closeWelcome`.

The provider control is a Basecoat dropdown, the same menuitemradio pattern as `ChipMenu` in `new-card.ts`: the button shows the chosen name and a chevron, the menu lists `current.saved.providers`, the current name is checked. It starts as `agentProvider`. Escape on that menu closes the menu and does not close the dialog. Continue on this screen calls `saveSettings(dismissWelcome())` and closes.

- [ ] **Step 1: Write the failing test**

Append to `welcome.spec.ts`:

```ts
test('Continue on Agents leaves the board setup screen', async ({ page, daemon }) => {
  // welcomeSeen false, boardOnboarded false
  // click Continue until the dialog contains "Connect your agents."
  // click Continue
  // expect the dialog hidden
  // open the board
  // expect .board-onboarding to contain "Set up with Claude Code"
  // reload
  // expect the welcome dialog absent
  // expect .board-onboarding still present after opening the board
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts -g "Continue on Agents"`
Expected: FAIL because Agents has no Continue that finishes, or the board setup is already gone.

- [ ] **Step 3: Implement `openSetupCard` and the Agents screen**

Keep the board button's visible label and `DEFAULT_COMMAND` behavior. The welcome uses `closesAfterSetup(session !== null)` before saving.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts e2e/board.spec.ts`
Expected: PASS. The board spec's "Set up with Claude Code" / Skip test still passes.

- [ ] **Step 5: Commit**

Run the global checks, including `npm run build`.

```bash
git add web/src/app/board/view.ts web/src/app/welcome/view.ts web/e2e/welcome.spec.ts src/app.html src/app-assets
git commit -m "$(cat <<'EOF'
feat(web): set up a chosen agent from the welcome

EOF
)"
```

---

### Task 6: Show welcome from the palette

**Files:**
- Modify: `web/src/app/palette/pages.ts`, `web/src/app/palette/palette.ts`, `web/e2e/welcome.spec.ts`, `.github/scripts/select-e2e.mjs`, `docs/architecture.md`

**Interfaces:**
- Consumes: `showWelcome()` from Task 3
- Produces: a Help item labelled `Show welcome`, keywords including `onboarding`, `tour`, and `intro`, whose `run` is `showWelcome`. `palettePages()` passes it in the pages context the same way it passes `toggleBoard`.

Add `'welcome'` to the existing palette `featureRules` specs list.

`docs/architecture.md`: a `welcome/` row for `steps.ts` (pure screen list, view mapping, setup patch) and `view.ts` (the dialog). Add `welcome/steps.ts` to the pure-module list. Note that `palette` and `ui` may import `welcome`, and `welcome` may import `settings` and the board helper.

- [ ] **Step 1: Write the failing test**

Append to `welcome.spec.ts`:

```ts
test('Show welcome does not clear the board or leave the page when skipped', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await setOnboarded(page, daemon, true);
  await page.reload();
  await page.locator('#settings-btn').click();
  await page.locator('#palette-input').fill('welcome');
  await page.getByRole('menuitem', { name: 'Show welcome' }).click();
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toContainText('Shells that outlive this tab.');
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#board')).toBeHidden();
  await page.locator('#board-btn').click();
  await expect(page.locator('.board-onboarding')).toHaveCount(0);
});
```

`showWelcome()` closes `#palette` if that dialog is open, then opens the welcome. Opening a second modal while the palette is still modal would throw. The menuitem name is `Show welcome`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts -g "Show welcome"`
Expected: FAIL because the menuitem is missing.

- [ ] **Step 3: Add the palette item, the selector rule, and the architecture row**

`showWelcome` closes an open `#palette` before `showModal`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm run test:e2e -- e2e/welcome.spec.ts e2e/palette.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run the global checks, including `npm run build`.

```bash
git add web/src/app/palette/pages.ts web/src/app/palette/palette.ts web/e2e/welcome.spec.ts .github/scripts/select-e2e.mjs docs/architecture.md src/app.html src/app-assets
git commit -m "$(cat <<'EOF'
feat(web): open the welcome again from the command palette

EOF
)"
```
