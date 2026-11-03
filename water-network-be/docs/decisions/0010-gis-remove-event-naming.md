# 0010 GIS-3 Remove Event Naming: Use `network.*.deleted` Instead of `network.*.removed`

Date: 2026-06-14

## Status

Accepted

## Context

The implementation roadmap (`docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
§4.4) sketches the soft-delete integration events as `network.node.removed`,
`network.pipe.removed`, and `network.device.removed`. However, the `water-network-gis-be`
domain layer already ships a `NodeDeleted` domain event (with `EventType = "NodeDeleted"`)
that pre-dates the GIS-3 slice. Renaming it to `NodeRemoved` would require changing the
domain event class, the mapper registry key, all existing tests, and any downstream consumers
that had already referenced the domain event type — churn with no functional benefit.

## Decision

GIS-3 retains the existing `NodeDeleted` domain event and introduces consistent counterparts
`PipeDeleted` and `DeviceDeleted`. The integration event types published to the bus are:

- `network.node.deleted` v1
- `network.pipe.deleted` v1
- `network.device.deleted` v1
- `network.node.relocated` v1 (no conflict with roadmap wording on this one)

The roadmap §4.4 "removed" wording is updated to "deleted" to match. This file is the
authoritative naming reference; the roadmap is a derived document.

## Consequences

- Downstream consumers (topology-rs, asset-be, future services) must subscribe to
  `network.*.deleted`, not `network.*.removed`.
- The domain event names (`NodeDeleted`, `PipeDeleted`, `DeviceDeleted`) and the
  integration event type constants in `GisEventTypes` are stable.
- The roadmap §4.4 event column is updated to reflect "deleted" naming.
- Any external documentation or event catalog entry referencing the old "removed" wording
  should be corrected on first touch.
