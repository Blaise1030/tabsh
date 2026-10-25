# Press kit

The public page is `/press/` (`web/src/pages/press.astro`). It links to the
files in `web/public/press/`. Send this page, not a zip, to anyone writing
about tabsh.

## Fact sheet

| | |
| --- | --- |
| Name | tabsh |
| Site | https://tabsh.cc |
| Repo | https://github.com/Blaise1030/tabsh |
| What | A browser tab for your shells and coding agents, with one board across projects. |
| Maker | Blaise Tiong |
| Price | Free |
| License | MIT |
| Platforms | macOS and Linux (Apple silicon, Intel, x86-64 Linux, arm64 Linux) |
| Install | `curl -fsSL https://tabsh.cc/install.sh | sh` or `brew install blaise1030/tap/tabsh` |
| Data | Localhost only; no account, no relay, no telemetry |
| Status | 1.0.0, released 25 October 2026 |

## One-liners

**39 characters** (tagline):

> Your shells and agents, one calm scroll.

**25 words:**

> tabsh puts your shells and coding agents in a browser tab, next to your work.
> A board moves each card as its agent works. Free, MIT, localhost only.

**50 words:**

> tabsh is a browser tab for your terminal and coding agents. A small Rust
> daemon runs your shells locally, so they survive reloads and restarts. A board
> keeps every card across every project in one list, and agents move their own
> cards. Free, open source, macOS and Linux.

**100 words:**

> tabsh puts your shells and coding agents in the browser tab next to your work.
> A tiny Rust daemon runs the shells on your machine, so closing the tab,
> reloading or rebooting doesn't lose them. Every shell and agent is a card on a
> board: Backlog, In progress, Needs input, Completed. With `tabsh setup`, a
> coding agent moves its own card when you send a prompt, when it needs
> permission, and when it finishes. Each card is either a real terminal or a
> chat panel, and any CLI that takes a prompt can be a card. Free, MIT, and
> localhost only.

**300 words:**

> Your terminal is the last tool you keep switching windows for. The issue, the
> pull request, the docs, the design, the team chat and the app on localhost are
> all browser tabs; the shell is somewhere else. tabsh is an attempt to put it
> back: a browser tab for your shells and coding agents, next to the work they
> build.
>
> A small Rust daemon runs the shells locally and listens only on 127.0.0.1. The
> app is a plain web page that talks to it, so closing the tab, reloading or
> rebooting doesn't lose anything. There is no account and no server in the
> middle.
>
> The board is the part that changes the workflow. Every shell and agent is a
> card, across every project. Cards sit in Backlog, In progress, Needs input or
> Completed, and you can drag them. More usefully, an agent can move its own
> card: `tabsh setup` adds hooks so a prompt moves a card to In progress, a
> permission request moves it to Needs input, and a finished task marks it
> Completed with a one-line note. "Needs input" then means something.
>
> Each card runs either as a real terminal or as a chat panel with models, tool
> calls and permission prompts. Claude Code, Codex, Cursor CLI and OpenCode work
> out of the box; any CLI that takes a prompt can be added.
>
> The trade is deliberate: agents run in your folder and branch. There are no
> worktrees, so two agents in the same checkout can collide. tabsh doesn't hide
> that behind a copy of your repo. It is macOS and Linux only, with no Windows
> build yet.
>
> Free, MIT, no telemetry. The app is local; the work stays on your machine.

## Maker quote

For attribution to Blaise Tiong. Edit it before sending if it doesn't sound like
you:

> "I didn't want another terminal. I wanted the terminal to stop being the one
> window I had to leave the work for. The board came later, when I realised the
> hard part wasn't running an agent, it was knowing which one needed me."

## Assets

Everything is served from `https://tabsh.cc/press/` after deploy:

- `01-hero.png` … `06-providers.png` — 1270 × 760
- `icon-240.png` — 240 × 240
- `https://tabsh.cc/og.png` — 1200 × 630
- `https://tabsh.cc/favicon.svg` — the mark, vector
- `tabsh-demo.webm` — 24.7s silent demo (in `docs/launch/assets/`; upload to
  YouTube before sending, or share the file directly)

## Contact

Blaise Tiong — https://blaisetiong.dev. For bugs and feature requests, use
GitHub issues so the thread stays public:
https://github.com/Blaise1030/tabsh/issues

## Boilerplate

> tabsh is a browser tab for your shells and coding agents, with one board
> across every project. It is free, MIT licensed, and runs locally on macOS and
> Linux. https://tabsh.cc
