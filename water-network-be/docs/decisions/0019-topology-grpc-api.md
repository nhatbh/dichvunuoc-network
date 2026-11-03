# 0019 Topology gRPC API (tonic, tenant-as-field, node-based RPCs)

Date: 2026-06-17

## Status

Accepted

## Context

topology-rs (TOP-1) holds a per-tenant, eventually-consistent in-memory graph
built from AMQP events. TOP-2 exposes that graph over gRPC with three read-only
RPCs — `ValidateTopology`, `TraceNetwork`, `FindNearestValves` — so that other
services can query network topology without coupling to the event stream or the
internal Rust crate. Several design choices that the roadmap (§8.2/§8.3) left
open must be settled before implementation begins.

## Decision

1. **gRPC stack: tonic + prost.**
   The server and client code are generated from a single proto file at
   `src/services/water-network-topology-rs/proto/topology.proto`, package
   `waternetwork.topology.v1`. Code generation is wired via `tonic-build` in
   `crates/topology-service/build.rs`. `protoc` is supplied by the
   `protoc-bin-vendored` crate, which embeds a pre-built `protoc` binary and
   sets the `PROTOC` environment variable at build time — neither local
   development environments nor the Docker build need a system `protoc`
   installed.

2. **Tenant = explicit `tenant_id` request field.**
   Every request message carries a `tenant_id` string field. Tenant routing via
   gRPC metadata was considered and rejected: explicit fields are simpler,
   unambiguous in generated code, and trivially testable without metadata
   interceptors. Service-to-service authentication (system identity / mTLS,
   roadmap §15.2) is a separate, deferred concern and is not part of this
   decision.

3. **All RPCs are node-id-based.**
   `TraceNetwork` and `FindNearestValves` take a `start_node_id` (the graph's
   canonical node identifier). Resolving a pipe or device `assetRef` to its
   node(s) — needed when an incident asset sits on a pipe rather than at a
   junction — is deferred. The first gRPC caller (INC-2) can supply the nearest
   node directly, or a future TOP-x slice can add resolution logic.

4. **`TraceNetwork` = depth-limited undirected BFS; no `direction` field.**
   The network graph built in TOP-1 is undirected (`StableUnGraph`). Flow
   direction (upstream/downstream) is not yet modelled, so no `direction` field
   is added to `TraceNetworkRequest`. The field will be introduced when pipe
   directionality or hydraulic simulation lands; adding it later is a backward-
   compatible proto change.

5. **`graph_version` = the global applied-event counter.**
   Every response carries a `graph_version` field populated from
   `TenantGraphs::version()` — the monotonically increasing count of events
   applied across all tenants since the last process start or snapshot load.
   Callers use it as a staleness token to detect when the graph is catching up.
   A per-tenant version counter is a refinement deferred to a later slice.

6. **`ValidateTopology` issue types and node provenance.**
   Three issue types are defined:
   - `ORPHAN_NODE`: a node that was created via `NodeRegistered` /
     `NodeRelocated` (i.e., it is a real, registered node) but has no pipe
     connections (degree 0).
   - `MISSING_ENDPOINT`: a node that exists only because a pipe referenced it
     as an endpoint — no `NodeRegistered` or `NodeRelocated` event was ever
     applied for it. These are placeholder vertices created implicitly by
     `PipeRegistered`.
   - `DISCONNECTED_COMPONENT`: the graph is split into more than one connected
     component. Every component except the largest is reported (the largest is
     assumed to be the main network).

   Distinguishing `ORPHAN_NODE` from `MISSING_ENDPOINT` requires tracking
   **node provenance**: `NodeVertex` gains a `registered` boolean (default
   `false`, `#[serde(default)]` for snapshot forward-compatibility). A new
   `register_node` method on `NetworkGraph` sets the flag to `true`; `apply.rs`
   calls it for `NodeRegistered` and `NodeRelocated` events. Pipe endpoint
   vertices created by `add_pipe` remain `registered: false` until their own
   node event arrives.

7. **Contract: the `.proto` is the committed cross-language contract.**
   The proto file is version-controlled alongside the service. TOP-2 validates
   the **server** with a Rust in-process server+client integration test
   (tonic server bound to an ephemeral TCP port, called via the generated
   tonic client). The **.NET client contract test is deferred to INC-2**:
   `incident-be` is the first planned gRPC caller, but it does not exist yet.
   When INC-2 is implemented it will consume the same proto and include a
   contract-level test against the topology service. This deferral is noted in
   the backlog.

8. **Out of scope for TOP-2 (deferred to later slices).**
   The following are explicitly not implemented in this slice:
   - `ComputeIsolationZone` (TOP-3)
   - `BuildNetworkSnapshot` / hydraulic snapshot (Phase 6)
   - Flow-direction / upstream-downstream trace
   - Pipe or device `assetRef` → node resolution
   - Per-tenant `graph_version`
   - Real service-to-service auth (system identity / mTLS, roadmap §15.2)

## Consequences

- The graph remains an eventually-consistent read model. Callers must tolerate
  stale data between when an asset event is published and when it is applied to
  the graph.
- Every gRPC response carries `graph_version` as a freshness token. Callers
  can compare successive versions to detect whether the graph has advanced
  since their last call.
- An unknown `tenant_id` returns empty results rather than an error. This is
  intentional: the graph is eventually consistent and may simply not have
  received the tenant's first event yet.
- `NodeVertex` now carries a `registered` flag. Existing snapshots produced by
  TOP-1 nodes will deserialize with `registered: false` for all vertices
  (via `#[serde(default)]`); this means a first-boot after the TOP-2 upgrade
  will report all nodes as `MISSING_ENDPOINT` until the snapshot is rebuilt or
  a full warm-up replay marks them correctly.
- The `.proto` file is the source of truth for the API contract. Any breaking
  change to the proto (field removal, field number reuse, renaming) requires a
  new version package (`waternetwork.topology.v2`) and a new decision record.

## Follow-ups

- **.NET client contract test (INC-2):** when `incident-be` is implemented as
  the first gRPC caller, add a contract-level test that validates the .NET
  client against the proto.
- **Pipe/device `assetRef` → node resolution:** `TraceNetwork` and
  `FindNearestValves` currently require a `start_node_id`. A resolution helper
  that maps a pipe or device asset reference to its incident node(s) should be
  added in a future TOP-x or INC-x slice.
- **Flow-direction trace:** once pipe directionality is modelled (hydraulics
  phase), add an optional `direction` field to `TraceNetworkRequest`
  (upstream / downstream / both).
- **Per-tenant `graph_version`:** the current global counter is a coarse
  freshness signal. Replace or supplement it with a per-tenant applied-event
  cursor when finer staleness detection is needed.
- **`ComputeIsolationZone`** (TOP-3) and **`BuildNetworkSnapshot`** (Phase 6
  hydraulic) are already in the roadmap; they extend the proto with new RPCs.
- **Real service-to-service auth** (mTLS / system identity, roadmap §15.2).
- **Isolated-placeholder cleanup:** a `MISSING_ENDPOINT` placeholder vertex
  lingers in the graph if its only pipe is later removed. A `remove_pipe`
  clean-up pass for `registered: false, degree 0` vertices should be added
  to eliminate spurious `MISSING_ENDPOINT` reports after pipe removal.
