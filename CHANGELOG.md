# Changelog

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

