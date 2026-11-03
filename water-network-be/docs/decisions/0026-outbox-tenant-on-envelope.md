# 0026 Outbox tenant on envelope — cross-service consumers can read `envelope.TenantId`

Date: 2026-06-18

## Status

Accepted

## Context

The Phase 3→4 boundary contract `maintenance.work-order-requested` v1 (`WorkOrderRequestedV1`,
decision 0024) was frozen with exactly four fields — `IncidentId, AssetRefs[], Summary, Severity` —
and **no `TenantId`**. The new platform FSM service (`water-fsm`, decision 0025) is the first
cross-service consumer of that event and has no local data to look up the incident's tenant.

Two facts made tenant unreachable for that consumer:

1. `WorkOrderRequestedV1` carries no tenant in its payload (unlike every other incident contract,
   which all include `TenantId`).
2. `IntegrationEventEnvelope.TenantId` was populated from the **ambient** `ITenantContextAccessor`
   at publish time. For outbox-published events the publisher runs in the `OutboxProcessor`
   background scope, where the ambient tenant context is `null` — so the envelope tenant was empty.
   The publisher's own doc comment told consumers *not* to rely on envelope tenant for outbox events.

So neither the payload nor the envelope conveyed tenant to a cross-service consumer.

## Decision

Stamp the writer's tenant onto the outbox entry at write-time and restore it onto the published
envelope at drain-time. Concretely:

1. **Capture (Task A1).** `OutboxEntry` gains a nullable `TenantId`. `OutboxRepository.AddAsync` /
   `AddManyAsync` set `tenantAccessor.Current?.TenantId` when staging — staging happens in the
   request scope, where the ambient tenant is present.
2. **Restore (Task A2).** `IIntegrationEventPublisher.PublishAsync` gains an optional
   `string? tenantId`. `MassTransitIntegrationEventPublisher` uses `tenantId ?? ambient?.TenantId`
   for `envelope.TenantId`. `OutboxProcessor` passes `entry.TenantId`.
3. **Migrate (Task A3).** Each service whose DbContext maps the outbox (gis, asset, design,
   incident) gets an additive, nullable `tenant_id` column migration on `outbox_entries`.

**New guidance (supersedes the publisher's old remark):** consumers of outbox-published integration
events MAY rely on `envelope.TenantId`. The payload need not carry tenant solely for routing.

## Consequences

- The frozen `WorkOrderRequestedV1` contract is left untouched (no v2, no field added) — FSM derives
  tenant from `envelope.TenantId`.
- All cross-service consumers (FSM today; production / business domains tomorrow) get tenant on every
  outbox event for free.
- Verified non-breaking: building-block suites 109/109; gis/asset/design/incident 478 unit+contract +
  178 integration green (1 pre-existing `TopologyGrpcContractTests` Docker failure, unrelated).

## Alternatives rejected

- **Amend `WorkOrderRequestedV1` (add `TenantId`)** or **bump to v2** — fixes only this one contract;
  every future cross-domain event would face the same gap. Rejected in favor of the platform-wide fix.

## Deferred

- `OrganizationId` / `BranchId` are still taken from ambient context only (null for outbox events).
  Stamp them onto the outbox entry too if a consumer needs org/branch routing.
- No index on `outbox_entries.tenant_id` yet — add when a query pattern needs it.
