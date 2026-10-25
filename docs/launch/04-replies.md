# Reply bank

Paste-ready answers for the comments that will arrive. Short, specific, no
defensiveness. Replace nothing except the name if you want.

Rules for every reply:

- Answer the question in the first sentence.
- If it is a limitation, say so plainly, then say what the person can do today.
- Link the demo or the docs once; do not paste the install command in every
  reply.
- Never argue about Product Hunt ranking, and never ask for an upvote.

---

## "Does it work on Windows?"

Not yet. macOS and Linux only; there is no Windows build. The daemon is Rust and
the app is a web page, so it is not a rewrite, but the shells, paths and service
setup need real Windows work. The honest workaround is WSL2 with the Linux
build, though I don't test that path yet.

If you want it, say so in the GitHub issue for Windows; demand is how I'll
prioritise it: https://github.com/Blaise1030/tabsh/issues

## "Is my code / typing sent anywhere?"

No. The daemon listens on `127.0.0.1` only, and the app is a static page that
talks to it directly. There is no account, no relay and no telemetry. Your
pairing token lives in `~/.tabsh/token` and travels in the URL fragment, which
browsers never send to a server. The one thing that comes from the network is
the app page itself, from tabsh.cc.

## "How is this different from tmux / zellij?"

tmux is a multiplexer: sessions on a remote box, keyboard-driven, works over
SSH. tabsh is a local GUI: the terminal is one tab next to the issue and the PR,
and every shell and agent is a card on a board. It doesn't detach a session from
your SSH connection; it keeps the session alive across reloads and reboots.

If your work lives on a remote server, keep tmux. If your work is local and the
window-switching is the tax, tabsh is for that.

## "How is this different from Warp?"

Warp is a terminal emulator with its own AI layer. tabsh doesn't have its own AI
and doesn't replace the terminal emulator model: it runs your existing shells
and agents where the rest of your work is, and adds a board that the agents
update through hooks. Bring Claude Code, Codex or whatever you already pay for.

## "Why not just the VS Code terminal?"

If you already live in one editor all day, the VS Code terminal is genuinely
good, and tabsh is not trying to be your editor. tabsh is for the work that
isn't in the editor: the issue, the PR, the design, the chat, the app on
localhost. It stays editor-agnostic, and you can keep VS Code open in the next
tab.

## "How is this different from Conductor / Claude Squad / agent managers?"

Those tend to isolate each agent in a worktree and give it a panel. tabsh
deliberately doesn't: agents run in your folder and branch, in a real terminal
or a chat, and the board is the shared view across projects. That means two
agents in one checkout can collide; it also means no copy of your repo, no
merge-back choreography, and no surprise about which files they touched.

## "Do I have to change my agent's config?"

You run `tabsh setup` once and the agent adds the hooks itself (it backs up the
file first and tells you what it changed). It keeps your existing hooks, and
outside tabsh the hooks do nothing. If you don't want hooks, the board still
works; you just drag cards yourself.

## "Two agents in the same repo sounds dangerous."

It is a real trade, not a hidden one. tabsh doesn't create worktrees, so two
agents in the same checkout can edit the same file. For now the honest
guidance is one agent per checkout, or separate clones, if they are doing
overlapping work. A worktree mode is on the list, but I didn't want to ship
"isolation" that silently changes what your agent sees.

## "Why a browser tab instead of a native app?"

Because the work already is in browser tabs: the issue, the PR, the docs, the
chat, the app on localhost. A native app would be one more window to switch to,
which is the thing I was trying to remove. The daemon is native; the UI is a
page.

## "Safari / phone?"

Safari can't reach the daemon from tabsh.cc, so the daemon serves the app itself
at `http://tabsh.localhost:7681`, and tabsh.cc sends Safari there. File → Add to
Dock makes it feel like an app. On a phone, use the same trick over Tailscale if
you want the board with you; it's off by default.

## "Is it really free? What's the catch?"

Free, MIT, no account. There is no hosted tier and no plan to add one. The
"catch" is that it's a local tool: you run a daemon, and it only works on your
machine (or your Tailscale network). If it stays useful, the win is people
using it and sending good bug reports, not a subscription.

## "So it's just a terminal in a browser?"

The terminal part is not novel; xterm.js is doing the work. The bet is the two
things around it: the board that every shell and agent shares, and the hooks
that let an agent move its own card when it needs you. If you only want a
terminal in a tab, there are simpler tools and you should use them.

## "Does it work over SSH / on a remote dev box?"

The daemon runs where your shells run. If that's a remote box, you can start it
there and forward the port over SSH, but that's not the supported path and I
don't want to pretend it's turnkey. Tailscale is the supported way to reach your
own machine from another device.

## "What about Cursor / Copilot / Gemini CLI / Aider?"

Providers are commands, so any CLI that takes a prompt can be a card: set its
startup and resume command, and optionally an ACP command for UI mode. Claude
Code, Codex, Cursor CLI and OpenCode are the ones I test; Gemini CLI is in the
docs. If yours needs a quirk, open an issue with the command you use.

## "The install failed / the daemon won't start."

Sorry. Please open an issue with your OS, architecture, the command you ran and
the output: https://github.com/Blaise1030/tabsh/issues. If it's the install
script, `TABSH_VERSION=0.1.40` can pin a known release while we fix it. Launch
day patches go out fast.

## "This looks like a Product Hunt launch, not a real tool."

Fair. The code is at https://github.com/Blaise1030/tabsh, MIT, and the demo is
the real app running against an in-memory daemon. Read it, run it, or tell me
what's missing; I'd rather have the criticism than a polite upvote.
