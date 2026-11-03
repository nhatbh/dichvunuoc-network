# 0024 Incident Confirm / Handle / Resolve (INC-3) — linear isolation-first lifecycle, frozen work-order contract

Date: 2026-06-18

## Status

Accepted

## Context

INC-2 (decision 0023) left `NetworkIncident` at `IsolationPlanReady` once topology
produced a `Proposed` isolation plan. No transition existed to commit to that plan,
move into active handling, or mark the incident resolved. Phase 4 (`maintenance-be`)
cannot start without its trigger event `maintenance.work-order-requested`. INC-3 adds
the three transitions that close Phase 3.

Spec reference: `docs/superpowers/specs/2026-06-18-inc3-confirm-handle-resolve-design.md`.

## Decision

1. **Single linear isolation-first lifecycle.** The only supported path through isolation
   is:

   ```
   IsolationPlanReady ─ConfirmIsolationPlan─► IsolationConfirmed
                                                  [evt: incident.isolation-plan-confirmed]
   IsolationConfirmed ─StartIncidentHandling─► InProgress
                                                  [evt: maintenance.work-order-requested]
   InProgress         ─ResolveIncident──────► Resolved
                                                  [evt: incident.resolved]
   ```

   No non-isolation shortcut (Classified→InProgress) is supported in this slice.

2. **Three new `IncidentStatus` values + `IsolationPlanStatus.Confirmed`.**
   `IsolationConfirmed`, `InProgress`, and `Resolved` are added to `IncidentStatus`
   (decision 0021: no state without a reaching transition). `IsolationPlanStatus`
   gains `Confirmed` (deferred from INC-2 per decision 0023 §2).

3. **Decision-0023 invariant preserved: every transition emits exactly one domain event.**
   Each of the three new aggregate methods calls `MarkAsModified()` paired with
   `AddDomainEvent(...)`. `AggregateRepositoryBase.SaveAsync` derives
   `expectedVersion = Version - domainEvents.Count`; a version bump without a paired
   event (or vice-versa) causes a `ConcurrencyException` — the invariant is enforced
   structurally, not by convention.

4. **`maintenance.work-order-requested` v1 contract is FROZEN as the Phase 3→4
   boundary.** The payload record `WorkOrderRequestedV1` carries exactly four fields:
   `IncidentId`, `AssetRefs[]` (each `AssetId`, `Kind`), `Summary`, and `Severity`. This is
   the contract consumed by `maintenance-be` (MNT-1); any breaking change requires a
   new version and coordinated update. The `AssetRefs[]` is typed as an array of
   `IncidentAssetRefV1(AssetId, Kind)` — a value-object projection of the domain
   `IncidentAssetRefData` record. Contract tests assert the exact four-field shape and
   the nested `AssetRefs[]` array structure at INC-3 ship time.

5. **`ConfirmIsolationPlan` requires `network-incident:confirm` permission.**
   `StartIncidentHandling` and `ResolveIncident` require the existing
   `network-incident:write` permission. Permission declarations follow the
   `RequirePermission` convention (decision 0016); real Keycloak enforcement is deferred
   to US-X.

6. **Guard: `ConfirmIsolationPlan` requires a `Proposed` plan.** The aggregate checks
   `IsolationPlans.Any(p => p.Status == IsolationPlanStatus.Proposed)` before
   confirming; if no proposed plan exists, a `BusinessRuleException` is thrown
   (`NoProposedPlan`). The `Confirmed` status is set on the latest proposed plan; prior
   plans remain `Superseded` (immutable — decision 0023 §2).

## Consequences

- `maintenance-be` MNT-1 can now start: its consumer subscribes to
  `maintenance.work-order-requested` v1; the frozen contract guarantees the four-field
  shape.
- `customer-impact-be` CIM-1 can subscribe to `incident.isolation-plan-confirmed`
  (affected-asset snapshot for customer impact analysis).
- `incident.resolved` completes the incident timeline; no event consumer yet.
- INC-3 closes Phase 3 (US-P3-05). Phase 4 (maintenance-be) is now unblocked.

## Refinement (2026-06-18)

- **`AssetRefs[]` as domain records + contract projection.** The domain stores
  `IncidentAssetRefData(AssetId, Kind)` array on the aggregate; the mapper projects it to
  `IncidentAssetRefV1(AssetId, Kind)[]` for the `WorkOrderRequestedV1` payload. The
  split keeps the contract decoupled from the domain record in case field sets diverge
  in a future version.
- **`IsolationPlan.AsConfirmed()` convenience.** The aggregate exposes an
  `IsolationPlan.AsConfirmed()` method that returns the single plan with status
  `Confirmed`, used by the mapper for `IncidentIsolationPlanConfirmedV1`. Throws if
  no confirmed plan exists — maps to a dead-letter scenario, not a business error.

## Deferred

- **Non-isolation handling path.** A classified incident that requires no isolation is
  resolved via `Cancel` in the current slice. A direct `Classified → InProgress`
  shortcut can be added non-breakingly in a later INC-x slice.
- **No event consumers yet.** `incident.isolation-plan-confirmed`,
  `maintenance.work-order-requested`, and `incident.resolved` are registered in the
  event catalog but have no consumers in INC-3. Consumers arrive in their own slices
  (MNT-1, CIM-1).
- **`network-incident:confirm` not enforced via real Keycloak (US-X).** The endpoint
  declares the permission but the JWT mock authority does not validate it for staging.
- **Re-open not supported.** `Resolved` is a terminal state. Re-opening requires a new
  incident or an explicit `ReopenIncident` command (future INC-x).
