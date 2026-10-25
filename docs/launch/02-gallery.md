# Gallery

Six images at 1270 × 760, plus a 240 × 240 thumbnail. The copy is baked into
each image because Product Hunt does not show gallery captions.

All files are in `docs/launch/assets/` and are served from `/press/` once the
site is deployed.

| # | File | What it says |
| --- | --- | --- |
| 1 | `01-hero.png` | Your shells and agents, one calm scroll. The whole product in one frame. |
| 2 | `02-one-list.png` | One list, every project. Grouped by status, tagged by folder, shell beside it. |
| 3 | `03-agents.png` | Pick the surface per card: a real terminal (TUI) or a chat (UI). |
| 4 | `04-board.png` | Drag a card across. Or let the agent move it. |
| 5 | `05-hooks.png` | The card moves as the agent works. `tabsh status` commands, no polling. |
| 6 | `06-providers.png` | Commands, not integrations. Claude Code, Codex, Cursor CLI, OpenCode, any CLI. |
| — | `icon-240.png` | Thumbnail: the app mark on a dark square. |

## Upload order

Product Hunt uses the first image as the gallery cover. Upload `01-hero.png`
first, then 2–6. The listing thumbnail is separate; use `icon-240.png`.

## Rules of thumb

- Keep the top 100px clear of essential content: PH overlays the product name
  and vote UI on the cover in some surfaces.
- Don't use screenshots with real customer data, tokens or paths. The demo
  workspace is fictional (`~/code/shop`, `~/code/api`).
- Dark images match the site and the video. Light versions of the raw shots
  exist in `web/public/shots/*-light.png` if you want a second set.

## Regenerate

With the web dev server running on port 4321:

```sh
cd web
node scripts/launch-shots.mjs
```

The script reads `web/public/shots/*.png`, writes the gallery to
`docs/launch/assets/` and `web/public/press/`, regenerates `web/public/og.png`
(1200 × 630) and `web/public/press/icon-240.png`.

If you change the hero or a caption, change it in `web/scripts/launch-shots.mjs`
so the set stays reproducible. Do not hand-edit the PNGs.

## Social preview

`web/public/og.png` is now 1200 × 630 and uses the same hero line. `seo.ts`
advertises those dimensions; the SEO test checks the file matches. After
deploying, paste `https://tabsh.cc` into the Product Hunt link field and check
the card PH renders before submitting.
