# 0018 Topology Warm-up and Event Consumption

Date: 2026-06-17

## Status

Accepted

## Context

topology-rs is a stateless-about-business Rust service that holds a
rebuildable in-memory read model (the per-tenant graphs of decision 0017). Two
operational concerns must be settled:

1. **Warm-up on restart** — how does the service restore its graph state after
   a process restart without replaying the entire event history from the broker?
2. **AMQP binding** — topology-rs consumes MassTransit-published events from
   the existing .NET services; how should the durable queue and exchange
   bindings be declared so the Rust AMQP client interoperates correctly?

## Decision

1. **Warm-up = snapshot + replay.**
   topology-rs periodically serializes the full `TenantGraphs` map to disk
   (snapshot). On startup it loads the snapshot, extracts the last-processed
   `EventId` per tenant (stored inside the snapshot), then resumes consuming
   from the durable queue from that position. Messages already processed and
   included in the snapshot are skipped via idempotency check (see point 4).

2. **Fallback = full rebuild via GIS bulk export.**
   When no snapshot exists (first boot or snapshot deleted), the service
   performs a full rebuild by calling
   `GET /api/network/assets/export` (keyset-paginated). TOP-1 implements
   per-tenant rebuild; multi-tenant enumeration (discovering all tenant IDs
   automatically) is deferred — snapshot is the primary steady-state path.
   The export endpoint caller uses an env-configured bearer token for auth
   (service-to-service identity / mock token factory from roadmap §15.2 is
   out-of-scope for TOP-1).

3. **Raw-AMQP binding: durable queue `water-network-topology-rs`.**
   The service declares the queue as durable and binds it to MassTransit's
   fanout message exchange (exact exchange name verified empirically during
   implementation by inspecting the broker topology). This mirrors the pattern
   used by the .NET consumers and gives topology-rs its own independent
   consumer group.

4. **Idempotency by `EventId` held in the snapshot.**
   Each processed `EventId` is stored in the snapshot, mirroring the .NET
   inbox pattern (decision 0013). On replay after a restart, any event whose
   `EventId` already appears in the snapshot is dropped without re-processing.
   `TenantId` is always read from the event payload, never from the AMQP
   envelope (envelope tenant is null for outbox-published events — decision
   0013).

## Consequences

- The graph is an eventually-consistent read model; there is no strong
  consistency guarantee between the event stream and a caller's observed state.
- Every future gRPC response (TOP-2) will carry a `graphVersion` field derived
  from the snapshot sequence number / last-event cursor so callers can detect
  staleness.
- Disk snapshot I/O is synchronous in TOP-1; snapshot store may be migrated to
  Redis in a later phase without changing the warm-up contract.
- Drift-reconciliation (detecting and correcting divergence between the graph
  and the authoritative GIS state) is scheduled for TOP-3+.

## Follow-ups

- Service-to-service auth for the export call: system identity / mock token
  factory (roadmap §15.2). TOP-1 uses a plain env-configured bearer token.
- Snapshot storage: disk now, Redis later.
- Multi-tenant rebuild enumeration: automatic discovery of all tenant IDs
  without manual configuration.
- `valve.state.changed` consumption (Phase 5) will extend the idempotency
  store and snapshot format.
