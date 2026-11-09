# TRC — Trace and isolation live in SYSTEM 3D

**Date:** 2026-11-09
**Status:** Proposed — awaiting review (decision 0029)
**Services:** topology-rs, BFF, gis-be (read only), water-network-fe (contracts, Trace screen, mocks), local stack

## Outcome

The SYSTEM 3D "Truy vết & cô lập van" screen runs on the real network: pick a pipe or a node,
and the platform returns the valves to close, the isolated pipes and nodes, and the customers
affected — computed by topology-rs over the published network, with the catalog `isolates`
flag (decision 0028). Upstream/downstream trace works from the network's sources.

Done when, on the local stack:
1. After `-Reset` and seeding, isolating a pipe in SYSTEM 3D highlights the segment and lists
   the gate/butterfly valves to close; check valves and PRVs are never listed.
2. topology-rs knows the network even when it starts after the assets were published
   (rebuild from gis-be's export).
3. Upstream trace from a node reaches a Reservoir/Tank/Source; downstream lists what is fed.
4. All suites pass; the mock answers the same contract offline.

## Gaps found

| Gap | Where |
|---|---|
| Isolation starts from a node only; the screen targets a pipe | proto `ComputeIsolationZone` |
| Trace is a plain depth BFS; no upstream/downstream | `graph.trace` |
| Nodes carry no component, so sources are unknown | `NodeVertex` |
| Devices keep only `isolates`; customers affected can't be counted | `DevicePlacement` |
| Empty graph if topology-rs starts after publishing (queue bound later); rebuild code exists but is not wired | `gis_client.rs`, `warmup.rs` |
| No BFF route to topology; topology-rs is not in the local stack | BFF, `docker-compose.local.yml` |
| Trace screen reads seed data (`G.isolation`) | gis-3d `screens/trace.tsx` |

## Slices (each: TDD, green suites with 0 warnings, conventional commit)

### TRC-1 topology-rs graph model
- [ ] Nodes keep `component_code` and functions (from v2 events and export); devices keep all
      functions, not just `isolates`. Snapshot stays backward compatible (`serde(default)`).
- [ ] `compute_isolation_zone` accepts a pipe: the segment is the pipe's valve-free component;
      a valve on the target pipe itself is closed; result adds `affectedServices` (devices with
      `serves` on isolated pipes/nodes) and `boundaryPipes`.
- [ ] `trace(start, direction)`: `upstream` = shortest paths to the nearest `supplies`/`stores`
      nodes; `downstream` = everything reachable from the start when the upstream path is cut;
      `all` = the current depth BFS. Closed valves (`state=closed` property) block traversal.
- [ ] Tests: pipe start, valve on the target pipe, check valve/PRV never closed, closed valve
      blocks trace, upstream reaches a reservoir.

### TRC-2 topology-rs API and rebuild
- [ ] Proto v1 additions (backward compatible): `oneof start { start_node_id, start_pipe_id }`,
      `TraceDirection`, `affected_service_ids`, `boundary_pipe_ids`, `graph_ready`.
- [ ] Rebuild wired: when a query arrives for a tenant with no graph, topology-rs pages gis-be's
      export with the caller's bearer token (forwarded in gRPC metadata by the BFF), applies it,
      then answers; concurrent callers wait on the same rebuild. `graph_ready=false` with an
      empty result if gis-be is unreachable.
- [ ] Tests: wiremock export → first query rebuilds; second query does not.

### TRC-3 BFF routes
- [ ] gRPC client (same proto as incident-be), `Topology:BaseUrl`, 5 s deadline, bearer forwarded.
- [ ] `POST /api/gis/topology/isolation` `{ pipeId | nodeId }` →
      `{ valvesToClose, isolatedPipes, isolatedNodes, boundaryPipes, affectedServices, graphVersion, graphReady }`.
- [ ] `GET /api/gis/topology/trace?from=&direction=upstream|downstream|all&maxDepth=`.
- [ ] `GET /api/gis/topology/nearest-valves?nodeId=&k=`, `GET /api/gis/topology/issues`.
- [ ] Permission `network-gis:read`; tenant from the token; 503 `TOPOLOGY_UNAVAILABLE` on transport faults.
- [ ] Unit tests with a fake gRPC client; OpenAPI updated.

### TRC-4 Frontend
- [ ] `@wn/contracts/topology`: Zod schemas for the four responses.
- [ ] Trace screen: target picker (click a pipe/node on the map), runs the BFF call, highlights
      result; valve list shows component names from the catalog; "customers affected" count.
- [ ] MSW mock: same contract, computed from the demo seed with a port of the isolation rule
      (valves with `isolates`), so offline mode behaves like the server.
- [ ] Tests: contract parse, screen with the mock, mock rule (check valve never closed).

### TRC-5 Local stack and verification
- [ ] `docker-compose.local.yml`: topology-rs with `TOPOLOGY_GIS_BASE_URL`, BFF `Topology__BaseUrl`.
- [ ] Live test (`WN_LIVE_BFF`): isolate a seeded pipe; restart topology-rs with no snapshot and
      query again (rebuild path).
- [ ] Decision 0029 accepted; integration plan doc updated.

## Out of scope
Pressure-aware criticality, valve operability history, persisting isolation plans from the
Trace screen (incident-be already does this for incidents — next slice "Incidents via the BFF").
