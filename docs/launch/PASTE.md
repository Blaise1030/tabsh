# Paste sheet

Plain fields for the Product Hunt form. No commentary; keep this open while you
fill it.

## Name

```
tabsh
```

## Tagline

```
Your shells and agents, one calm scroll
```

## Description

```
tabsh puts your terminal and coding agents in a browser tab. A small Rust daemon runs your shells locally; a board moves each card to In progress, Needs input or Completed as its agent works. Free, open source, macOS and Linux. Nothing leaves localhost.
```

## Links

```
https://tabsh.cc
https://github.com/Blaise1030/tabsh
https://tabsh.cc/demo/?view=board&layout=list&drawer=1
```

## Topics

```
Developer Tools
AI Coding Agents
AI Code Editors
Open Source
Productivity
```

## Pricing

```
Free
```

## Launch tags

```
GitHub
Open Source
Developer Tools
```

## Video

```
PASTE THE YOUTUBE LINK HERE
```

## First comment

```
Maker here. My terminal was the last tool I kept ⌘-Tab-ing to. The issue, the PR, the docs, the design, the chat with my team and the app on localhost are all tabs; the shell was a window of its own. tabsh is my attempt to put it back in the browser, next to the thing it builds.

A small Rust daemon runs the shells on your machine. The app is a plain web page that talks to it over 127.0.0.1, so closing the tab, reloading or rebooting doesn't lose anything. There is no account and no server of ours in the middle.

The part I use most is the board. Every shell and every agent is a card, across every project. Backlog, In progress, Needs input, Completed. Coding agents can move their own cards: `tabsh setup` adds hooks so a prompt moves a card to In progress, a permission request moves it to Needs input, and a finished task marks it Completed with a one-line note. You can also just drag a card.

Agents run in the folder and branch you started them in. That is the trade: no worktrees, so two agents in the same checkout can collide. tabsh doesn't hide that behind a copy of your repo. macOS and Linux only; there is no Windows build. Everything stays on localhost, and the only thing that leaves your machine is the page itself.

You can try it without installing: the landing page runs the real app against a pretend daemon in memory (https://tabsh.cc/demo/?view=board&layout=list&drawer=1). If you like it:

    curl -fsSL https://tabsh.cc/install.sh | sh
    tabsh

Free, MIT, no upsell planned. The feedback I'd most like: does the board match how you actually work with agents, or do you only ever want the terminal back? And if you use an agent I haven't wired up, tell me which one.
```

## Maker bio

```
Blaise builds small, local-first developer tools. tabsh is his attempt to put the terminal back where the work is: in the browser tab, next to the issue, the PR and the app.
```

## X thread

```
1/ Your terminal is the last window you ⌘-Tab to. The issue, the PR, the docs, the design, the chat and the app on localhost are all tabs. tabsh puts the shell and your coding agents back where the work is.

[attach the video]

2/ Every shell and agent is a card on one board, across every project. Close the tab, reload, reboot: they reattach. Agents can move their own cards through `tabsh setup` hooks, so "Needs input" means it actually needs you.

3/ A card can be a real terminal (TUI) or a chat panel (UI) with models, tools and permission prompts. Claude Code, Codex, Cursor CLI, OpenCode, or any CLI that takes a prompt.

4/ It's a small Rust daemon on 127.0.0.1 and a plain web page. No account, no relay, no telemetry. Free and MIT. macOS and Linux; no Windows yet.

5/ Try the real app against a fake daemon, no install:
https://tabsh.cc/demo/?view=board&layout=list&drawer=1

Install: https://tabsh.cc

Feedback: replies or GitHub. What would make the board match how you work?
```

## Show HN title

```
Show HN: tabsh – shells and coding agents in a browser tab
```
