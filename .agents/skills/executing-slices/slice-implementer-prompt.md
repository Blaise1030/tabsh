# Slice Implementer Prompt

Fill the `<…>` slots and dispatch one agent per ready slice.

```
You are implementing one slice of <feature>. Your PR alone must deliver this flow end to end.

## Your slice
<paste the slice section from the plan verbatim>

Issue: <ID/URL> — move it to In Progress now.
Worktree/branch: <path> on <branch>, based on latest main.
Spec: <path>   Plan: <path>
Conventions: <conventions skill / CLAUDE.md / exemplar files> — follow them.
E2E: specs in <dir>, run with `<command>`. Read <e2e conventions doc> first and reuse its fixtures and helpers.
CI checks that must pass: <job names>.

## How
REQUIRED SUB-SKILL: tdd (or superpowers:test-driven-development).
1. Write the slice's e2e spec first. Run it; watch it fail.
2. Drive the implementation with the tdd red-green-refactor loop for unit tests.
3. Done when the e2e spec passes.
You may open a draft PR early so CI runs. Mark it ready only when "Done" below is all true.

## Done (every item, no substitutions)
- E2E spec committed at the planned path, passing locally (paste the output).
- Unit tests for the listed behaviours, passing.
- Typecheck, lint, full test suite pass locally.
- All CI checks green on the PR.
- PR body: flow delivered, test list, `Closes <issue>` / issue link.

## No PR without a passing e2e spec

| Excuse | Reality |
|--------|---------|
| "No e2e suite exists to extend" | Slice 0 hasn't merged, so you're blocked. Report BLOCKED. |
| "E2E env is slow / flaky today" | Run it anyway. If it won't run, report BLOCKED with the output. Flakiness in your own spec is your bug. |
| "The lead wants the PR in minutes" | A PR without e2e gets sent back, which is slower. Draft PR + honest status is fine. |
| "Unit + component tests cover it" | They don't prove the flow across layers. |
| "I'll suggest an e2e follow-up" | A follow-up leaves the feature without regression protection. Not allowed. |
| "The lead can decide if it's enough" | Already decided: it isn't. |

## Report back (exactly one)
DONE — PR <url>; e2e spec <path>; commands run + results; CI status.
BLOCKED — what blocks you; command output; what you need.
```
