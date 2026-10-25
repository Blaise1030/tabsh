# Demo video

**File:** `docs/launch/assets/tabsh-demo.webm` (1280 × 720, 24.7s, silent,
captioned in-frame). Recorded from the scripted demo, so it shows the real app
without a real agent or anyone's code.

For Product Hunt, upload it to YouTube (unlisted is fine) and paste the link in
the listing's video field. YouTube accepts WebM. If you want an MP4, convert it
first (`ffmpeg -i tabsh-demo.webm -c:v libx264 -pix_fmt yuv420p tabsh-demo.mp4`);
the ffmpeg bundled with Playwright cannot encode H.264.

## What it shows

| Time | Picture | Caption |
| --- | --- | --- |
| 0:00 | Board with cards in Backlog, In progress, Needs input, Completed | "Your agents are already working." → "The board moves as they do." |
| 0:10 | The same cards as one list across projects | "Every project. One list." |
| 0:13 | A card opens; the chat drawer shows the conversation | "An agent needs a decision." |
| 0:16 | A reply is typed and sent | "Answer without leaving the tab." |
| 0:21 | Drawer closes | "Prefer the real terminal? It is one click away." |
| 0:23 | End card: wordmark, line, install command | — |

## Why this cut

- It leads with the board moving by itself, which is the thing a screenshot
  cannot show and the thing competitors don't do.
- It never shows an install command until the end; the viewer sees the product
  before the work.
- It is silent and captioned, so it works in a muted Product Hunt gallery and on
  a phone.
- It uses the same fictional workspace as the gallery, so the set feels like one
  product.

## Re-record

With the dev server on port 4321:

```sh
cd web
node scripts/launch-video.mjs
```

This overwrites `docs/launch/assets/tabsh-demo.webm`. The script:
`web/scripts/launch-video.mjs`.

To change a line, edit the `caption()` calls. To change the end card, edit the
`#launch-end` markup in the same file. To record a founder voiceover, keep this
silent cut as the picture lock and record audio separately; do not screen-record
a voice call over the demo.

## If you want a longer cut (45–60s)

Add, between the chat and the end card:

1. **0:24–0:32** — the TUI card: click the terminal tab, type `npm test`, let
   it run. Caption: "Or do it in the real terminal."
2. **0:32–0:40** — open the file explorer and click a path in the chat. Caption:
   "Paths open where the work is."
3. **0:40–0:48** — close the browser tab, reopen `tabsh.cc`, show the shells
   still attached. Caption: "Close the tab. It keeps running."

Do not pad the 25s cut with a logo intro; the board is a better first frame.
