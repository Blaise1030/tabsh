---
name: slice-driven-development
description: Use when a feature is too big for one PR and will be split across several agents or PRs, coordinated through Linear, GitHub Issues, or another tracker, and must stay protected by end-to-end regression tests after it ships.
---

# Slice-Driven Development

## Overview

A feature ships as **vertical slices**. One slice = one user-visible flow = one agent = one PR, carrying its own e2e spec that stays in the regression suite permanently.

- All slice PRs merged → the feature is complete.
- Regression suite green later → the feature is still intact.

**Violating the letter of these rules is violating the spirit.**

## Phases

| # | Phase | How | Exit condition |
|---|-------|-----|----------------|
| 0 | Detect project setup | Below | CI checks, e2e runner, conventions source known |
| 1 | Shared understanding | Below (HARD GATE) | Human explicitly approves written spec |
| 2 | Slice plan | **REQUIRED:** planning-vertical-slices | Human explicitly approves plan |
| 3 | Tracker | **REQUIRED:** tracking-slices | Parent + one issue per slice, IDs in plan |
| 4 | Execute slices | **REQUIRED:** executing-slices | Every slice PR merged, CI green |
| 5 | Regression + finalization | Below | Regression green on main; convention fixes merged as one PR |

Do the phases in order. Never skip an approval.

## Phase 0: Detect project setup

Record each in the spec:

- **Tracker:** per tracking-slices (a `Tracker:` line, else ask).
- **CI:** workflows that run on pull requests and which checks they run. If no PR workflow runs unit **and** e2e tests, raise it in Phase 1.
- **E2E:** runner, config, spec directory, run command. None yet → the plan gets a Slice 0.
- **Conventions:** the project's conventions skill, CLAUDE.md, or exemplar modules.

## Phase 1: Shared understanding — HARD GATE

**REQUIRED SUB-SKILL:** brainstorming (superpowers:brainstorming).

Write the spec: user flows as `actor does X → sees Y`, out-of-scope list, resolved decisions, Phase 0 findings. Ask the open questions batched in one message, then **wait**. Gate opens only on the human's explicit approval of the spec.

| Excuse | Reality |
|--------|---------|
| "User said they're busy / just get going" | Wrong assumptions cost a busy user a whole rework cycle. Batched questions cost two minutes. Ask and wait. |
| "I'll state defaults and proceed unless they object" | Silence is not agreement. That is planning before understanding. |
| "Requirements are obvious" | Then approval is instant. Ask. |

## Phase 5: Regression + finalization

1. Pull main. Run the full e2e regression suite and the CI checks locally. Green = feature complete. Red → systematic-debugging, fix PR.
2. Audit `<feature-base-sha>..main` against the conventions source and neighbouring modules. Include cross-slice seams: duplicated types/helpers, inconsistent naming between slices.
3. Build a numbered list. Each item: `file:line`, convention broken, existing code to match, fix size.
   - **If the human has not already told you to fix findings:** show the list, ask which to fix, change nothing before they reply.
   - **If they already said to fix them** ("just fix it", "don't ask"): fix them all and put the numbered list in the PR body so they can veto items in review.
4. Fixes → **one** finalization PR; regression suite must stay green. Close the parent issue when it merges (or when the human declines all).

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Manual click-through as the completion check | The regression suite is the check. Manual testing doesn't persist. |
| E2E specs written after all slices merge | Each slice's PR carries its own spec. |
| Fixing convention issues without asking | List → human picks → one PR (unless they pre-authorized fixes). |
