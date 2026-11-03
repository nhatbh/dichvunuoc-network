# 0023 Incident Isolation Analysis (INC-2) — gRPC topology port, synchronous plan snapshot

Date: 2026-06-17

## Status

Accepted

## Context

INC-2 (US-P3-04) adds isolation analysis to `water-network-incident-be`. It is the
first .NET service to call topology-rs over gRPC (`ComputeIsolationZone`, decisions
0019/0020) and the place where the .NET client contract test deferred in decision
0019 is implemented. Several choices must be settled.

## Decision

1. **State machine extension is the INC-2 subset only.** `IncidentStatus` gains
   `IsolationRequested` and `IsolationPlanReady`. `PlanConfirmed`, `HandlingStarted`,
   and `Resolved` remain for INC-3 (decision 0021: no state without a reaching
   transition). Transitions added: `{Classified, IsolationPlanReady, IsolationRequested}
   → IsolationRequested` (re-analysis allowed), `IsolationRequested → IsolationPlanReady`.

2. **IsolationPlan is an immutable snapshot.** Each analysis attempt creates an
   `IsolationPlan` child entity. Re-analysis marks the prior `Proposed` plan
   `Superseded` and appends a new one; plans are never edited in place.
   `IsolationPlanStatus` = `Proposed`, `AnalysisFailed`, `Superseded`. `Confirmed`
   is deferred to INC-3.

3. **Analysis is synchronous; failure is persisted, not thrown.** The command handler
   calls the gRPC port inline (5s deadline, 3 retries). On success it records a
   `Proposed` plan and transitions to `IsolationPlanReady`. On transport failure it
   records an `AnalysisFailed` plan, leaves the incident in `IsolationRequested`
   (user-retryable), and returns a normal result — the failed attempt is auditable on
   the timeline. No integration event is emitted for a failed attempt.

4. **`start_node_id` is supplied by the caller.** Consistent with decisions 0019 §3
   and 0020 §2, the RPC is node-based. Resolving a pipe or device assetRef to its
   incident node(s) is deferred to a later TOP-x/INC-x slice.

5. **Adapter is config-swapped via `Topology:Provider`** (`Grpc` default, `Stub` for
   tests) — mirrors `GisLookup:Provider` (decision 0021).

6. **Event `incident.isolation-plan-created` v1** carries the full plan snapshot
   (`tenantId` explicit, like other incident events) for INC-3/customer-impact consumers.

7. **gRPC contract test = real topology image (Testcontainers), empty-graph
   wire-compat.** The .NET client generated from `proto/topology.proto` is exercised
   against the actual Rust binary; an unknown-tenant call returns an empty, well-formed
   response (decision 0020 §5), proving cross-language wire compatibility. This closes
   the decision 0019 follow-up.

## Consequences

- incident-be takes a build-time dependency on `proto/topology.proto` (owned by
  topology-rs) via `Grpc.Tools`. A breaking proto change requires a new package
  version and a coordinated update.
- The isolation result is exact for the modelled valve placement (decision 0020).
  Valve open/closed state is not considered (Phase 5).
- INC-3 extends `IncidentStatus`/`IsolationPlanStatus` with confirm/handle/resolve
  and adds `maintenance.work-order-requested`.

## Refinement (2026-06-17)

- **Building-block invariant.** `AggregateRepositoryBase.SaveAsync` derives
  `expectedVersion = aggregate.Version - domainEvents.Count` for the optimistic-concurrency
  check, and the `OutboxProcessor` requires every emitted domain event to be mappable
  (an event without a registered mapper is dead-lettered). Combined, this makes the number
  of `MarkAsModified()` calls in a save batch (each does `Version++`) equal to the number
  of domain events added — otherwise the computed `expectedVersion` no longer matches the
  row version in the database and the save fails with a spurious `ConcurrencyException`.
- **Consequence for event-less isolation transitions.** Per §3/§6 we deliberately do NOT
  publish integration (domain) events for `RequestIsolationAnalysis` or `RecordAnalysisFailure`.
  To preserve the invariant above, those two transitions therefore do NOT increment `Version`.
  The single version bump paired with the `IncidentIsolationPlanCreated` event on
  `RecordIsolationPlan` represents the whole successful analysis.
- **Trade-off.** Event-less transitions are not protected by optimistic concurrency (no
  version change to detect a competing write). Accepted for operator-driven, low-concurrency
  incident workflows; revisit if concurrent isolation requests against the same incident
  become a real scenario.
