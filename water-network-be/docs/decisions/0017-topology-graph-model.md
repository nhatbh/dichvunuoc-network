# 0017 Topology Graph Model

Date: 2026-06-17

## Status

Accepted

## Context

topology-rs (Phase 3) needs an in-memory graph model to support isolation and
cut-set analysis over the water network. Three modelling questions must be
settled before code:

1. How do network entities (nodes, pipes, devices) map to graph primitives?
2. Where does a valve live — as a vertex or as an attribute of an edge?
3. How are graphs partitioned by tenant?

## Decision

1. **node = vertex, pipe = edge in a petgraph `StableGraph` per tenant.**
   `StableGraph` is chosen over `Graph` because it preserves stable
   NodeIndex/EdgeIndex values after removals, which simplifies incremental
   updates from the event stream.

2. **Valve = attribute on the edge it is hosted on.**
   A valve with `DeviceType == "Valve"` and a non-null `HostPipeId` is stored
   as an attribute of that pipe-edge. Isolation analysis closes valves to cut
   edges; therefore the valve belongs on the edge, not as a separate vertex.
   Non-valve devices are tracked in a side map keyed by device id but do not
   alter graph topology in TOP-1.

3. **Per-tenant graph keyed by `TenantId` read from the event payload.**
   `TenantId` is present in every GIS event payload. The envelope
   `TenantId` is null for events published via the outbox (confirmed in
   decision 0013). Graphs of two tenants are never mixed; each tenant holds
   its own isolated `StableGraph`.

4. **Pipes arriving before their endpoint nodes implicitly create placeholder
   vertices (eventual-consistency / out-of-order tolerance).** When a
   `pipe.created` event arrives referencing a `StartNodeId` or `EndNodeId`
   that has not yet been seen, a placeholder vertex is inserted. A subsequent
   `node.created` event upgrades it to a full vertex in place.

## Consequences

- Isolation analysis reduces to finding the minimal set of closeable edges
  (valve-bearing edges) whose removal disconnects a target zone; no vertex
  removal is needed.
- `node.relocated` and `pipe.updated` (geometry only) are topology-no-ops in
  TOP-1; they carry no edge-semantic change.
- Device events that produce non-valve, non-hosted-pipe records are stored in
  the side map and have no graph-topology effect in TOP-1.
- The petgraph `StableGraph<NodeData, EdgeData>` type is the canonical
  in-memory representation; serialization for snapshots (decision 0018) must
  be compatible with this type.

## Follow-ups

- Pipe `diameter` / `length` as edge weights for hydraulic cost (HYD phase).
- `valve.state.changed` (open/closed) consumption is Phase 5; TOP-1 only
  models the structural placement of valves.
- Multi-edge scenarios (parallel pipes between the same two nodes) — evaluate
  whether `StableGraph` multi-graph mode is needed once real data is available.
