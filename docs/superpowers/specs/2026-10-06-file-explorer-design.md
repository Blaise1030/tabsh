# File explorer: a live sidebar for the tab's project

Status: approved design, 2026-10-06.

## Intent

**Problem:** the file pane opens a file only when its path is printed in a
terminal. To find a file you have to `ls` around, and nothing shows the shape
of the project the tab is working in. Warp solves this with a file tree
beside the terminal.

**Success looks like:**
- A sidebar on the left shows the active tab's project as a tree.
- The tree is always current: files and folders created, deleted or renamed
  on disk (by you, an agent, `git checkout`, a build) show up within about a
  second, with no refresh button and no polling from the page.
- It follows the shell: `cd` into another project, or switch to a tab in
  another project, and the tree re-roots.
- Clicking a file opens it in the existing file pane. A row's menu offers:
  insert its path at the prompt, `cd` there, open a new tab there.

**Non-goal (from `PROBLEM.md`, "Replacing a full IDE"):** the tree is a
navigator for the terminal. No rename, delete, create, drag-to-move, git
status badges or search in this feature. The shell beside it does those.

## Behaviour

### Root

The tree's root is the nearest ancestor of the tab's working directory
(`sessions::cwd()`) that holds a `.git` entry. Without one, it is the working
directory itself.

### Listing

`GET /api/files/tree?session=<id>` returns
`{ "root": "/abs/root", "paths": ["README.md", "src/", "src/main.rs"], "truncated": false }`.

- The walk uses the `ignore` crate: `.gitignore`, `.git/info/exclude` and the
  global excludes are respected, even outside a git repo. Dotfiles are shown,
  and `.git/` itself is never listed.
- Directories end in `/`, so empty folders show up.
- The walk stops at **20,000 paths** with `truncated: true`. The page then
  shows "Too many files to show here. `cd` into a project." instead of a
  partial tree. A root like `~` without a repo lands here.
- It is a `/api/files*` route, so the guard's rule already covers it: from a
  page it needs a known Origin and the token, and without an Origin it still
  needs the token.

### Live updates

`GET /api/files/watch?session=<id>&token=…` is a WebSocket. The token goes in
the query string, as for the terminal sockets.

- The daemon watches the root recursively with the `notify` crate (FSEvents
  on macOS, inotify on Linux). One watcher per root is shared by every socket
  on that root, and it is dropped with the last socket.
- Events are coalesced over 100 ms. Each changed path is checked on disk
  after the window, then sent as `{"add": [...], "remove": [...]}` with paths
  relative to the root (directories ending in `/`). A rename is a remove and
  an add. A new directory brings its walked children.
- Paths the listing would skip (ignored, `.git/`) are not sent.
- `{"reset": true}` is sent instead of a batch when the batch is larger than
  1,000 paths, when the backend reports a rescan or overflow, or when a
  `.gitignore` changed. The page then re-fetches the listing.
- A truncated root gets no watcher.

### Following the shell

While a socket is open, the daemon checks the session's root about once a
second (`sessions::cwd()` is a cheap `proc_pidinfo`/`/proc` read). When it
changes it sends `{"root": "/new/root"}` and moves the socket to the new
root's watcher. The page re-fetches the listing. Switching tabs closes the
socket and opens one for the new active tab.

### Page

- A new app feature, `web/src/app/explorer/`, sits between `sessions` and
  `palette` in the dependency order. It uses `files/open.ts` (`openInPane`)
  and `sessions/store.ts` (the active tab, its terminal).
- The tree is drawn by `@pierre/trees` (vanilla `FileTree`, pinned to an
  exact version: it is a beta). It is about 1.4 MB unpacked, so, like the
  editor, it is only reached through `import()` when the sidebar first
  opens. A daemon test keeps it out of the first page load.
- Batches apply through `FileTree.batch()`, and re-fetches through
  `resetPaths()`. `batch` keeps open folders and the selection; `resetPaths`
  closes every folder unless given `initialExpandedPaths`, so the page
  passes the open ones and re-selects the selection.
- Colors come from the tabsh theme: `--trees-*` custom properties are set in
  `app.css` from the app's own variables. They inherit into the tree's
  Shadow DOM. `unsafeCSS` is not used.
- The sidebar is `<aside id="explorer">` left of `#main`, with a divider. It
  toggles from a tab-bar button, a palette entry and a keybinding (default
  Mod+Shift+E, rebindable like the others). Whether it is open and its width
  are settings (`explorerOpen`, `explorerWidth`).
- Row menu (the library's context menu): **Insert path** pastes the
  shell-quoted absolute path into the tab's terminal through `term.paste()`,
  the same way drop does. **cd here** pastes `cd -- '<dir>'` without pressing
  Enter, because the front program may not be the shell. **Open in new tab**
  calls `newTabAt()`.

## Security

- No new power: a token holder already has a shell. The listing and watcher
  only reveal names, and they sit behind the guard's `/api/files*` rule.
  Both routes are added to `every_route_is_guarded`.
- File names are untrusted (a cloned repo can hold a file named
  `<img src=x onerror=…>`). They must be rendered as text. The walking
  skeleton proves the library does this with an e2e test on such a name,
  before anything else builds on it.
- No CSP change: `style-src` already allows inline styles, `unsafeCSS` is
  unused, and the library runs without `eval`.

## Dependencies

- Daemon: `ignore`, `notify`.
- App: `@pierre/trees` (exact version), with its required `react` and
  `react-dom` peers (unused by the vanilla entry).
