# Launch day

Product Hunt's day starts at **12:01am Pacific**. Ranking accumulates from
then, so the first six hours matter more than the exact minute. A Tuesday or
Wednesday is the usual choice; avoid a day with a major AI launch if you can see
one coming.

Times below are Pacific. Your local time is +15h (CET) or +17h (Sydney); set
alarms rather than converting in your head.

## T-7 days

- [ ] Freeze features. Only fixes that protect the demo, install or first-run
      experience.
- [ ] Cut the release you will launch (see `08-release.md`) and deploy the new
      landing page. Do not launch a version that isn't already live.
- [ ] Test the install on a clean macOS user and a clean Ubuntu VM. Include
      `brew install` and the upgrade path.
- [ ] Record the video and regenerate the gallery (`02-gallery.md`,
      `03-video.md`).
- [ ] Fill the Product Hunt draft completely (`07-submit.md`), but do not submit.
- [ ] Update the GitHub repo description, topics and social preview.
- [ ] Pick 15–20 people who actually use coding agents and ask them to **try it
      and leave honest feedback**. Do not ask for upvotes; PH penalises rings.

## T-1 day

- [ ] Re-read the first comment out loud. Cut anything that sounds like a
      landing page.
- [ ] Pin the reply bank (`04-replies.md`) somewhere you can reach on your phone.
- [ ] Check the listing preview: paste `https://tabsh.cc` into a private window
      and confirm the OG card, title and favicon.
- [ ] Prepare the X thread, HN post and two Reddit posts as drafts. Do not
      schedule them to fire before the listing is live.
- [ ] Charge your phone; set an alarm for 11:55pm PT.
- [ ] Sleep. A tired maker writes defensive replies.

## Launch day

| Time | Do |
| --- | --- |
| 12:01am | Submit the listing. Post the first comment immediately and pin it. |
| 12:05am | Check the live page on your phone, logged out. Fix anything broken. |
| 5:00am | Post the X thread. Reply to every PH comment from the night. |
| 6:00am | Post Show HN (different framing, not a copy). |
| 7:00am | Post to the first subreddit. Wait at least an hour before the second. |
| 8:00am–12:00pm | Reply to everything within ~15 minutes. This is the job. |
| 12:00pm | Post a short update comment with one thing you learned or fixed. |
| 3:00pm | Second subreddit / Lobsters, if the first went well. |
| 5:00pm | Thank-you comment on PH. Do not ask for a final push. |
| Evening | Log every bug and request in one issue. Ship the worst install blocker if you can. |

If a comment is hostile, answer once, factually, and stop. Do not quote-tweet
critics or subtweet the ranking.

## Channel drafts

### X / Twitter thread

1. Your terminal is the last window you ⌘-Tab to. The issue, the PR, the docs,
   the design, the chat and the app on localhost are all tabs. tabsh puts the
   shell and your coding agents back where the work is. [video]

2. Every shell and agent is a card on one board, across every project. Close the
   tab, reload, reboot: they reattach. Agents can move their own cards through
   `tabsh setup` hooks, so "Needs input" means it actually needs you.

3. A card can be a real terminal (TUI) or a chat panel (UI) with models, tools
   and permission prompts. Claude Code, Codex, Cursor CLI, OpenCode, or any CLI
   that takes a prompt.

4. It's a small Rust daemon on `127.0.0.1` and a plain web page. No account, no
   relay, no telemetry. Free and MIT. macOS and Linux; no Windows yet.

5. Try the real app against a fake daemon, no install:
   https://tabsh.cc/demo/?view=board&layout=list&drawer=1
   Install: https://tabsh.cc
   Feedback: replies or GitHub. What would make the board match how you work?

No hashtags. Put the video in post 1, the site link in post 5.

### Show HN

**Title (58 chars):** Show HN: tabsh – shells and coding agents in a browser tab

**Body:**

I built tabsh because my terminal was the last tool I kept switching windows
for. The issue, the PR, the docs and the app on localhost are all browser tabs;
the shell was a separate window. tabsh is a small Rust daemon that runs your
shells locally, plus a web app that talks to it over 127.0.0.1.

The part I use most is the board. Every shell and agent is a card, across every
project, and agents can move their own cards through hooks (`tabsh setup` adds
them; a prompt moves a card to In progress, a permission request to Needs input,
a finished task to Completed). You can also drag cards yourself.

Each card is either a real terminal (xterm.js over a PTY) or a chat panel over
ACP, so Claude Code, Codex, Cursor CLI, OpenCode or any CLI that takes a prompt
can be a card.

Honest limits: macOS and Linux only, no Windows. No worktrees, so agents in the
same checkout can collide. Localhost only; Tailscale is the supported way to
reach it from another device. Free, MIT, no telemetry.

Demo (real app, in-memory fake daemon, no install):
https://tabsh.cc/demo/?view=board&layout=list&drawer=1

Code: https://github.com/Blaise1030/tabsh

I'd especially like feedback from people who run several agents at once: does a
shared board help, or do you want isolation first?

### r/ClaudeAI

**Title:** I put Claude Code on a kanban board in a browser tab

**Body:** Lead with the hooks, not the terminal. Show the three `tabsh status`
commands, the TUI/chat surfaces, and the honest no-worktree trade. Ask how
people coordinate multiple Claude sessions today. Link the demo, not the
listing. Read the subreddit's self-promo rules first; if it requires a
participation history, skip it rather than getting removed.

### r/SideProject

**Title:** I built a browser tab for shells and coding agents

**Body:** The maker story: why a browser tab, what existed before, what the
first version got wrong, what's next. Include one screenshot and the demo. No
"please upvote".

### Lobsters

**Title:** tabsh: shells and coding agents in a browser tab

**Tags:** browsers, devops, programming, release. Link the GitHub repo, not the
PH page. One paragraph on the architecture (Rust daemon, token in fragment, no
relay). Lobsters punishes marketing; keep it technical.

## What not to do

- No "we're live on Product Hunt, would love your support" DMs.
- No upvote exchanges, no groups, no bought votes.
- No fake accounts or teammate accounts created for the day.
- No editing the listing's core claim mid-day; fix typos only.
- No arguing with the "just use tmux" comment. Answer once and move on.
- No launch on a Friday or a US holiday.

## Metrics to record (once, at 6pm PT)

- PH rank and upvotes; number of comments and whether each got a reply.
- Site visits (Cloudflare aggregate), demo starts, install-script requests from
  the release assets.
- GitHub stars, forks, release downloads (the closest thing to installs).
- New issues, and the top three complaints.
- One sentence from a user that you want to remember.

There is deliberately no client-side analytics, so do not add a tracking script
for launch day. It would contradict the privacy claim, and the aggregate
numbers above are enough to decide what to fix.

## The day after

- Ship a patch release for the top install blocker or crash. A fast `1.0.1`
  matters more than a big one.
- Reply to comments you missed; thank the people who filed real bugs.
- Write a short "what I learned" note in the changelog or on X. Numbers are
  optional; the useful part is what users tried to do.
- Keep the listing's first comment accurate. If something changed, add a reply
  rather than rewriting history.
