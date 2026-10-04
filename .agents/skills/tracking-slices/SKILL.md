---
name: tracking-slices
description: Use when an approved slice plan or task plan needs issues in Linear, GitHub Issues, Jira, or another tracker, or when tracker status must stay in sync with PRs as agents work.
---

# Tracking Slices

## Overview

The tracker mirrors the plan: one parent, one issue per slice, status follows the PR. The project chooses the tracker, never the agent.

## Choose the tracker

- A `Tracker:` line in CLAUDE.md / AGENTS.md → use it.
- **No line:** ask the human (Linear team/project, GitHub repo, other) and offer to add the line. Never pick one yourself, even if one is "obviously" reachable.

## Create

1. One parent: Linear project or parent issue / GitHub epic issue or milestone. Body links the spec and plan.
2. One issue per slice. Body =
   - the slice section from the plan, verbatim
   - definition of done (e2e + unit tests pass, all CI checks green, PR closes this issue)
   - `Blocked by: <issue IDs>` from the slice's dependencies
3. Write every issue ID/URL back into the plan.

Use what the tracker offers: Linear MCP tools, `gh issue create`, or the tracker's CLI/API.

## Keep in sync

| Event | Status |
|-------|--------|
| Agent dispatched | In Progress |
| PR ready for review | In Review |
| PR merged | Done |
| Slice blocked | Comment with the blocker; leave In Progress |

The parent closes only when the orchestrating workflow says the feature is finalized.
