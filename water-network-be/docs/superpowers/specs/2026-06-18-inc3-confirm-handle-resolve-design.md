# INC-3 — Confirm Plan + Handle + Resolve (Design)

**Date:** 2026-06-18
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** INC-3 (US-P3-05), closes Phase 3
**Service:** `water-network-incident-be` (+ event contract consumed by Phase 4 `maintenance-be`)
**Related decision record:** `docs/decisions/0024-incident-confirm-handle-resolve.md` (to be written)
**Builds on:** INC-1 (decision 0021), INC-2 (decision 0023)

## 1. Problem & Scope

INC-2 left the incident at `IsolationPlanReady` once topology produced a
`Proposed` isolation plan. There is no way to **commit** to that plan, to mark
the incident as actively **handled**, or to **resolve** it. Phase 4
(`maintenance-be`) cannot start because its trigger event —
`maintenance.work-order-requested` — does not yet exist.

INC-3 adds the three lifecycle commands that close Phase 3 and produce the
cross-service contract that opens Phase 4:

1. `ConfirmIsolationPlan` — operator approves the proposed isolation plan.
2. `StartIncidentHandling` — incident moves into active handling; a work order
   is requested from maintenance.
3. `ResolveIncident` — incident is closed.

**Out of scope (YAGNI / deferred):**
- Non-isolation handling path (resolve a minor incident without ever confirming
  a plan). A classified incident that needs no isolation uses `Cancel`. Direct
  Classified→handling can be added later — non-breaking.
- Real Keycloak enforcement of `network-incident:*` permissions (US-X).
- Consumers of the new events (notification, customer-impact, maintenance) —
  catalog entries only; consumers arrive in their own slices.
- Re-opening a `Resolved` incident.

## 2. Decision: single linear isolation-first lifecycle

The lifecycle is one mandatory linear path through isolation. Every transition
emits exactly one domain event, so each calls `MarkAsModified()` +
`AddDomainEvent(...)` — consistent with the decision-0023 invariant that a
`Version` bump must be paired with a domain event (`AggregateRepositoryBase`
derives `expectedVersion = Version - domainEvents.Count`). No new event-less
transitions are introduced.

```
Reported → Classified → IsolationRequested → IsolationPlanReady
   IsolationPlanReady  ─Confirm→        IsolationConfirmed   [evt: incident.isolation-plan-confirmed]
   IsolationConfirmed  ─StartHandling→  InProgress           [evt: maintenance.work-order-requested]
   InProgress          ─Resolve→        Resolved             [evt: incident.resolved]
```

`Cancel` remains available from any non-terminal status (unchanged from INC-1).
Terminal statuses: `Resolved`, `Cancelled`.

### Why isolation-first / mandatory (not a branching state machine)

It is the simplest single-flow model and matches the INC-3 scope exactly. An
incident that needs no valve isolation is a `Cancel` (false alarm) or a future
direct-handling path — adding branches now would multiply transition guards and
tests for a use case product has not asked for. Lifting the restriction later is
non-breaking (new transitions, no contract change).

## 3. Domain model changes

### 3.1 New enum members

| Enum | Added members |
|---|---|
| `IncidentStatus` | `IsolationConfirmed`, `InProgress`, `Resolved` |
| `IsolationPlanStatus` | `Confirmed` |
| `TimelineEntryType` | `IsolationConfirmed`, `HandlingStarted`, `Resolved` |

### 3.2 New aggregate commands (`NetworkIncident`)

| Command | From status | To status | Guards / behaviour |
|---|---|---|---|
| `ConfirmIsolationPlan(string actorId, string? note)` | `IsolationPlanReady` | `IsolationConfirmed` | There must be exactly one active `Proposed` plan; transition it to `Confirmed`. Appends `IsolationConfirmed` timeline entry. Emits `incident.isolation-plan-confirmed`. |
| `StartIncidentHandling(string actorId, string? note)` | `IsolationConfirmed` | `InProgress` | Appends `HandlingStarted` timeline entry. Emits `maintenance.work-order-requested`. |
| `ResolveIncident(string actorId, string? resolutionNote)` | `InProgress` | `Resolved` | Appends `Resolved` timeline entry. Emits `incident.resolved`. |

- Invalid source status → `BusinessRuleException.Violation("InvalidIncidentTransition", ...)` (mirrors existing commands).
- Confirming when no `Proposed` plan exists → `BusinessRuleException.Violation("NoProposedPlan", ...)`. (By the supersede logic established in INC-2, at most one `Proposed` plan can exist, so "exactly one" reduces to "find the single Proposed plan".)
- `IsolationPlan` gains `AsConfirmed()` (mirror of `AsSuperseded()`): only a `Proposed` plan may be confirmed.

## 4. Event contracts (v1)

### 4.1 `incident.isolation-plan-confirmed`
Serves customer-impact (CIM-1) and any audit/notification consumer.
```
{
  tenantId,
  incidentId,
  planId,
  graphVersion,
  valvesToClose:  string[],
  isolatedNodes:  string[],
  isolatedPipes:  string[],
  affectedAssetRefs: [{ assetId, kind }],
  confirmedBy
}
```
`zones` is intentionally omitted in v1 (ZON-1 does not exist yet); adding it
later is non-breaking.

### 4.2 `maintenance.work-order-requested` (Phase 4 input contract — frozen)
```
{
  incidentId,
  assetRefs: [{ assetId, kind }],   // = incident.AffectedRefs (id + kind)
  summary:  string,                  // "{category} severity {severity}", e.g. "PipeBurst severity 3"
  severity: int                      // 1..4
}
```
This is the contract MNT-1 consumes. It is frozen at v1 here and covered by a
contract test. Additional fields (e.g. `isolatedAssets`, `confirmedPlanId`) can
be appended later when maintenance/customer-impact require them — appending is
non-breaking.

### 4.3 `incident.resolved`
```
{ tenantId, incidentId, resolvedBy, resolutionNote? }
```

All three are registered as outbox domain event types via the existing
`AddOutboxDomainEventTypesFromAssembly(...)` wiring, each with an
`IIntegrationEventMapper`, and each gets an entry in the event catalog.

## 5. API endpoints

Mirror INC-1/INC-2 minimal-API style. Each handler loads the incident
tenant-scoped (`GetByIdAsync(tenantId, id)`) so a cross-tenant id returns **404**
(US-X-01 pattern, decision 0016).

| Method + route | Permission | Command |
|---|---|---|
| `POST /api/incidents/{id}/isolation-plan/confirm` | `network-incident:confirm` | `ConfirmIsolationPlan` |
| `POST /api/incidents/{id}/start-handling` | `network-incident:write` | `StartIncidentHandling` |
| `POST /api/incidents/{id}/resolve` | `network-incident:write` | `ResolveIncident` |

Request bodies: confirm/start-handling take optional `{ "note": "..." }`;
resolve takes optional `{ "resolutionNote": "..." }`. Permissions are *declared*
via `RequirePermission`; real Keycloak enforcement is US-X.

## 6. Persistence

No new tables or columns. `IncidentStatus` and `IsolationPlanStatus` persist as
strings; the new members round-trip through the existing
`Enum.Parse<...>`/`.ToString()` mappers. The repository's existing plan-update
branch (`row.Status = plan.Status.ToString()`) already handles
`Proposed → Confirmed`. The three new events flow through the existing outbox.

A migration is required **only** if a new column is introduced; this design adds
none, so no schema migration is expected. (Confirm during implementation that
the enum-as-string columns have no length/check constraint that would reject the
new values.)

## 7. Testing (TDD)

- **Unit (domain):** each transition happy path; invalid-source-status guard for
  each command; `ConfirmIsolationPlan` with no `Proposed` plan; plan
  `Proposed → Confirmed`; `IsolationPlan.AsConfirmed()` rejects non-`Proposed`.
- **Integration (endpoint):** confirm/start-handling/resolve happy path
  (full `IsolationPlanReady → Resolved` walk); invalid-transition → 422
  (`BusinessRuleException` maps to `UnprocessableEntity` in `GlobalExceptionMiddleware`);
  cross-tenant id → 404; permission attribute present.
- **Contract:** serialize/deserialize each of the three v1 event payloads against
  its frozen schema; `maintenance.work-order-requested` is the priority
  (Phase 4 input) — assert all four fields and the `summary` format.
- Slice exit: `dotnet test` green, 0 warnings, conventional commit.

## 8. Decision record

`docs/decisions/0024-incident-confirm-handle-resolve.md` — records the linear
isolation-first lifecycle, the three new statuses, and the frozen
`maintenance.work-order-requested` v1 contract as the Phase 3 → Phase 4 boundary.
