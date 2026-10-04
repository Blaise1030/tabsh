---
name: executing-slices
description: Use when a slice plan with tracker issues is approved and slices must be dispatched to agents in parallel worktrees, one PR per slice, honoring dependencies between slices.
---

# Executing Slices

## Overview

Each ready slice goes to its own agent, in its own worktree, producing one CI-green PR with its e2e spec. Dispatch follows dependencies; acceptance follows the definition of done.

## Loop

1. **Ready** = every dependency merged ("in review" is not merged).
2. Dispatch each ready slice to its own agent, own worktree off latest main (**REQUIRED:** using-git-worktrees), with [slice-implementer-prompt.md](slice-implementer-prompt.md). Ready slices run in parallel.
3. Update tracker status (tracking-slices).
4. Each PR gets a code review (requesting-code-review). The human merges unless they said otherwise.
5. After every merge, recompute ready slices and dispatch. Repeat until every slice is merged.

## Accepting a slice

Accept only when all are true:
- E2E spec committed at the planned path in the regression suite, passing (output pasted).
- Unit tests for the listed behaviours.
- All CI checks green on the PR.
- PR links the issue.

A report of "e2e deferred to follow-up" or "unit tests cover it" is a failed slice: send it back. Never accept it and never file the e2e as a follow-up issue.

A BLOCKED report: fix the blocker (or ask the human), then re-dispatch. Don't accept partial work to keep things moving.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Dispatching a slice whose dependency is still in review | Wait for the merge. |
| Two slices sharing one worktree/branch | One slice, one worktree, one PR. |
| Accepting a slice under time pressure | Draft PR + honest status is fine; marking it done is not. |
