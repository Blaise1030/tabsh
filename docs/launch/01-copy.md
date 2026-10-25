# Launch copy

One sentence everywhere. This file is the source of truth; the site, Product
Hunt listing, README, GitHub description and press kit should all agree.

## The sentence

> **Your shells and agents, one calm scroll.**

Use it as the H1, the OG card and the first line of the first comment. The
longer explanation is:

> tabsh puts your terminal and coding agents in a browser tab, next to the work
> they build. A board keeps every card in one place, and the agent moves its own
> card as it works.

## Product Hunt tagline (60 characters max)

| Option | Chars | Why |
| --- | --- | --- |
| **Your shells and agents, one calm scroll** | 39 | Recommended: matches the site, says the category, sounds unlike the other terminals. |
| A calmer way to work with coding agents | 39 | The site's subtitle. Softer, less concrete. |
| Your terminal and agents, in one browser tab | 44 | Clearest literal description. |
| Every agent, every project, one calm scroll | 43 | Leans into the board. |
| Run coding agents in a tab, not a window | 40 | Names the pain directly. |

Avoid: "terminal in your browser", "AI-powered", "supercharge", "10x". They put
you in a crowded category and undersell the board.

## Description (260 characters max)

Recommended (253):

> tabsh puts your terminal and coding agents in a browser tab. A small Rust
> daemon runs your shells locally; a board moves each card to In progress, Needs
> input or Completed as its agent works. Free, open source, macOS and Linux.
> Nothing leaves localhost.

Shorter (176), if the field feels cramped:

> Your shells and coding agents, in one browser tab next to your work. Shells
> survive reloads and restarts. The board moves itself as each agent works.
> Free, MIT, localhost only.

## Topics / categories

Primary: **Developer Tools**. Then **AI Coding Agents**, **AI Code Editors**,
**Open Source**, **Productivity**. The draft's "AI Engineer" is a role, not a
category; drop it if a second role tag is optional.

## Links

- Website: `https://tabsh.cc`
- GitHub: `https://github.com/Blaise1030/tabsh`
- Demo (no install): `https://tabsh.cc/demo/?view=board&layout=list&drawer=1`
- Docs: `https://tabsh.cc/docs/`
- Changelog: `https://tabsh.cc/changelog/`

Use the bare site for the primary link. Put the demo in the first comment so
the listing's preview stays the landing page.

## First comment

Post it as a comment immediately after submitting, then pin it. It should read
like a maker talking, not a landing page.

---

Maker here. My terminal was the last tool I kept ⌘-Tab-ing to. The issue, the
PR, the docs, the design, the chat with my team and the app on localhost are all
tabs; the shell was a window of its own. tabsh is my attempt to put it back in
the browser, next to the thing it builds.

A small Rust daemon runs the shells on your machine. The app is a plain web page
that talks to it over `127.0.0.1`, so closing the tab, reloading or rebooting
doesn't lose anything. There is no account and no server of ours in the middle.

The part I use most is the board. Every shell and every agent is a card, across
every project. Backlog, In progress, Needs input, Completed. Coding agents can
move their own cards: `tabsh setup` adds hooks so a prompt moves a card to In
progress, a permission request moves it to Needs input, and a finished task
marks it Completed with a one-line note. You can also just drag a card.

Agents run in the folder and branch you started them in. That is the trade: no
worktrees, so two agents in the same checkout can collide. tabsh doesn't hide
that behind a copy of your repo. macOS and Linux only; there is no Windows
build. Everything stays on localhost, and the only thing that leaves your
machine is the page itself.

You can try it without installing: the landing page runs the real app against a
pretend daemon in memory (https://tabsh.cc/demo/?view=board&layout=list&drawer=1).
If you like it:

```
curl -fsSL https://tabsh.cc/install.sh | sh
tabsh
```

Free, MIT, no upsell planned. The feedback I'd most like: does the board match
how you actually work with agents, or do you only ever want the terminal back?
And if you use an agent I haven't wired up, tell me which one.

---

Notes:

- Do not add "would love your upvote". Product Hunt penalises it and comments
  read as begging.
- Keep the install block as a code block; PH renders it.
- If the listing supports a "Shoutouts" section, add only real people who tested
  it. Do not invent names.

## Maker bio (short)

> Blaise builds small, local-first developer tools. tabsh is his attempt to put
> the terminal back where the work is: in the browser tab, next to the issue,
> the PR and the app.

## Gallery captions

These are for the press kit and alt text. Product Hunt does not display gallery
captions, so the text is baked into each image.

1. **Hero** — Your shells and agents, one calm scroll.
2. **One list** — One list, every project. Grouped by status, tagged with its folder, with the shell right beside it.
3. **Agents** — Pick the surface per card. A real terminal, or a chat with models, tools and permissions.
4. **Board** — Drag a card across. Or let the agent move it.
5. **Hooks** — The card moves as the agent works. No polling, no integration to babysit.
6. **Providers** — Commands, not integrations. Claude Code, Codex, Cursor CLI, OpenCode, or any CLI.

## What not to claim

- "Works everywhere": it does not run on Windows.
- "Faster than your terminal": no benchmark supports it; the pitch is calm, not speed.
- "Isolated agents": there are no worktrees.
- "Private" without saying what that means: localhost-only, token in the URL
  fragment, no telemetry. Say that instead.
- "AI-powered": the agents are the user's; tabsh is the room they work in.
