# tabsh launch kit

Everything needed to launch tabsh on Product Hunt, minus pressing the button.

Start with `07-submit.md` when you fill the listing. Read `05-launch-day.md` the
night before. If something is wrong with an asset, regenerate it rather than
editing the PNG by hand.

## What's ready

| Piece | File | Status |
| --- | --- | --- |
| Positioning, taglines, description, first comment | `01-copy.md` | Ready |
| Six gallery images + thumbnail | `02-gallery.md`, `assets/` | Ready |
| 25s silent demo video | `03-video.md`, `assets/tabsh-demo.webm` | Ready |
| Replies to the 15 likely comments | `04-replies.md` | Ready |
| Launch-day timeline and channel drafts | `05-launch-day.md` | Ready |
| Press kit copy and fact sheet | `06-press-kit.md` | Ready |
| Product Hunt field-by-field checklist | `07-submit.md` | Ready |
| 1.0.0 release and verification | `08-release.md` | Done — v1.0.0 is live |
| Known-limitations issue | `09-known-limitations.md` | Post on launch day |
| `/press/` page | `web/src/pages/press.astro` | Ready to deploy |

## Decisions already made

- **Tagline:** "Your shells and agents, one calm scroll." It matches the site
  H1 and the OG card. Alternates are in `01-copy.md`.
- **Version:** 1.0.0. Launching `0.1.40` undercuts the product. If you disagree,
  the same steps work with `0.1.41`; change it before cutting the release.
- **Visuals:** dark, monochrome, same fictional workspace as the site. Light raw
  shots are available if you want a second set.
- **Date:** not set. Use a Tuesday or Wednesday, submit at 12:01am PT, and only
  after the release and landing page are live. The runbook has the timeline.
- **Privacy:** no launch-day analytics. Use Cloudflare aggregates, GitHub
  downloads and comments; adding a tracker would contradict the pitch.

## The only things left for you

1. **Submit the listing:** Product Hunt has no API. Paste the fields in
   `07-submit.md`, upload the gallery and thumbnail, add the YouTube link for
   the video, post and pin the first comment.
2. **Be the maker:** reply to comments, post the X thread and Show HN, and
   answer the "Windows?" question 40 times. The reply bank is there so you don't
   have to write from scratch at 6am.
3. **Optional:** record a founder voiceover or a 45–60s cut. The current video
   is silent and captioned, which is enough.

## What is already shipped (25 Oct 2026)

- `v1.0.0` is published with four binaries and checksums:
  https://github.com/Blaise1030/tabsh/releases/tag/v1.0.0
- The Homebrew tap points at 1.0.0:
  `brew install blaise1030/tap/tabsh`
- https://tabsh.cc serves the new landing page, the 1200 × 630 social card and
  `/press/`.
- The install script was verified end to end on macOS arm64:
  `TABSH_VERSION=1.0.0` installed and `tabsh --version` printed `tabsh 1.0.0`.
- CI: build (4 targets), full e2e, site check, publish, Homebrew and deploy all
  green in run `40171553357`.

## Honest gaps

- The video is a scripted demo, not a recording of a real agent session. It is
  the real app and the real UI, but the daemon is in-memory. Say so if asked; the
  first comment already links the demo and explains it.
- The gallery uses the existing screenshots in `web/public/shots/`, not a new
  capture of the current build. They match the current UI closely, but if a
  release changes the board visually, regenerate.
- Mobile issue #166 could not be reproduced in headless Chromium at 390 × 844
  and 402 × 874: the composer dock sat flush with the viewport bottom. It may be
  device-specific or fixed by the per-card panel work. Keep the issue open, ask
  the reporter for the device/OS, and do not claim a fix on launch day.
- No Windows build. This will be the most common comment; the reply bank has the
  honest answer.
