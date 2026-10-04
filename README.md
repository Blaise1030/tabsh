# tabsh

Your terminal, in a browser tab. A small Rust daemon runs your shells on your
machine. Open them from any browser tab at https://tabsh.cc, and they survive
reloads, restarts and closed laptops.

```sh
cargo install --git https://github.com/Blaise1030/tabsh
tabsh   # opens the app in your browser, paired
```

Safari (and every iOS browser) won't let https://tabsh.cc reach the daemon, so
tabsh also serves the app itself, and tabsh.cc sends Safari there:
`http://tabsh.localhost:7681`. File → Add to Dock opens it like an app.

Set `TABSH_NO_BROWSER=1` to start without opening a browser (e.g. as a service);
it's skipped over SSH and on Linux without a display anyway.

## Why a browser tab?

Look at where your work happens. The issue is in a tab. So are the pull request,
the docs, the design, the chat with your team, the AI you ask for help, and the
app you're building, running on localhost.

The browser has quietly become where we work. The terminal is the last tool
still in a separate window, one ⌘-Tab away from everything it touches.

tabsh brings it home: the terminal sits where the work already is, in the tab
next to the thing it builds.

## Features

| Feature                  | What it means                                |
| ------------------------ | -------------------------------------------- |
| Shells outlive the tab   | Close, reload or quit; they reattach         |
| Survives restarts        | Tabs, folders and scrollback are restored    |
| Drop files in            | Dragged files type their path                |
| Bells you notice         | The tab rings and the favicon gets a badge   |
| Themes and fonts         | 10 themes, 9 fonts and a ⌘K palette          |
| Nothing leaves localhost | Keystrokes stay on 127.0.0.1                 |

## How it connects

The app is a plain web page. It talks to the daemon on your own machine at
`http://127.0.0.1:7681`, with no server of ours in between.

```
[ browser tab ]     tabsh.cc/app/
       │
       │  HTTP + WebSocket, 127.0.0.1 only
       ▼
[ tabsh daemon ]    your machine
       │
       │  PTY
       ▼
[ your shells ]     zsh, bash, fish…
```

1. **Run the daemon.** It listens only on loopback and creates a secret token in
   `~/.tabsh/token`.
2. **Open the link it prints.** The token is in the URL fragment, which browsers
   never send to a web server.
3. **That's it.** The daemon only accepts requests that come from the tabsh app and
   carry the token. Other sites get nothing.

Chrome may ask to let the site access apps on your device. That's the connection
to the daemon; allow it once. Lost the link? Open `http://127.0.0.1:7681` in the
same browser and the daemon sends you back to the app, paired.

## Working on the app page

The daemon embeds a copy of the app page (`src/app.html`). `npm run build` in
`web/` refreshes it; commit it along with your changes, or CI fails.

To build the app page and start a development daemon, run from the repo root:

```sh
(cd web && npm install && npm run build) && TABSH_DB=target/dev/state.db TABSH_ORIGINS= cargo run -- 7682
```

It runs beside your everyday tabsh on 7681, with its own port, sessions and
token. The empty `TABSH_ORIGINS` makes it open its own build of the app at
`http://tabsh.localhost:7682` instead of https://tabsh.cc.

## Commits and releases

Commit messages (or squash-merge PR titles) follow
[Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`,
`perf: …`, and `!` for breaking changes (`feat!: …`). Other types (`chore`, `ci`,
`docs`, `refactor`, …) are fine too but stay out of the changelog.

Releases are automatic:

1. Every push to `main` updates a **`chore(release): vX.Y.Z`** pull request.
   [changelogen](https://github.com/unjs/changelogen) writes the new
   `CHANGELOG.md` section and bumps the version (in `package.json`, copied into
   `Cargo.toml`).
2. Merging that PR builds the daemon for macOS and Linux and publishes a GitHub
   release with the changelog section as its notes.

Before 1.0, `feat` and `fix` bump the patch version and breaking changes bump the
minor version. To release a specific version, run the **Release PR** workflow by
hand with a `version`.

## License

MIT — see [LICENSE](LICENSE).
