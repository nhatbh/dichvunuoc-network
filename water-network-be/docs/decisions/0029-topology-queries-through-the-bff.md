# 0029 — Topology queries through the BFF, rebuilt on demand

Date: 2026-11-09. Status: Accepted (plan TRC, verified on the local cloud stack 2026-11-09).

## Context

SYSTEM 3D's trace and isolation screen ran on seed data. topology-rs (decisions 0018–0023)
answers isolation, trace and nearest-valve queries over gRPC, but only incident-be called it;
it isolated from a node only, traced without direction, and kept an empty graph when it started
after the network had been published (its queue binds on first start; the export rebuild existed
but was never wired).

## Decision

1. **The BFF exposes topology** at `/api/gis/topology/*` (isolation, trace, nearest valves,
   issues) and calls topology-rs over gRPC with a 5 s deadline. Tenant comes from the token;
   permission `network-gis:read`. Transport faults are `503 TOPOLOGY_UNAVAILABLE`.
2. **The caller's bearer token travels in gRPC metadata.** When a tenant has no graph,
   topology-rs pages gis-be's export with that token, applies it, and answers; one rebuild at a
   time. `TOPOLOGY_GIS_TOKEN` is an optional fallback for callers that forward none (incident-be).
   Responses carry `graph_ready=false` when no graph could be built.
3. **Proto v1 grows compatibly:** `oneof start { start_node_id, start_pipe_id }`,
   `TraceDirection`, `source_node_ids`, `boundary_pipe_ids`, `affected_service_ids`,
   `graph_ready`. Existing callers keep working.
4. **Graph semantics follow the catalog (0028):** `isolates` devices bound segments, `serves`
   devices are customers affected, `supplies`/`stores` nodes are trace sources, devices installed
   `state=closed` block traces.

## Consequences

- No service credential is needed for the BFF path; the rebuild sees exactly what the user may see.
- Valve state changes after installation do not reach topology yet (gis-be publishes edits as
  `NetworkAssetEdited` without properties) — a follow-up.
