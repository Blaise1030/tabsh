# Welcome onboarding

**Status:** revised after review (2026-10-11) — full-page tour that sets view, theme, font, typing sound, and agent hooks
**Goal:** On first load, after this browser is paired, show a full-page welcome in the shape of a product tour: a quiet page, the choice in the body, progress dots at the bottom left, and Back / Continue at the bottom right. The command palette can open the same welcome again.

## Non-goals

- Replacing the board’s “Connect your agents” screen. That screen stays, in both column and list layouts, until `boardOnboarded` is true.
- Editing agent providers in the welcome. Names, startup commands, and resume commands stay in the palette’s Agent providers page.
- Font size, notification chimes, or keybindings. Those stay in the palette.
- A new daemon route. New fields ride on the settings JSON the page already stores.
- Putting the welcome in the URL. Back, Forward, and reload do not restore a half-finished tour.
- Illustrated assets. The view choices are plain layout sketches built from elements, not image files.

## When it shows

The welcome is a modal dialog over the whole page, with an opaque background. The body is a single column. The footer stays at the bottom: one dot per screen on the left (the current dot filled), and the buttons on the right.

`main.ts` opens it once, after `waitForDaemon()` and `loadSettings()` have finished, and only when `welcomeSeen` is false. It does not open from the default settings before the daemon answers.

It stays closed while `gateMode` is set (daemon down, Safari, or pairing). `showWelcome()` does nothing in that case. When the gate clears, the automatic open runs if `welcomeSeen` is still false.

The palette item **Show welcome**, in the Help group, calls `showWelcome()`. That opens the dialog on screen 1 even when `welcomeSeen` is already true. Opening it again while it is already open restarts at screen 1.

The step index lives in memory. A reload mid-tour starts at screen 1 if `welcomeSeen` is still false. A replay that has not finished does not come back after reload once `welcomeSeen` is true.

A missing `welcomeSeen` counts as false, so people who already use tabsh see the welcome once.

The demo’s pretend settings include `welcomeSeen: true`, next to `boardOnboarded: true`.

## Chrome

- Screen 1 has **Skip** and **Continue**. No Back.
- Screens 2 through 5 have **Back**, **Skip**, and **Continue**.
- Screen 6 has **Back** and **Continue**. No Skip. **Set up** lives in the body.
- Clicking the backdrop does nothing. Escape does not close the dialog. The provider menu on screen 6 is the exception: Escape closes that menu only, the same way the New card agent chip keeps Escape from closing the dialog behind it.
- **Skip** writes `welcomeSeen: true` and closes. It does not write `boardOnboarded`. Choices already made on earlier screens stay saved.
- **Continue** on screen 6 does the same as Skip: the welcome is seen, hooks are not set up, and the board’s own setup screen remains until they set up or skip there.
- There is no separate **Not now** button.

## Screens

1. **Intro**, centered, in the shape of a product title page. Title: “Shells that outlive this tab.” Body: “Close the tab, reload, or shut the laptop. Your shells keep running, and tabsh reattaches when you come back.”
2. **View.** Title: “How you look at the work.” Body: “Tabs for the terminals, a kanban for the cards, or the same cards as a list.” Three choices, as sketched frames: **Tabs**, **Kanban**, **List**. The chosen one is marked. Picking one saves immediately.
3. **Theme.** Title: “Theme.” Body: “The colours of the terminal and the page.” Every theme in `THEMES`, as a swatch with its name. Picking one saves `theme` and applies it, so the welcome itself restyles.
4. **Font.** Title: “Font.” Body: “The face the terminal draws in.” Every font in `FONTS`. Each row’s name is drawn in that face. Picking one saves `font` and applies it.
5. **Typing sound.** Title: “Typing sound.” Body: “The click of a mechanical keyboard. Your girlfriend never has to hear it. Pick one.” Every entry in `TYPING_SOUNDS`, including Off. Picking one saves `typingSound`, applies it, and plays that sample once.
6. **Agents.** Title: “Connect your agents.” Body: “Cards move on their own when your coding agent reports what it is doing. Pick one and let it wire up its own hooks.” The provider control is a menu button in the shape of an actions dropdown: the chosen name and a chevron, opening the saved providers with the current one checked. It starts as `agentProvider`. Beside it, the solid **Set up** button.

Untouched choices keep today’s defaults: theme `tabsh`, font `menlo`, typing sound `mx-black-pbt`, view Tabs.

## View

`boardLayout` already stores columns or list. It does not store whether the app opens on the terminals or the board. The welcome adds `startView: 'terms' | 'board'`, default `'terms'`. `cleanSettings` keeps only those two values.

| Choice | `startView` | `boardLayout` |
|---|---|---|
| Tabs | `terms` | left as it was |
| Kanban | `board` | `columns` |
| List | `board` | `list` |

Picking a choice saves those fields immediately. The page does not navigate yet, because the dialog covers it. When the dialog closes, if they changed the view during this opening, the app goes there: `go({ view: 'board' })` or `go({ view: 'terms' })`. If they did not touch the view control, the page stays where it was, so a replay that they skip does not pull them off the board.

On a later visit, if the URL names no view, startup uses `startView`. An explicit `view` in the URL still wins.

## Agents

**Set up** opens a card named “Set up tabsh hooks” with `SETUP_PROMPT` and the chosen provider’s `command` and `resume`. After the card exists, the welcome writes `welcomeSeen: true`, `boardOnboarded: true`, and `agentProvider` set to the chosen name in one settings save, then moves the card to In progress (`setStatus`). One save, not three `saveSetting` calls, so a slower response cannot overwrite a later one. A failure of that status move is logged and does not undo the flags or reopen the dialog. If opening the card throws, the dialog stays on screen 6 and nothing new is saved. While the request is in flight, **Set up**, **Back**, and **Continue** are disabled.

If they chose the board during this opening, the card opens without taking focus and the dialog closes onto the board. If they chose Tabs, or never touched the view, the card takes focus so its terminal is on screen.

Replaying does not clear `boardOnboarded`. **Set up** during a replay still opens a card and writes those three fields. **Continue** and **Skip** only mark the welcome seen.

The board’s own button stays “Set up with Claude Code” and still passes `DEFAULT_COMMAND` with focus left false, so the board stays open. It still saves only `boardOnboarded`. It does not write `welcomeSeen`, `agentProvider`, or `startView`.

## Where it lives

New feature folder `web/src/app/welcome/`:

- `steps.ts` — pure. Six screens. Back and Continue stop at the ends. Skip is offered on screens 1 through 5. Only screen 6 can set up. Titles and bodies. A `steps.test.ts` beside it.
- `view.ts` — the dialog, the step state, the choice controls, `showWelcome()`. Calls the shared setup helper. Does not import the palette or `ui/app.ts`.

`board/view.ts` exports the shared helper both setup buttons call: open the setup card (name, `SETUP_PROMPT`, command, optional resume, focus flag) and return the session, or null if opening throws. It does not write settings. The board button and the welcome each save their own flags, then call `setStatus(session, 'in_progress')`.

`ui/app.ts` mounts the dialog from `App()`, as a sibling of the stage. `main.ts` performs the one automatic open after settings load, and passes `startView` into startup when the URL names no view. `palette/palette.ts` passes `showWelcome` into the pages context, the same way it passes `toggleBoard`. The Help item is labelled “Show welcome”, with keywords that include onboarding, tour, and intro.

`welcomeSeen` and `startView` are fields on `Settings`. `schema.test.ts` covers both.

`docs/architecture.md` gains a `welcome/` row and lists `welcome/steps.ts` among the pure modules. `palette` and `ui` may import `welcome`. `welcome` may import `settings` and the board helper. It must not import `palette` or `ui/app.ts`.

No `innerHTML`. Icons come from `ui/icons.ts`. User-facing strings are text nodes. The dialog is shown with `showModal()`, so the existing `dialog[open]` checks keep the palette and board shortcuts from firing underneath. Its `cancel` event is prevented, which is what stops Escape from dismissing it.

Theme, font, and typing sound go through the existing `saveSetting` and `applySettings`. The typing preview uses the same one-shot play the palette uses. `saveSetting` stays fire-and-forget. A failed PUT does not reopen the dialog.

## Testing

- `schema.test.ts`: missing `welcomeSeen` is false, `true` stays true, any other value is false. `startView` defaults to `terms`, accepts `board`, and rejects anything else.
- `welcome/steps.test.ts`: Back and Continue clamp, Skip exists on the first five screens only, and only the last screen can set up.
- `openApp` writes `welcomeSeen: true` before navigation, so existing specs are not covered by the tour. The board spec that turns `boardOnboarded` off still sees the board setup screen, because the welcome flag stays true.
- A welcome spec sets `welcomeSeen` false, reloads, sees the intro, continues to the view screen, picks Kanban, skips, and lands on the board in columns. Reloading that page without a `view` in the URL opens the board again.
- A welcome spec reaches Agents, chooses **Continue**, reloads, and still sees “Connect your agents” on the board.
- A palette spec opens **Show welcome** and lands on the intro.
- The demo settings object includes `welcomeSeen: true`.

## Success criteria

- A new settings blob shows the welcome once the gate is clear, and not before.
- Picking a theme, font, or typing sound changes the page immediately and survives Skip.
- Picking Tabs, Kanban, or List is where the app goes when the welcome closes, and where a later visit opens when the URL names no view.
- **Skip**, or **Continue** on the last screen, hides the welcome across reload and leaves the board setup screen in place.
- **Set up** hides it, marks the board onboarded, remembers the chosen provider, and opens that provider’s setup card.
- **Show welcome** runs the same screens again without clearing `boardOnboarded`.
