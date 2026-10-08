# Connect this coding agent to the tabsh board

You are a coding agent (Claude Code, Gemini CLI, Codex, …). The user runs you inside tabsh, where
every terminal is a card on a kanban board with the statuses backlog, in_progress, needs_input,
completed and archived. Set up your own hooks and instructions so you keep your card current.
tabsh does not know your config format; you do. Follow these steps and report back.

## The contract

Inside a tabsh terminal the environment has `TABSH_SESSION_ID`. These commands set that terminal's
card. With `--hook` they print nothing and always exit 0, even outside tabsh, so they are safe to
run from hooks that fire everywhere.

| When | Run |
|---|---|
| The user sends you a prompt | `{tabsh} status in_progress --hook` |
| You need permission or input from the user | `{tabsh} status needs_input --hook --if-not completed` |
| Your turn ends | `{tabsh} status needs_input --hook --if-not completed --note 'Agent finished its turn'` |
| The user's task is done (you decide; not a hook) | `{tabsh} status completed --note '<one line: what you did>'` |

`--hook` reads JSON on stdin and uses its `message` field as the card's note when there is one,
so a notification hook can pass its payload straight through. Its `session_id` field lets tabsh
resume your conversation in a fresh shell after tabsh restarts, so give every hook the payload. `--note` sets the note explicitly.
Do not use a single quote (') inside a note; escape it as needed by your shell instead.

## Steps

1. **Find your mechanism.** Identify your own hook or notification system and its config file
   (for example Claude Code: `~/.claude/settings.json` hooks `UserPromptSubmit`, `Notification`,
   `Stop`; Gemini CLI: `~/.gemini/settings.json` hooks `BeforeAgent`, `Notification`,
   `AfterAgent`; Codex: `notify` in `~/.codex/config.toml`). Check your current documentation
   rather than trusting these examples.
2. **Back up** that config file next to itself with a `.bak` suffix before changing it.
3. **Merge, never replace.** Add one entry per row of the contract that you have an event for.
   Keep every existing hook. If an entry whose command contains ` status ` and `--hook` and the
   word `tabsh` is already there, update it instead of adding a second one, so running this setup
   again changes nothing.
4. **Map honestly.** If you have no event for a row (Codex, for example, has no "prompt sent"
   event), leave that row out. Never fake it with an event that means something else. If your
   mechanism cannot run these exact commands (for example it passes the event payload as an extra
   argument), say so in your report instead of wiring something that silently does nothing.
5. **Instruct yourself.** Add to your persistent instructions (a skill, `AGENTS.md`, `GEMINI.md`,
   or whatever you read at the start of every session) a short rule: when `TABSH_SESSION_ID` is
   set and the user's task is done (not paused, not waiting on them), run
   `{tabsh} status completed --note '<one line: what you did>'`; never set any other status
   yourself, because hooks handle those and archiving is the user's.
6. **Verify.** If `TABSH_SESSION_ID` is set, run `{tabsh} status needs_input --note 'setup test'`
   and ask the user to confirm the card moved, then `{tabsh} status in_progress`. In any case run
   `env -u TABSH_SESSION_ID {tabsh} status needs_input --hook; echo $?` and check it prints `0`.
7. **Report** to the user: the file you changed and its backup path, which rows you wired to
   which events, which rows you could not wire and why, and how to undo it: remove the entries
   whose command contains ` status ` and `--hook` and the word `tabsh`, and the instruction from
   step 5. If the `{tabsh}` path above isn't the installed binary (for example it's under a
   `target/` build folder), tell the user, because hooks would point at it.
