# Agent Instructions

## Working Framework (decision 0008)

This repo uses the **superpowers** plugin as the development loop:
writing-plans → review → executing-plans / subagent-driven-development →
finishing-a-development-branch. Specs live in `docs/superpowers/specs/`,
plans in `docs/superpowers/plans/`. Work tracking truth is
`docs/stories/backlog.md` (epics) plus checkboxes in plan files (tasks).

Before work, read:

- `README.md`
- `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
- `docs/ARCHITECTURE.md`
- `CLAUDE.md`

<!-- HARNESS:BEGIN -->
## Harness (paused — see docs/decisions/0008-superpowers-as-dev-loop.md)

The Harness per-task loop (intake → matrix → trace → backlog via
`scripts/bin/harness-cli`) is paused. Do not run harness-cli bookkeeping for
regular tasks. Decision records under `docs/decisions/` remain mandatory for
architecture/contract/security changes. `docs/HARNESS.md` documents the
paused machinery for future reactivation.
<!-- HARNESS:END -->
