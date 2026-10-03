# Problem statement: a terminal that lives in a browser tab

## The problem

Developers, and web developers in particular, spend most of their day in the browser. They keep their local app (`localhost:3000`), docs, pull requests, issue trackers and AI chats there. The terminal is the one essential tool that lives somewhere else.

That split costs something every day:

- **Constant switching between apps.** Every time they move between the terminal and the browser, they ⌘-Tab to a different app and lose their place. Tab shortcuts don't reach the terminal, and window layouts have to be managed twice.
- **Work is spread across apps.** A project's dev server and logs sit in one app. Its preview, docs and pull request sit in another. Nothing groups them together, and nothing closes them together.
- **Moving content between them is awkward.**
  - Links printed in the terminal open in a browser window somewhere else.
  - Images seen on the web, such as mockups, screenshots and error captures, can't be dropped straight into a terminal prompt. Prompts for AI coding agents like Claude Code increasingly need exactly that.
- **Native terminals are hard to change.** Adding a command palette, a theme switcher or a visual cue means writing native or GPU code, or waiting for the vendor.
- **Session state depends on the window.** If the terminal window closes or the app restarts, the shells, scrollback and working folders are gone, unless the user sets up and maintains tmux.

## The goal

Make the terminal **one more tab in the workspace the developer already lives in**, on their own machine. Multi-device or remote access is not the goal.

## What a browser tab gives us

| Need | How a browser tab meets it |
| --- | --- |
| One place to work | The terminal, the app preview, docs and pull requests are tabs in the same window. The browser's tab shortcuts switch between them. |
| Side-by-side work | The browser's split view or a second window puts the terminal next to the page it serves. |
| Grouping and organisation | Pin it, put it in a tab group with the project's other tabs, or bookmark it. |
| Links | URLs printed by dev servers, test reports or `gh` open as tabs right next to the terminal. |
| Drag and drop | Images and files dragged from web pages or Finder drop straight onto the prompt. This is useful for AI agents. |
| Built-in tools | The browser's find, zoom, copy, paste and screenshot tools work with no extra effort. |
| Easy to change | The interface is HTML and CSS. It can be inspected with DevTools, edited live and reloaded, and new features take minutes to add. |
| More than text | Image previews, buttons on links, a command palette and themes are ordinary HTML over the terminal. |
| Sessions that survive | A local daemon owns the shells. Closing the tab or restarting the browser loses nothing, and tabsh restores tabs, scrollback and working folders. |

## Approach (tabsh)

- A small Rust daemon on localhost holds the shells. It saves tabs, scrollback and working folders to SQLite at `~/.tabsh/state.db`.
- A single HTML page renders the terminals with xterm.js and adds tabs, a command palette, themes and drag-and-drop.
- Requests are accepted only when their origin is the page itself.

## Known trade-offs

- **Keys the browser keeps.** Shortcuts such as Ctrl+Tab, ⌘W, ⌘T and ⌘⇧[ ] never reach the page. Tab switching uses Ctrl+Shift+[ and ] instead. Running tabsh as an installed web app frees up more keys.
- **The browser hides file locations.** A dropped file's path on disk is never exposed, so dropped files are uploaded to the daemon (`~/.tabsh/uploads/`) and that path is used instead.
- **Permission prompts.** Clipboard access and notifications need the browser's permission.
- **Latency.** Keystrokes pass through a WebSocket and are drawn by JavaScript. Most of the time this isn't noticeable, but heavy output feels less snappy than a GPU-drawn native terminal.
- **Security.** Anything that can reach the port gets a shell, so the daemon must stay on localhost or behind real authentication.

## Non-goals

- Access from other devices, or remote access.
- Replacing a full IDE.
- Out-performing GPU-accelerated native terminals.
