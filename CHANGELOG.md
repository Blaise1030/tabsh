# Changelog

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

