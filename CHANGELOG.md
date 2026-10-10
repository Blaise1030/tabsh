# Changelog

## v0.1.19

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.17...v0.1.19)

### Fixes

- **web:** Load the landing demos without loading="lazy" ([a0a4eb4](https://github.com/Blaise1030/tabsh/commit/a0a4eb4))
- **board:** Rename a parked tab by the title its shell sets ([c0c99d1](https://github.com/Blaise1030/tabsh/commit/c0c99d1))

## v0.1.18

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.17...v0.1.18)

### Fixes

- **web:** Load the landing demos without loading="lazy" ([a0a4eb4](https://github.com/Blaise1030/tabsh/commit/a0a4eb4))
- **board:** Rename a parked tab by the title its shell sets ([c0c99d1](https://github.com/Blaise1030/tabsh/commit/c0c99d1))

## v0.1.17

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.15...v0.1.17)

### Features

- **web:** Show the board, keys and an FAQ on the landing page ([d7c08ce](https://github.com/Blaise1030/tabsh/commit/d7c08ce))
- **board:** List layout beside the columns, as Linear's list view ([3257820](https://github.com/Blaise1030/tabsh/commit/3257820))
- **board:** Fade the list layout's top and bottom while rows are scrolled out ([560d731](https://github.com/Blaise1030/tabsh/commit/560d731))
- **board:** ⌘B steps through columns and list; no layout button ([b0aa984](https://github.com/Blaise1030/tabsh/commit/b0aa984))
- **board:** The Board button steps through terminals, columns and list ([8e17d81](https://github.com/Blaise1030/tabsh/commit/8e17d81))
- **app:** Comment on a selection and paste it into the terminal ([2c21b55](https://github.com/Blaise1030/tabsh/commit/2c21b55))

### Fixes

- **app:** Keep New card open when a selection is dragged onto the backdrop ([d6228b7](https://github.com/Blaise1030/tabsh/commit/d6228b7))
- **board:** No drawer-edge fade over the list layout ([6e62422](https://github.com/Blaise1030/tabsh/commit/6e62422))
- **web:** Start the landing demo after its fetch replacement ([f02698b](https://github.com/Blaise1030/tabsh/commit/f02698b))

## v0.1.16

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.15...v0.1.16)

### Features

- **web:** Show the board, keys and an FAQ on the landing page ([d7c08ce](https://github.com/Blaise1030/tabsh/commit/d7c08ce))
- **app:** Comment on a selection and paste it into the terminal ([2c21b55](https://github.com/Blaise1030/tabsh/commit/2c21b55))

### Fixes

- **app:** Keep New card open when a selection is dragged onto the backdrop ([d6228b7](https://github.com/Blaise1030/tabsh/commit/d6228b7))
- **web:** Start the landing demo after its fetch replacement ([f02698b](https://github.com/Blaise1030/tabsh/commit/f02698b))

## v0.1.15

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.14...v0.1.15)

### Fixes

- **web:** Refresh the daemon's embedded app after the board filter ([80dfa26](https://github.com/Blaise1030/tabsh/commit/80dfa26))

## v0.1.14

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.13...v0.1.14)

### Features

- **app:** Show About tabsh as a page of the palette ([8c8fc2b](https://github.com/Blaise1030/tabsh/commit/8c8fc2b))
- Install with brew install blaise1030/tap/tabsh ([871fa04](https://github.com/Blaise1030/tabsh/commit/871fa04))
- **app:** Coalesce the active tab's bursty output into one write a frame ([2891c35](https://github.com/Blaise1030/tabsh/commit/2891c35))
- Parked tabs still show unread and ring ([f06c0e4](https://github.com/Blaise1030/tabsh/commit/f06c0e4))
- **web:** Frame the real app on the landing page ([f7e48ed](https://github.com/Blaise1030/tabsh/commit/f7e48ed))

### Performance

- **daemon:** Start shells on the blocking pool, one start per session ([38fe0be](https://github.com/Blaise1030/tabsh/commit/38fe0be))

### Fixes

- **app:** Serialize terminal reconnects after sleep or tab switch ([a6258cc](https://github.com/Blaise1030/tabsh/commit/a6258cc))
- **app:** Attach terminal sockets only while on screen ([f9eaaf9](https://github.com/Blaise1030/tabsh/commit/f9eaaf9))
- **daemon:** Spawn shell on launch when none is attached ([1a1b327](https://github.com/Blaise1030/tabsh/commit/1a1b327))
- **app:** Connect visible terminals immediately; harden explorer e2e wait ([738d27e](https://github.com/Blaise1030/tabsh/commit/738d27e))
- **sessions:** Flush never holds the db while copying scrollback ([8d30985](https://github.com/Blaise1030/tabsh/commit/8d30985))
- **daemon:** Fall back to the account's login shell when $SHELL is unset ([81a2f41](https://github.com/Blaise1030/tabsh/commit/81a2f41))
- **sessions:** Copy replay history by slices, not byte by byte ([717cc4f](https://github.com/Blaise1030/tabsh/commit/717cc4f))
- **app:** Soften the board's horizontal scroll fade ([7fc0ba2](https://github.com/Blaise1030/tabsh/commit/7fc0ba2))
- **sessions:** Close the flush/shutdown and flush/restart scrollback races ([4383f41](https://github.com/Blaise1030/tabsh/commit/4383f41))
- Review of parked-tab activity (bells, throttle, upgrade, flake) ([828d913](https://github.com/Blaise1030/tabsh/commit/828d913))
- **app:** Review fixes for active-tab write coalescing ([6b2003d](https://github.com/Blaise1030/tabsh/commit/6b2003d))
- **daemon:** Close and prompt edits wait off the async workers ([b9b3d4b](https://github.com/Blaise1030/tabsh/commit/b9b3d4b))
- Park idle activity sweepers; send held output on exit ([d5f5e24](https://github.com/Blaise1030/tabsh/commit/d5f5e24))
- **app:** Draw the board's drop marker as a straight line ([8b56da0](https://github.com/Blaise1030/tabsh/commit/8b56da0))
- **web:** Keep the board filter across reloads ([bc467ac](https://github.com/Blaise1030/tabsh/commit/bc467ac))

## v0.1.13

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.12...v0.1.13)

### Features

- **board:** Show Archived as a column like the others ([efda3c3](https://github.com/Blaise1030/tabsh/commit/efda3c3))
- **board:** A hook's move puts the card at the end of its new column ([2111d1b](https://github.com/Blaise1030/tabsh/commit/2111d1b))
- **sound:** Pick the Needs input and Completed chimes ([13bbdc7](https://github.com/Blaise1030/tabsh/commit/13bbdc7))
- **board:** Agent providers, and resuming a card's agent after tabsh restarts ([4062d4f](https://github.com/Blaise1030/tabsh/commit/4062d4f))
- **board:** OpenCode, resumed and kept current by its plugin ([fc44e3a](https://github.com/Blaise1030/tabsh/commit/fc44e3a))
- **board:** New card laid out like Linear, with images ([af24f06](https://github.com/Blaise1030/tabsh/commit/af24f06))
- **board:** Filter cards by tag and folder from the tab bar ([1cb0618](https://github.com/Blaise1030/tabsh/commit/1cb0618))
- **board:** Fade scrolled columns and settle the drawer chrome ([17e0f95](https://github.com/Blaise1030/tabsh/commit/17e0f95))
- **board:** Add a New card shortcut and point the drawer close right ([c5c0d54](https://github.com/Blaise1030/tabsh/commit/c5c0d54))
- **board:** Edit a Backlog card, and show each card's agent ([ac23b3c](https://github.com/Blaise1030/tabsh/commit/ac23b3c))

### Fixes

- **e2e:** Follow the tag field and click the New card backdrop ([627710b](https://github.com/Blaise1030/tabsh/commit/627710b))
- **board:** Keep a card's menu whole over the column fades ([ab3338e](https://github.com/Blaise1030/tabsh/commit/ab3338e))

## v0.1.12

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.11...v0.1.12)

### Features

- **nav:** The place and its query string ([8a34912](https://github.com/Blaise1030/tabsh/commit/8a34912))
- **nav:** Tab switches are navigations, so Back and reload keep your tab ([a126ec7](https://github.com/Blaise1030/tabsh/commit/a126ec7))
- **board:** Opening the board is a navigation ([8b93737](https://github.com/Blaise1030/tabsh/commit/8b93737))
- **files:** The open file and line are part of the place ([2944af0](https://github.com/Blaise1030/tabsh/commit/2944af0))
- **explorer:** Opening the explorer is a navigation ([e5ff1bf](https://github.com/Blaise1030/tabsh/commit/e5ff1bf))
- **palette:** The palette is a place; Back closes it ([8d6c27f](https://github.com/Blaise1030/tabsh/commit/8d6c27f))
- **nav:** Back and Forward keybindings and palette entries; rebuild the embedded app ([23e3f0f](https://github.com/Blaise1030/tabsh/commit/23e3f0f))
- **sound:** Typing sounds everywhere in the app, and in the previewed pack ([8a56f16](https://github.com/Blaise1030/tabsh/commit/8a56f16))
- **ui:** VanJS, icons as tags, and keyed lists ([16ee973](https://github.com/Blaise1030/tabsh/commit/16ee973))
- **ui:** The page shell is components mounted from main ([b2cf913](https://github.com/Blaise1030/tabsh/commit/b2cf913))
- **sessions:** Tabs are components driven by session state ([6354f17](https://github.com/Blaise1030/tabsh/commit/6354f17))
- **sessions:** Tab groups and copies are rendered from state ([c23062f](https://github.com/Blaise1030/tabsh/commit/c23062f))
- **board:** The board is components driven by card state ([649c3bf](https://github.com/Blaise1030/tabsh/commit/649c3bf))
- **palette:** Palette pages are components ([0f46aae](https://github.com/Blaise1030/tabsh/commit/0f46aae))
- **explorer:** The sidebar's chrome is components ([8900696](https://github.com/Blaise1030/tabsh/commit/8900696))
- **files:** The file pane's chrome is components ([6d0ea8a](https://github.com/Blaise1030/tabsh/commit/6d0ea8a))
- **ui:** About and New card are components ([8e8ee2c](https://github.com/Blaise1030/tabsh/commit/8e8ee2c))
- **board:** Long card titles and notes clamp to two lines, with Show more; rebuild the embedded app ([10f00e0](https://github.com/Blaise1030/tabsh/commit/10f00e0))
- **board:** The board replaces the workspace and hides the tabs; card drags don't light the file drop ([6def26d](https://github.com/Blaise1030/tabsh/commit/6def26d))
- **board:** A card opens its terminal in a resizable drawer beside the board ([c3f26a3](https://github.com/Blaise1030/tabsh/commit/c3f26a3))
- **board:** A Move menu on each card and in the drawer's bar ([c546154](https://github.com/Blaise1030/tabsh/commit/c546154))
- **board:** A new card goes on top of its column ([3ead2b6](https://github.com/Blaise1030/tabsh/commit/3ead2b6))
- **board:** The Move menu is Basecoat's dropdown; a narrow shade at the drawer's edge ([52abf72](https://github.com/Blaise1030/tabsh/commit/52abf72))
- **board:** Needs input and Completed have no + button ([6c449e2](https://github.com/Blaise1030/tabsh/commit/6c449e2))
- **board:** Opening the board keeps the open tab in its drawer ([1ffc13e](https://github.com/Blaise1030/tabsh/commit/1ffc13e))
- **board:** A click on the board's empty space closes the drawer ([6fa27f7](https://github.com/Blaise1030/tabsh/commit/6fa27f7))
- **board:** A card's menu offers Archive and Delete session ([aba6968](https://github.com/Blaise1030/tabsh/commit/aba6968))
- **board:** A ⋯ button opens a card's menu; no separate Archive button ([2116e30](https://github.com/Blaise1030/tabsh/commit/2116e30))
- **board:** A Tags submenu in the card's menu ([68ea5ab](https://github.com/Blaise1030/tabsh/commit/68ea5ab))
- **board:** A desktop notification when an agent needs you or is done ([cd859ae](https://github.com/Blaise1030/tabsh/commit/cd859ae))
- **board:** A chime with each status notification ([6265f7d](https://github.com/Blaise1030/tabsh/commit/6265f7d))
- **board:** An archived card's Restore and Delete live in its menu ([0efb4c4](https://github.com/Blaise1030/tabsh/commit/0efb4c4))

### Fixes

- **app:** A reload no longer answers queries in the replayed scrollback ([c2131d2](https://github.com/Blaise1030/tabsh/commit/c2131d2))
- **nav:** Steps a superseded navigation never ran still run on the next one ([c2ba270](https://github.com/Blaise1030/tabsh/commit/c2ba270))
- **nav:** A tab switch overtaken mid-load is still undone ([54df52a](https://github.com/Blaise1030/tabsh/commit/54df52a))
- **nav:** The palette's Go back only skips the palette's own entry; the Back key just closes it ([10b672d](https://github.com/Blaise1030/tabsh/commit/10b672d))
- **nav:** A reload keeps focus in the terminal; a failed startup sync no longer stalls the router ([675612f](https://github.com/Blaise1030/tabsh/commit/675612f))
- **nav:** Back and Forward take the keyboard to where they land ([4bc81bd](https://github.com/Blaise1030/tabsh/commit/4bc81bd))
- **explorer:** Closing the explorer hands the keyboard back to the terminal ([57e27e3](https://github.com/Blaise1030/tabsh/commit/57e27e3))
- **sessions:** A session opened twice is one tab ([65fd0a3](https://github.com/Blaise1030/tabsh/commit/65fd0a3))
- **ui:** Back and forward icons; component state-reading rule ([a56452b](https://github.com/Blaise1030/tabsh/commit/a56452b))
- **ui:** Keyed items drop their derives when removed; the empty state waits for the first tab ([142a41b](https://github.com/Blaise1030/tabsh/commit/142a41b))
- **sessions:** Closing tabs collapse even when their group empties; regrouping doesn't regrow tabs ([46160af](https://github.com/Blaise1030/tabsh/commit/46160af))
- **board:** A drop clears the drag state without waiting for dragend ([4b87abe](https://github.com/Blaise1030/tabsh/commit/4b87abe))
- **sessions:** A session opened twice is one tab and one terminal ([06d57a7](https://github.com/Blaise1030/tabsh/commit/06d57a7))
- **sessions:** Tags from another window show up; pin vanjs-core to 1.6 ([833827c](https://github.com/Blaise1030/tabsh/commit/833827c))

## v0.1.11

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.10...v0.1.11)

### Features

- **board:** Search the new card's folder, and pick its tags as chips ([dbc13d6](https://github.com/Blaise1030/tabsh/commit/dbc13d6))
- **board:** Pick a new card's tags from a list, or create one ([3b68c80](https://github.com/Blaise1030/tabsh/commit/3b68c80))

## v0.1.10

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.9...v0.1.10)

### Features

- **board:** Tag a new card, and title it by its prompt ([fb0b8f2](https://github.com/Blaise1030/tabsh/commit/fb0b8f2))

## v0.1.9

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.8...v0.1.9)

### Features

- **board:** A card made outside Backlog starts its agent at once ([3028063](https://github.com/Blaise1030/tabsh/commit/3028063))

### Fixes

- **app:** Dropping a board card no longer types its id into the terminal ([28e7cdf](https://github.com/Blaise1030/tabsh/commit/28e7cdf))

## v0.1.8

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.7...v0.1.8)

### Features

- **board:** Card status columns on sessions ([be43de2](https://github.com/Blaise1030/tabsh/commit/be43de2))
- **board:** Status endpoint, hook rules and events socket ([cfad89c](https://github.com/Blaise1030/tabsh/commit/cfad89c))
- **board:** Shells know their card; new cards can start their agent ([4f35f58](https://github.com/Blaise1030/tabsh/commit/4f35f58))
- **web:** Board model ([3563556](https://github.com/Blaise1030/tabsh/commit/3563556))
- **web:** Card status glyphs on tabs, live board events ([034a6d4](https://github.com/Blaise1030/tabsh/commit/034a6d4))
- **cli:** Tabsh status sets the terminal's card ([bc7442d](https://github.com/Blaise1030/tabsh/commit/bc7442d))
- **web:** The board view ([b900ddd](https://github.com/Blaise1030/tabsh/commit/b900ddd))
- **web:** New card dialog ([c8d8f0c](https://github.com/Blaise1030/tabsh/commit/c8d8f0c))
- **cli:** Tabsh setup prints the agent setup guide ([f75e64a](https://github.com/Blaise1030/tabsh/commit/f75e64a))
- Embed the board in the app; e2e and docs ([acae46b](https://github.com/Blaise1030/tabsh/commit/acae46b))
- **settings:** Add Monokai theme ([3d2a8e8](https://github.com/Blaise1030/tabsh/commit/3d2a8e8))
- **board:** A card's agent starts when it's dragged to In progress ([a100733](https://github.com/Blaise1030/tabsh/commit/a100733))
- **board:** A setup screen until the board is onboarded ([9981e3f](https://github.com/Blaise1030/tabsh/commit/9981e3f))

### Fixes

- **board:** Quote prompts for fish, drop control characters, clear pending input first ([0c3b4cd](https://github.com/Blaise1030/tabsh/commit/0c3b4cd))
- **web:** Board keyboard target, drag-safe render, archive selector ([f2e6f09](https://github.com/Blaise1030/tabsh/commit/f2e6f09))
- **cli:** Refine setup guide for clarity and shell safety ([fa7c175](https://github.com/Blaise1030/tabsh/commit/fa7c175))
- Board review findings (long prompts, archive, pinned names, hook edge cases) ([4a81766](https://github.com/Blaise1030/tabsh/commit/4a81766))

## v0.1.7

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.6...v0.1.7)

### Features

- **app:** Keep the tab filter across reloads and inside new tabs and tab keys ([06e3c9d](https://github.com/Blaise1030/tabsh/commit/06e3c9d))
- **app:** Switch the tab filter from the palette ([ac0f22f](https://github.com/Blaise1030/tabsh/commit/ac0f22f))
- **app:** Group tabs by repo or tag instead of filtering them ([4d01ee1](https://github.com/Blaise1030/tabsh/commit/4d01ee1))
- **app:** Group labels as Basecoat badges, underlined like Chrome's groups ([c48c064](https://github.com/Blaise1030/tabsh/commit/c48c064))
- **app:** Drag tabs between tag groups ([10529d5](https://github.com/Blaise1030/tabsh/commit/10529d5))

### Fixes

- **app:** Keep a tab opened while a sync is on its way ([8674208](https://github.com/Blaise1030/tabsh/commit/8674208))

## v0.1.6

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.5...v0.1.6)

### Features

- **daemon:** Tab order, a tab's project root, and folders-only listings ([4af6fe9](https://github.com/Blaise1030/tabsh/commit/4af6fe9))
- **app:** Tab labels, filtering and reordering; full-width tab bar ([bae0ca9](https://github.com/Blaise1030/tabsh/commit/bae0ca9))

## v0.1.5

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.4...v0.1.5)

### Features

- **daemon:** GET /api/files/tree lists the tab's project for the explorer ([e913cb2](https://github.com/Blaise1030/tabsh/commit/e913cb2))
- **app:** A file explorer sidebar for the active tab's project ([357ec95](https://github.com/Blaise1030/tabsh/commit/357ec95))
- **daemon:** GET /api/files/watch tells the explorer what changed on disk ([3cdfe76](https://github.com/Blaise1030/tabsh/commit/3cdfe76))
- **app:** A row menu in the explorer: insert path, cd here, open in new tab ([247c51a](https://github.com/Blaise1030/tabsh/commit/247c51a))
- **app:** Reach a row menu's items from the keyboard ([1e9b4a7](https://github.com/Blaise1030/tabsh/commit/1e9b4a7))
- **app:** Live updates as tree operations ([d426ce2](https://github.com/Blaise1030/tabsh/commit/d426ce2))
- **app:** The explorer follows the disk while the sidebar is open ([423cabe](https://github.com/Blaise1030/tabsh/commit/423cabe))
- **daemon:** The watch socket follows its tab's project root ([b657567](https://github.com/Blaise1030/tabsh/commit/b657567))
- **app:** The explorer re-roots when the shell moves to another project ([583761b](https://github.com/Blaise1030/tabsh/commit/583761b))
- **app:** Search the file explorer by name ([77f7ad2](https://github.com/Blaise1030/tabsh/commit/77f7ad2))
- **app:** A keybinding that focuses the explorer's search field ([4ee9917](https://github.com/Blaise1030/tabsh/commit/4ee9917))

### Fixes

- **app:** Keep a key's focus move from being undone by the menu's first focus ([59ffb43](https://github.com/Blaise1030/tabsh/commit/59ffb43))
- **app:** The explorer's search field matches dark themes ([88914ef](https://github.com/Blaise1030/tabsh/commit/88914ef))

## v0.1.4

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.3...v0.1.4)

### Fixes

- **app:** Typing sound comes back on time after the Mac sleeps ([8174c59](https://github.com/Blaise1030/tabsh/commit/8174c59))

## v0.1.3

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.2...v0.1.3)

### Features

- **app:** Fade the file out under the pane header once scrolled ([73d5cfa](https://github.com/Blaise1030/tabsh/commit/73d5cfa))
- **daemon:** HEAD /api/files reports the file's version ([9a2bccb](https://github.com/Blaise1030/tabsh/commit/9a2bccb))
- **app:** Record custom keybindings from the palette ([2bf5015](https://github.com/Blaise1030/tabsh/commit/2bf5015))
- **app:** Click the pane divider to split equally ([a908b86](https://github.com/Blaise1030/tabsh/commit/a908b86))
- **app:** Reopen each tab's file after a reload, in the terminal's font ([c480420](https://github.com/Blaise1030/tabsh/commit/c480420))

### Fixes

- **app:** Drop 'unsafe-inline' from the app's script policy ([547298c](https://github.com/Blaise1030/tabsh/commit/547298c))
- **app:** Fade Markdown previews out under the pane header ([a8702c9](https://github.com/Blaise1030/tabsh/commit/a8702c9))

## v0.1.2

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.1...v0.1.2)

### Features

- Serve the app page from the daemon for Safari, plus keybindings ([b04ba39](https://github.com/Blaise1030/tabsh/commit/b04ba39))
- **app:** Configurable keybindings for settings and tab switching ([06d74b5](https://github.com/Blaise1030/tabsh/commit/06d74b5))
- **daemon:** Resolve and classify files for the file pane ([637dc5d](https://github.com/Blaise1030/tabsh/commit/637dc5d))
- **daemon:** Read files for the file pane ([cf5b699](https://github.com/Blaise1030/tabsh/commit/cf5b699))
- **daemon:** Save files from the file pane, refusing stale versions ([a4bef31](https://github.com/Blaise1030/tabsh/commit/a4bef31))
- **daemon:** Open a new tab in a given directory Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com> ([3c9215f](https://github.com/Blaise1030/tabsh/commit/3c9215f))
- **app:** Find URLs and paths in terminal output ([d8fd250](https://github.com/Blaise1030/tabsh/commit/d8fd250))
- **app:** Client for the daemon's file API ([66e558a](https://github.com/Blaise1030/tabsh/commit/66e558a))
- **app:** Open clicked paths in a read-only file pane ([6700d8e](https://github.com/Blaise1030/tabsh/commit/6700d8e))
- **app:** Edit and save files in the pane, with conflict detection ([039bf3b](https://github.com/Blaise1030/tabsh/commit/039bf3b))
- **app:** Resizable file pane and a choice of external editor ([f5d85e2](https://github.com/Blaise1030/tabsh/commit/f5d85e2))
- **daemon:** Serve the app's bundled scripts for its own copy of the page ([208d8d6](https://github.com/Blaise1030/tabsh/commit/208d8d6))
- **app:** Icon buttons and a full-height file pane ([b3502c3](https://github.com/Blaise1030/tabsh/commit/b3502c3))

### Fixes

- **app:** Sandbox SVG previews and load the file pane once ([04c1c35](https://github.com/Blaise1030/tabsh/commit/04c1c35))
- **app:** Focus the file pane on open and tighten save state ([1343f99](https://github.com/Blaise1030/tabsh/commit/1343f99))
- **daemon:** Require the token on the file API and harden file reads and saves ([1f85815](https://github.com/Blaise1030/tabsh/commit/1f85815))
- **app:** Trim link closers in linear time ([8fe145f](https://github.com/Blaise1030/tabsh/commit/8fe145f))

## v0.1.1

[compare changes](https://github.com/Blaise1030/tabsh/compare/v0.1.0...v0.1.1)

### Features

- Open the app in Safari via the daemon's own copy ([c1d6dc2](https://github.com/Blaise1030/tabsh/commit/c1d6dc2))

## v0.1.0


### Features

- **site:** Add a changelog page and automated release PRs ([8ec15b1](https://github.com/Blaise1030/tabsh/commit/8ec15b1))

