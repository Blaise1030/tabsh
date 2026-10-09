# Markdown comments: highlight a passage, tell Claude what to change

Status: design for review, 2026-10-09.

## Intent

**Who and when:** you, reviewing a Markdown file (a plan, a spec, a README)
in a tab's file pane, with Claude Code running in that tab's terminal.

**Success looks like:** you select a passage in the rendered preview, write
what should change, and repeat. One click pastes all of it into that tab's
Claude prompt as "Make these changes to `<path>` for me:", one line per
comment, each with its source lines and the quoted text. Claude knows exactly
which words you mean. You read the message and press Enter yourself.

**Out of scope:**
- comments on the source view, or on HTML, SVG or text files;
- keeping comments across a page reload (they live in the page);
- writing comments into the file or a sidecar file;
- sending to a terminal other than the tab's own;
- threads, replies, resolving.

**Constraints:**
- Nothing in a Markdown file may run script or reach the token (see
  Security).
- Existing styles don't change. The feature only adds rules, on classes of
  its own.
- It reuses the app's own pieces: the row menu's surface, Basecoat's
  `.textarea` and `.btn`, the pane header's ghost icon buttons, and the
  icons in `ui/icons.ts`.

## What you see

These are the behaviours tried in the mockup.

1. **Select text in a Markdown preview.** A small **Comment** button floats
   just above the selection. It has the row menu's surface, sized to its one
   item, with a message-square-plus icon (muted, brightening on hover) and
   the label "Comment". When there's no room above the selection, under the
   pane header, it goes below instead. A click anywhere else, or a new
   selection, puts it away.
2. **Click Comment.** In its place, a box opens with the same surface:
   - the quoted text, on one muted line;
   - a `.textarea` with the placeholder "What should change?";
   - Cancel (`btn`, outline, sm) and Comment (`btn`, sm).

   ⌘Enter (Ctrl-Enter elsewhere) saves and Esc cancels. Esc here doesn't
   send focus to the terminal.
3. **The passage stays highlighted.** The highlight is drawn with the CSS
   Custom Highlight API, so the document's DOM is never changed. It's one
   amber in every theme, like a marker pen:
   - dark themes: a tint of `oklch(0.8 0.15 75)` at 30% over the
     background, with a 2px underline in it;
   - light themes: an `oklch(0.93 0.08 85)` tint, with a 2px
     `oklch(0.72 0.16 70)` underline.

   It is never the theme's selection colour. The mockup checked this in all
   13 themes.
4. **Hover a highlight to see its comment.** A card in the row menu's look
   shows the note, the line range in muted monospace (`L7-8`), and two ghost
   icon-xs buttons, edit (pencil) and delete (x).
   - It stays while the pointer is on it, and hides 250 ms after the pointer
     leaves both the highlight and the card. Scrolling the preview hides it
     at once.
   - Edit opens the comment box in the card's place, filled in, with a Save
     button. Delete removes the comment and its highlight.
5. **Send.** A ghost icon-sm button with Lucide's `send` icon appears in the
   pane header, just before the Edit toggle, once there's a comment. Its
   tooltip says "Send 2 comments to Claude".
   - Pressing it pastes the message into the tab's terminal with xterm's
     `paste` (bracketed paste, the same path as dropping a file). No Enter
     is pressed.
   - Focus moves to the terminal, and the comments and highlights are
     cleared.
   - If the tab's terminal is closed, the button is disabled, and its
     tooltip says why.

**The message:**

```
Make these changes to docs/architecture.md for me:
- line 3, "tabsh has two parts:": Make this a full sentence.
- lines 7-8, "The daemon also embeds a built copy of": Say why it embeds the app in one clause.
```

- **The path** is the one the pane header shows: relative to where it was
  opened from when that's how it was asked for, absolute otherwise.
- **Lines** are the source line range of the Markdown blocks the selection
  starts and ends in. One row of a table gives the whole table's range.
- **The quote** has its whitespace collapsed, and is cut at 200 characters
  with "…".
- **The note** is joined onto one line.
- **Order** is the order the comments were made in.

**Comments live with the tab's file view**, in the page:
- They stay while you switch tabs.
- Switching to the source view (⌘E) and back hides and then restores them.
- A theme change keeps them. The frame's theme style is swapped in place
  rather than the whole frame being rebuilt.
- They count as unsent work. Closing the file, opening another one in the
  tab, or leaving the page asks first ("Discard 2 unsent comments?"), the
  way unsaved edits do (`confirmDiscard`, `hasUnsaved`).

**When the file changes on disk** while comments are waiting (for instance
Claude edits it), the preview re-renders and each comment's quote is looked
for again:
- First in the blocks around its old lines, then anywhere in the document.
- When it's found, the highlight comes back and the line range is updated.
- When it isn't found, the comment is still sent with its original lines and
  quote. The header's `.pane-status` says "1 comment no longer matches the
  file". With no highlight, it can't be hovered, so it can only be cleared by
  Send.

## Architecture

All of it is in `files/`, which is already lazy: it's reached only through
`pane.ts`.

| Unit | Job | Depends on |
|---|---|---|
| `files/comments.ts` (pure, `node --test`) | The comment model, `blocks(src)` (the top-level Markdown tokens with their source line ranges, from `marked`'s lexer), and `message(path, comments)` (the text pasted) | `marked` types only |
| `files/preview-frame.ts` | The script that runs **inside** the preview frame. It reports selections (quote, start and end block lines, a rect) and hovers to the pane, draws and removes highlights, re-finds quotes after a re-render, and swaps the theme style. It holds no comment text: only ranges by id | nothing; it is built as its own asset |
| `files/annotate.ts` | The pane side. It listens to one frame's messages, places the Comment button, the box and the hover card over the frame, keeps a view's comments as a `van.state`, and sends. Components follow the architecture rules: VanJS tags, user text as child strings, never markup | `ui/icons.ts`, `comments.ts` |
| `files/pane.ts` (changed) | Markdown previews render through `blocks()`. Each block is wrapped in `<div data-from data-to>`, and the frame gets the new sandbox, its own CSP and `preview-frame` (see Security). It mounts `annotate.ts` on a Markdown view, adds the Send button to the header, counts comments in `hasUnsaved` and `confirmDiscard`, and swaps the theme in place | |
| `Host.paste(sessionId, text): boolean` (new) | `main.ts` finds the session in `store.sessions`; when it's open, it calls `term.paste(text)`, focuses it and returns `true`. `files` stays below `sessions`: it gets this through `Host`, like `newTabAt` | `sessions/store.ts` (in `main.ts` only) |
| `ui/icons.ts` | Adds `send` and `messageSquarePlus` (Lucide) | |
| `styles/app.css` | Appends one block for `.comment-menu`, `.comment-box`, `.comment-hover`. No existing rule changes | |

**Messages between the frame and the pane**

The pane checks `e.source === frame.contentWindow` and the frame checks
`e.source === parent`. Each side checks every field's type and drops anything
else.

- From the frame:
  - `select {quote, from, to, rect}`
  - `clear`
  - `hover {id, rect}`
  - `unhover`
  - `scroll`
  - `located {id, from, to} | lost {id}` (after a re-render)
- From the pane:
  - `keep {id}` (keep the selection just reported as comment `id`)
  - `drop {id}`
  - `dropAll`
  - `locate {id, quote, from, to}` (after a re-render)
  - `theme {css}`

**Building the frame script.** It must be its own classic script under
`/_astro/`, so the frame's CSP can name exactly that one URL. It must also
not be in the page's first load (`entry_script_does_not_bundle_the_editor`
keeps checking). `pane.ts` learns its hashed URL at build time. The plan
picks the mechanism, either Vite's `?worker&url` or a second Rollup input,
and checks that the daemon embeds and serves the file. It already serves
every file in `src/app-assets`.

## Security

This changes one invariant in `docs/architecture.md`.

**Before:** Markdown and SVG render in `<iframe sandbox="">`.

**After:**
- SVG still renders in `<iframe sandbox="">`.
- Markdown renders in `<iframe sandbox="allow-scripts">`, whose `srcdoc`
  begins with its own
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src <origin>/_astro/<preview-frame asset>; style-src 'unsafe-inline'; img-src data: blob:">`.
- The only script that runs there is tabsh's own.

**Why that holds:**
- **No `allow-same-origin`.** The frame's origin stays opaque, so it can't
  read the page, its storage or the token. This is the same as HTML previews
  today, which already run with `allow-scripts`.
- **Two CSPs apply, and both must allow a script.**
  - The page's CSP is inherited by the `srcdoc` document. It has no
    `'unsafe-inline'`, so inline `<script>` and `on…=` attributes in the
    Markdown don't run.
  - The frame's own CSP allows exactly one script URL. A
    `<script src=…>` in the Markdown pointing anywhere else, another
    `/_astro/` file or the CDN included, is blocked.
  - Markdown can only add a `<meta>` CSP later in the document, which can
    only tighten.
- **The frame can't be navigated to an attacker's page.** That page would
  bring its own CSP and could forge messages. But navigating a child frame
  is governed by the page's `frame-src`, which is `blob:` only, so a link, a
  `<meta http-equiv="refresh">` or a form in the Markdown can't load a page
  of the attacker's there.
- **Nothing is typed without you.** The pane only pastes on your click of
  Send, and only into the tab's own terminal. It never presses Enter. A
  quote is text from the file you're already reading.
- **The daemon's guard doesn't change.** The script request carries no
  `Origin`, and `/_astro/{name}` is already served without the token.
- **The page CSP doesn't change.** `web/public/_headers` and `APP_CSP` stay
  in step as they are.

**The spike** (Chromium, the page's CSP emulated; throwaway):
- the frame script loaded and ran with origin `null`;
- inline `<script>`, `onerror=`, a second `/_astro/` script and a CDN script
  placed in the Markdown were all blocked;
- selection and highlight both work.

Safari wasn't checked; the plan has a manual Safari step.

**Tests that pin it:**
- `pane.ts`'s Markdown `srcdoc` starts with the frame CSP naming only the
  frame asset, and the frame's sandbox is exactly `allow-scripts`;
- e2e: a Markdown file with inline script, an event handler and an extra
  `/_astro/` script sets nothing the page can see;
- the existing `pages.rs` CSP tests still pass unchanged.

## Errors and edge cases

- **An empty or whitespace-only selection,** or one outside any block (the
  page margin), shows no button.
- **A selection that crosses blocks** takes the first block's start line and
  the last block's end line.
- **A frame that is rebuilt** (the ⌘E round trip, or a change on disk)
  re-locates every comment, as described under "When the file changes on
  disk".
- **The frame script failing to load** (an old cached page, an unknown
  browser): the preview still renders exactly as today, with no Comment
  button and no Send button.
- **Paste failing** (the terminal closed between hover and click): the
  status says "Terminal closed", and the comments are kept.

## Testing

- **Unit tests (`comments.test.ts`):**
  - `blocks()` line ranges for headings, paragraphs, lists, tables, fenced
    code, front matter and CRLF;
  - `message()` formatting: one line versus a range, quote collapse and
    truncation, multi-line notes, the path as shown.
- **e2e (Playwright, real daemon):**
  - open a `.md`, select, comment, hover, edit, delete;
  - Send pastes the expected text at the tab's prompt;
  - comments survive a theme change and a tab switch;
  - closing the file with comments asks first;
  - the script-blocking checks above.
- **Manual:**
  - Safari, the daemon's own copy of the page;
  - a light and a dark theme;
  - a long document, where the hover card and the button stay inside the
    pane.
- **Repository checks:** all of those in `docs/architecture.md`, including
  `npm run build` refreshing `src/app.html` and `src/app-assets/`.
