# 0020 Topology ComputeIsolationZone — valve-segment isolation model

Date: 2026-06-17

## Status

Accepted

## Context

TOP-3 adds a fourth gRPC RPC to topology-rs: `ComputeIsolationZone`. Given a
start node (the incident asset's node), the service must return the minimal set
of valves to close to isolate the affected segment of the network, plus the list
of nodes and pipes that become isolated. Several algorithm and API choices needed
to be settled before implementation.

The proto contract, tenant routing, node-based addressing, and `graph_version`
semantics were already decided in decision 0019 (TOP-2). This record covers only
the choices specific to the isolation computation.

## Decision

1. **Isolation model = valve segment.**
   The incident's segment is the maximal set of nodes reachable from the start
   node via pipes that have **no** valve. A pipe **with** a valve is a cut
   boundary: closing that valve severs flow into the segment. To isolate the
   segment, close every valve on every valved pipe incident to it.

   This is the standard water-network valve-segment isolation model and is
   *minimal* for the given valve placement — i.e., no redundant valves are
   added. A global min-cut optimisation (which could identify a smaller valve
   set if valves are placed sub-optimally) is explicitly out of scope for TOP-3
   (roadmap §8.3 notes "greedy by distance first, optimise later").

   The algorithm is a BFS from `start_node_id` over the in-memory
   `StableUnGraph`:
   - Traverse valveless pipes freely (they are internal to the segment).
   - Stop at any pipe that carries at least one valve; collect the valve
     identifiers but do not cross the boundary.
   - Result: (boundary valves, segment nodes, internal valveless pipes).

2. **Node-based start (`start_node_id`).**
   Consistent with decision 0019, the RPC takes a `start_node_id` rather than
   a pipe or device `assetRef`. INC-2 (the first planned caller) can supply the
   relevant node directly. Resolving a pipe or device assetRef to its incident
   node(s) is deferred.

3. **Response shape.**
   Per roadmap §8.2 the response carries four fields:
   - `valves_to_close[]` — the identifiers of every valve on a boundary pipe.
   - `isolated_nodes[]` — all nodes inside the segment (BFS-reachable via
     valveless pipes from the start node).
   - `isolated_pipes[]` — the valveless pipes that are wholly internal to the
     segment. Boundary valved pipes are **not** included: they straddle the
     segment boundary and are only partially within the isolation zone.
   - `graph_version` — the global applied-event counter (same semantics as in
     decision 0019).

   All three lists are sorted lexicographically for deterministic responses.

4. **Not-isolatable case.**
   If the segment has no incident valved pipes, `valves_to_close` is empty and
   `isolated_nodes` is the entire valveless-reachable connected component of the
   start node. No error is returned and no extra flag is added. The caller
   (INC-2) interprets "empty `valves_to_close` + large `isolated_nodes`" as a
   not-isolatable segment. Adding a dedicated boolean flag is deferred; if
   demand arises it is a backward-compatible proto field addition.

5. **Unknown tenant / unknown start node → empty result.**
   Consistent with decision 0019, an unknown `tenant_id` or a `start_node_id`
   that does not exist in the tenant's graph returns an empty
   `ComputeIsolationZoneResponse` (all lists empty, `graph_version` as normal).
   No error status is returned; the graph is eventually consistent and may
   simply not have received the relevant events yet.

6. **Performance budget: O(V+E) over the segment; 100k-edge test < 200ms.**
   `compute_isolation_zone` is O(V+E) bounded to the reachable segment (worst
   case: the whole graph if no valves are present). An `#[ignore]`d perf test
   builds a 100k-edge graph and asserts completion under 200ms on a release
   build. This is a single-run upper bound consistent with roadmap §8.3
   (p99 < 200ms); it is not a full statistical latency harness.

## Consequences

- INC-2 has the isolation RPC it needs to drive incident triage workflows
  without coupling to the topology event stream.
- The isolation result is exact for the modelled valve placement: every valve
  that must close is returned, and no unnecessary valves are included, given
  the current `PipeEdge.valves` set on each pipe.
- Boundary valved pipes are excluded from `isolated_pipes`. Callers that need
  to reason about partially-affected boundary pipes must do so out-of-band;
  the proto field `isolated_pipes` contains only wholly-internal pipes.
- If the network has no valves (or no valves reachable from the incident node),
  the segment encompasses the entire valveless component, and the caller must
  interpret this as a not-isolatable situation.
- The algorithm operates on the in-memory graph snapshot; it does not account
  for a valve's current open/closed state. A valve listed in `valves_to_close`
  may already be closed (over-reporting) or may be inoperable (under-delivery).
  Valve state refinement is deferred to Phase 5.

## Follow-ups

- **Pipe/device `assetRef` → node resolution:** `ComputeIsolationZone` currently
  requires a `start_node_id`. A resolution helper that maps a pipe or device
  asset reference to its incident node(s) should be added in a future TOP-x or
  INC-x slice.
- **Global min-cut optimisation:** the valve-segment model is minimal for the
  given valve placement but does not minimise the number of valves to close
  across alternative placements. A global min-cut pass (roadmap §8.3) is deferred.
- **Valve open/closed state (`valve.state.changed`, Phase 5):** currently all
  valves on boundary pipes are returned regardless of their state. Once
  `valve.state.changed` events are consumed and stored in the graph, the
  isolation algorithm can filter to only valves that are open (i.e., actually
  need closing) and flag inoperable valves separately.
- **Partial-isolation semantics of boundary pipes:** boundary valved pipes
  straddle the segment edge and are excluded from `isolated_pipes`. Future
  callers may need a separate `boundary_pipes[]` field to reason about partial
  isolation or to display the boundary in a map UI.
- **Not-isolatable flag:** if callers find the "empty valves + large zone"
  convention ambiguous, add a `bool not_isolatable` field to the response proto
  (backward-compatible addition).
