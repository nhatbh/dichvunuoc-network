# 0008 Superpowers As Dev Loop, Harness Reduced To Decisions And Backlog

Date: 2026-06-13

## Status

Accepted

## Context

The repo accumulated three overlapping working frameworks:

- Harness (docs/HARNESS.md + Rust CLI + SQLite): intake classification, risk
  lanes, story matrix, traces, friction backlog. Built before implementation
  started (decision 0001).
- Superpowers (Claude Code plugin v5.1.0): brainstorming → writing-plans →
  executing-plans/subagent-driven-development, with TDD and verification
  skills. Its artifacts (docs/superpowers/specs/, docs/superpowers/plans/)
  produced all of Phase 0 in practice.
- BMAD-style role ceremony remained only as leftovers in the user's global
  agent config (already removed together with the defunct Beads tracker).

Three sources of work-truth emerged: epics in docs/stories/backlog.md, stories
in the harness matrix, tasks in superpowers plan files. Nobody updates all
three; the duplication was starting to rot. The project is now in pure
execution phase (spec v1.0 approved, design approved, 8-phase roadmap written),
which is exactly the phase superpowers covers and harness ceremony taxes most.

## Decision

1. Superpowers is the primary interaction framework for development work.
   Per slice: writing-plans → review → executing-plans or
   subagent-driven-development → finishing-a-development-branch. Specs live in
   docs/superpowers/specs/, plans in docs/superpowers/plans/.
2. Harness is reduced to its cheap, high-value parts: docs/decisions/ (durable
   decision records, including this one) and docs/stories/backlog.md at epic
   level. The per-task loop (intake → matrix → trace → backlog) is paused.
3. The Rust harness CLI, SQLite layer, and related docs stay in the repo
   untouched. Reactivate when the team grows beyond one person or an audit
   trail is required.
4. BMAD is not used as a running framework; the superpowers brainstorming
   skill covers requirement discovery for future initiatives.

## Alternatives Considered

1. Run harness task loop and superpowers together — rejected: double
   bookkeeping per task, three sources of truth, ceremony cost exceeds value
   for a single developer.
2. Drop harness entirely — rejected: decision records and the durable layer
   design remain valuable; pausing is reversible, deleting is not.
3. Adopt BMAD for the whole lifecycle — rejected: discovery phase is already
   complete; BMAD's strength does not apply to the current execution phase.

## Consequences

- Agents follow CLAUDE.md / AGENTS.md which now declare the superpowers loop
  as the working frame.
- Work tracking truth: backlog.md (epic status) + plan files (task
  checkboxes). The harness matrix is no longer expected to be current.
- docs/HARNESS.md remains as reference for the paused machinery; its Task Loop
  section is not binding while this decision stands.
