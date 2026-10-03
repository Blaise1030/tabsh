# File pane: clickable paths, preview and quick edits

Status: approved design, 2026-10-03.

## Intent

**Who and when:** you, at your own machine, working in tabsh in the browser.
Something in terminal output points at a file (a compiler error, a stack
trace, `ls`, `git status`) and you want to look at it or make a small fix
without switching to another editor.

**Success looks like:** Cmd/Ctrl-clicking a path opens the file beside the
terminal it came from, at the right line. You can make a small edit and save
it safely. For anything bigger, one click hands the file to your real editor.

**Out of scope:** quick-open or a fuzzy file finder, a file tree, several
files open in one pane, multi-file HTML sites, and becoming a full IDE
(LSP, project search). Phone and tablet layouts only need to not break.

**Constraints:**
- The pairing token already grants a shell. File access uses the same token,
  and nothing rendered from a file may ever reach that token.
- The daemon's own copy of the app (`src/app.html`, used by Safari) must
  keep working.
- `cargo install --git` must still build without npm.

## Architecture

There are four parts, each with one job.

1. **Link detection:** `web/src/app/links.ts` plus the hookup in
   `app/index.astro`. It finds URLs and paths in terminal output and
   reports them to xterm through `term.registerLinkProvider`.
2. **File API** in the daemon (`src/main.rs`): endpoints that resolve, read
   and save files, all behind the existing `guard`.
3. **File pane:** `web/src/app/file-pane.ts`. The split pane, with the
   preview and the CodeMirror 6 editor. It is loaded the first time it is
   used.
4. **Build and embedding:** Astro bundles the pane, the daemon embeds the
   bundle, and the daemon serves it at `/_astro/…`.

Flow: link detection → `openFile(session, path, line, col)` → file pane →
file API. The terminal code knows nothing about files beyond that one call.

The per-file `/files/{secret}/…` routes and the `opened` map that were
added to `src/main.rs` during exploration are removed. This design replaces
them.

## 1. Link detection

**URLs:** only `http://` and `https://`. Trailing `.,;:!?` is dropped, and so
is a trailing `)` unless the URL contains a matching `(`. A URL is always
underlined. Cmd/Ctrl-click opens it with
`window.open(url, '_blank', 'noopener,noreferrer')`.

**Paths:** a run of characters from `[\w.~@+/-]`, optionally followed by
`:line` or `:line:col`, that does not overlap a URL. It counts as a path in
either of these cases:
- it contains a `/`, is not only slashes, and contains a letter; or
- it is a bare `name.ext`, where the name starts with a letter and the
  extension (1 to 8 characters) contains a letter.

A trailing `.` is removed. With these rules, `1.2.3` and `e.g` don't count.
Rust's `--> src/main.rs:42:7` and stack traces such as `at foo
(/abs/x.js:10:5)` are matched by the same rule.

**Underlined only if the file exists:** before underlining a path, the page
sends `HEAD /api/files?session=…&path=…`. The path is underlined only on a
200. Results are cached per session for 5 seconds, keyed by the path text.

**Wrapped lines:** the provider joins a wrapped logical line by walking
`isWrapped` rows. It builds the text cell by cell, skipping the trailing half
of wide characters, so each text offset maps back to an exact `{x, y}` buffer
cell. A link may therefore span rows.

**Activation:** Cmd-click on Mac, Ctrl-click elsewhere. A plain click still
selects text. On hover, the terminal element's `title` is set to
"⌘-click to open" or "Ctrl-click to open". When a program is tracking the
mouse (`term.modes.mouseTrackingMode !== 'none'`), xterm gives the clicks to
that program as it does today.

**Interface:**
`findLinks(text: string): { kind: 'url' | 'path', start, end, text, line?, col? }[]`
is pure and tested on its own. `index.astro` turns these results into xterm
links.

## 2. File API

### Resolving a path

For each request with `session` and `path`:
1. Pick the base directory: the live shell's `process_cwd(pid)`, else the
   `sessions.cwd` column, else `$HOME`.
2. Expand `~` and `~/…` to `$HOME`. A relative path is joined onto the base
   directory.
3. Canonicalise the path. If that fails and the path starts with `a/` or
   `b/`, try again without the prefix (git diff paths).
4. If nothing resolves, return 404.

The canonical absolute path is returned to the client and used for every
later read or save, so a later `cd` in the shell has no effect on an open
file.

Access covers any file the daemon's user can read or write. The token
already grants a shell, so limiting this to a folder would add no real
protection.

### Endpoints

All of these go through `guard`, so they need the token and an allowed
Origin.

| Endpoint | Behaviour |
|---|---|
| `HEAD /api/files?session&path` | 200 if it resolves, otherwise 404 |
| `GET /api/files?session&path` | JSON `{path, kind, size, version, content?, eol?}` |
| `GET /api/files/raw?path` | The bytes of an absolute path, with its content type. Preview only. |
| `PUT /api/files` | Body `{path, content, version}`. 204 with a new `version` header, 409 `{version}` on a conflict, 413 if the content is too large. |
| `POST /api/sessions` | Now takes an optional `{cwd}`, so a clicked directory can open a new tab there. |

- **`kind`:** one of `dir`, `text`, `html`, `markdown`, `svg`, `image`,
  `pdf`, `binary`. A file counts as text when it is valid UTF-8 with no NUL
  bytes. `html`, `markdown` and `svg` are text kinds picked by extension, so
  they can be edited as source.
- **`content`:** included only for text kinds up to **2 MB**. Above that,
  `kind` stays the same and `content` is left out (the "too large" case).
  `/raw` serves up to **50 MB** and returns 413 above that.
- **`eol`:** `"crlf"` if the file's first line break is `\r\n`, otherwise
  `"lf"`.
- **`version`:** `"<mtime nanoseconds>-<size>"`.
- **Errors:** missing → 404, permission denied → 403, too large → 413.

### Saving

1. Re-read the file's metadata. If its version doesn't match the one sent,
   return 409 with the current version.
2. Write the new content to `.<name>.tabsh-<random>` in the same directory,
   fsync it, and copy the original file's permissions onto it.
3. Rename it over the canonical path. Writing to the canonical path means a
   symlink is left in place and the file it points to is edited.
4. Return the new version.

The client converts line endings back to `\r\n` before sending if
`eol === "crlf"`.

## 3. Rendering, and what it can reach

| Kind | Rendered as | Why that's safe |
|---|---|---|
| image, svg | `<img src=blob:…>` built from `/raw` | Scripts never run inside an image. |
| pdf | `<iframe src=blob:…>` built from `/raw` | The browser's own PDF viewer. |
| html | `<iframe sandbox="allow-scripts allow-popups" srcdoc=…>` | Without `allow-same-origin`, the frame's origin is opaque. It cannot read `localStorage` or the parent page. A daemon call from it carries `Origin: null` and `guard` refuses it. |
| markdown | Rendered to HTML, then shown in the same sandboxed iframe with no `allow-scripts` | |

Known limitation: files an HTML page loads relatively (CSS, JS, images next
to it) do not load.

**CSP:** in both `web/public/_headers` and `APP_CSP`, add `blob:` to
`img-src`, and add `frame-src blob:`. Before relying on it, check whether
`srcdoc` frames need anything more under `default-src 'none'`. The daemon
also needs `script-src 'self'` to load `/_astro/…`, which it already has.

## 4. The file pane

**Layout**
- Each session has its own pane state `{path, kind, version, eol, dirty, mode}`.
  Switching tabs shows that tab's pane, or none.
- The pane sits to the right of `#terms` with a draggable divider. It starts
  at 50% and the width is stored in settings as `paneWidth`. After the width
  changes, the terminal is refit and `sendSize` is called.
- Below 800px wide, the pane covers the terminal instead of splitting it.
- One file per pane. Opening another file replaces it, after asking if there
  are unsaved changes.
- Clicking a directory doesn't open the pane. It calls
  `POST /api/sessions {cwd}` and activates the new tab.

**Header:** the path relative to the session's directory (absolute path in
the `title`), a ● when dirty, **Edit/Preview**, **Open in editor** and **✕**.

| Kind | Initial view | Edit |
|---|---|---|
| text | CodeMirror, read-only, at `line`/`col` with that line highlighted | The same view becomes editable |
| markdown, html, svg | Rendered | Switches to CodeMirror source |
| image, pdf | Rendered | Not offered |
| binary | "Binary file, 3.2 MB" | Not offered |
| too large | "Too large to open here (60 MB)" | Not offered |

**Languages:** chosen by extension: JS/TS, Rust, Python, Go, JSON, YAML,
TOML, HTML, CSS, Markdown, and shell (through the legacy-modes package),
falling back to plain text. Each language is loaded with `import()` when it
is first needed.

**Theme:** CodeMirror's colours come from the active terminal theme, the
same way the Basecoat interface does today.

**Keys**

| Key | Action |
|---|---|
| ⌘/Ctrl-S | Save |
| ⌘/Ctrl-E | Toggle Edit/Preview |
| Esc | Focus the terminal, keeping the pane open. CodeMirror's own Esc (closing search) happens first. |

⌘/Ctrl-W is not used. The command palette gets a "Close file" entry.

**Saving:** shows "Saved" briefly in the header. On an error, the header
shows the message and the edits are kept. On a 409, a bar says "Changed on
disk since you opened it", with **Reload** or **Overwrite**. Overwrite
resends using the version from the 409.

**Unsaved changes:** closing the pane, closing the tab, or opening another
file asks first, and so does reloading the browser (`beforeunload`).

**Open in editor:** a setting `editor`, either `vscode` (the default),
`cursor` or `zed`. It opens `<scheme>://file/<abs path>:<line>:<col>`.

## 5. Build and embedding

- The existing `is:inline` script stays inline. Astro can't bundle imports
  from an inline script, so a second, Astro-processed `<script>` defines
  `window.tabshOpenFile = async (...a) => (await import('../../app/file-pane.ts')).openFile(...a)`.
  Vite turns `file-pane.ts` and CodeMirror into hashed chunks under
  `dist/_astro/`. The inline script's link handler calls
  `window.tabshOpenFile`.
- `web/package.json`'s `build` also copies `dist/_astro/` into
  `src/app-assets/`, replacing what was there. Both are committed, so
  `cargo install --git` builds without npm.
- `build.rs` embeds `src/app-assets/**` into `APP_ASSETS: &[(&str, &[u8])]`,
  the same way it embeds `SOUNDS`.
- New daemon route `GET /_astro/{name}` serves those files with
  `Cache-Control: max-age=31536000, immutable` and `nosniff`.
- CI's step that checks `src/app.html` is up to date also checks
  `src/app-assets/`.

## 6. Errors

| Situation | Shown |
|---|---|
| 404 (deleted after hover) | "Not found: <path>" in the pane |
| 403 | "Permission denied" |
| 413 | "Too large to open here (<size>)" + Open in editor |
| Network failure on save | Error in the header, edits kept, can retry |
| 409 | Conflict bar (Reload / Overwrite) |
| Bundle fails to load | "Couldn't load the editor", with Retry |

## 7. Testing

- **Rust unit tests** in the existing `#[cfg(test)]` module:
  - path resolution: relative, `~`, a symlink, the `a/`/`b/` fallback, and a
    missing path;
  - text detection;
  - version format;
  - saving keeps the file's permissions and the symlink, and returns a new
    version;
  - a stale version returns 409.
- **`web/src/app/links.test.ts`**, run with `node --test` (Node 24 strips
  TypeScript types). Cases:
  - a URL in brackets, and a URL with a trailing period;
  - `path:line:col` and a Rust `-->` line;
  - a Node stack-trace line;
  - `ls` output;
  - `and/or`, `1.2.3` and `e.g.`.

  Wired into CI's web job.
- **Manual checks**, in Chrome on tabsh.cc and Safari on the daemon's copy:
  - Cmd-click opens at the line;
  - edit and save;
  - a conflict after changing the file in vim;
  - CRLF line endings survive a save;
  - an HTML file's script can't read `localStorage`;
  - blob image, PDF and `srcdoc` previews aren't blocked by the CSP;
  - `/_astro/` loads from the daemon;
  - the divider resizes the shell (check `stty size`);
  - the narrow-screen overlay.
