---
name: planning-vertical-slices
description: Use when turning an approved spec or feature design into an implementation plan whose pieces will ship as separate PRs or be built by separate agents, or when a plan has "foundation", "backend", or "types" tasks with no user-visible outcome.
---

# Planning Vertical Slices

## Overview

A slice is one user-visible flow delivered end to end in one PR, with an e2e spec that proves it. Slices are flows, never layers.

**Input:** an approved spec with user flows (`actor does X → sees Y`). No approved spec → stop and get one (brainstorming).

## Every slice is

1. One flow from the spec, entry point → observable outcome, through the real UI/API.
2. Every layer that flow needs (migration, shared types, server, client), and only what it needs.
3. One e2e spec (path + scenario) proving the flow, plus unit tests for the logic.
4. Mergeable alone: main stays releasable, CI green.
5. Dependencies listed by slice ID.
6. One reviewable PR. Too big → split the flow (happy path, then edge flows), never by layer.

**Slice 1 is the walking skeleton:** the thinnest end-to-end version of the main flow. It creates the schema and types later slices extend.

**If the project has no e2e harness:** Slice 0 = runner config, app/DB bootstrap, one smoke spec, e2e wired into the PR CI workflow, and an **e2e conventions doc** (auth fixture, data seeding/cleanup helpers, selector rules, run command) next to the specs. Every other slice depends on it.

**If a harness exists but has no conventions doc:** write one from the existing specs and fixtures before dispatching slices.

## Output

Write the plan with [slice-plan-template.md](slice-plan-template.md). Every REQUIRED field filled. Present it to the human and wait for explicit approval.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| "Foundation" / "backend" / "types" slice | Fold into the walking skeleton. |
| Slice with only unit tests | Not a slice. Add the e2e spec or merge it into the flow it serves. |
| Splitting a big flow by layer | Split by flow: happy path first, edge flows as later slices. |
| Marking slices dependent "to be safe" | Depend only on what the flow actually needs merged; independent slices run in parallel. |
