# Known limitations (issue draft)

Post this as a GitHub issue and pin it **on launch day**, not before. It gives
every "but what about…" comment an honest place to land, and it is the page you
link from Product Hunt replies.

Title: `Known limitations at launch`

---

Thanks for trying tabsh. These are the limits I know about, so you don't have to
discover them the hard way. If one of them is a dealbreaker, tell me which and
why; that is how the list gets shorter.

## Platforms

- **macOS and Linux only.** There is no Windows build. WSL2 with the Linux
  binary may work, but it is untested and unsupported.
- **Safari and iOS** cannot reach the daemon from `https://tabsh.cc`. The daemon
  serves the app at `http://tabsh.localhost:7681`; File → Add to Dock makes it
  feel native. Other browsers work from the hosted page.

## Isolation

- **No worktrees.** Agents run in the folder and branch you start them in. Two
  agents doing overlapping work in one checkout can collide. Use one agent per
  checkout, separate clones, or wait for a worktree mode.
- There is no merge-back choreography, because there is no copy of your repo.

## Networking

- The daemon listens on loopback only. Reaching it from another device requires
  Tailscale (or an SSH tunnel), and that is the supported path. Do not expose
  port 7681 on your LAN; it is a shell.
- There is no hosted/cloud mode, no account, and no relay.

## Agents

- TUI mode works with any CLI. UI (chat) mode needs an ACP-capable command; the
  tested providers are Claude Code, Codex, Cursor CLI and OpenCode.
- `tabsh setup` lets the agent edit its own config. It backs the file up first
  and reports what it changed, but you should still review the diff.
- The card's status is only as good as the agent's hooks. An agent that doesn't
  run them won't move its card.

## Scope

- tabsh is not an editor, a code review tool, or a remote shell client. It is the
  terminal and the board, in a tab.
- There is no sync between machines other than opening the same daemon over
  Tailscale.
- No telemetry. That also means I can't see your crash; please include logs in
  issues.

## What is planned, not promised

- Windows support.
- Optional worktree isolation per card.
- Better first-run guidance for people without a coding agent installed.

If your limitation isn't here, open a separate issue with the command you ran
and what happened.
