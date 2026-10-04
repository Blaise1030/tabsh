# Slice Plan Template

Save as `docs/plans/YYYY-MM-DD-<feature>-slices.md` (or the project's plan directory).

```markdown
# <Feature> — Slice Plan

- Spec: <path to approved spec>
- Base SHA: <main SHA when planning started>   # used by Phase 5 audit
- Tracker: <Linear project/team | GitHub repo> — parent: <ID/URL>
- CI checks on PR: <workflow file → job names>
- E2E: <runner>, specs in <dir>, run with `<command>`, conventions doc at <path>
- Conventions source: <skill / CLAUDE.md / exemplar module paths>

## Slice <N>: <flow name, user-facing verb phrase>

- Issue: <ID/URL>                      # filled in Phase 3
- Depends on: <slice IDs | none>
- Flow (REQUIRED): <actor> <does X> → <sees Y>
- E2E spec (REQUIRED): `<path/to/spec>` — <scenario, step by step>
- Unit tests (REQUIRED): <behaviours covered, one per line>
- Layers touched: <migration / shared / server / client — specific files>
- Out of scope for this slice: <what later slices add>
- Done when: e2e + unit tests pass locally, all CI checks green, PR closes the issue
```

Rules:
- Every REQUIRED field filled. A slice without an e2e spec is not a slice.
- Slice 1 = walking skeleton of the main flow.
- Slice 0 only when no e2e harness exists: Flow = "CI runs a smoke e2e on every PR". Its deliverables include the e2e conventions doc.
