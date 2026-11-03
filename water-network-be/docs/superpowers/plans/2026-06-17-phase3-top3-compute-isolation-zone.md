# TOP-3 — topology-rs ComputeIsolationZone over gRPC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. TDD is mandatory — failing test first, watch it fail, then implement.

**Goal:** Add a fourth topology-rs gRPC RPC, `ComputeIsolationZone`, that returns the minimal set of valves to close to isolate an incident asset, plus the isolated nodes/pipes — using the valve-segment model — with a perf budget on large graphs.

**Architecture:** `topology-core` gains one pure, unit-tested method `compute_isolation_zone(start_node_id)`: BFS from the incident node traversing only **valveless** pipes builds the incident's *segment*; every **valved** pipe incident to that segment is a boundary whose valves must close. The result = (boundary valves, segment nodes, internal valveless pipes). The proto/`grpc.rs`/server wiring from TOP-2 already exist — this slice adds one RPC + message pair and one handler method (the existing tonic server serves it automatically). A perf test on a 100k-edge graph guards the latency budget.

**Tech Stack:** Rust · petgraph BFS · tonic/prost (existing) · existing TOP-1/TOP-2 crates. No new dependencies.

---

## Design decisions (locked — review before executing; recorded in decision 0020)

1. **Isolation model = valve segment.** The incident's segment is the maximal set of nodes reachable from the start node via pipes that have **no** valve. A pipe **with** a valve is a cut boundary (closing the valve cuts flow). To isolate the segment, close every valve on a valved pipe incident to it. This is the standard water-network valve-segment isolation and is *minimal* for the given valve placement (roadmap §8.3 "greedy by distance first, optimise later" — a global min-cut optimisation is out of scope).
2. **Node-based start** (`start_node_id`), consistent with TOP-2 decision 0019. Resolving a pipe/device incident assetRef to its node(s) is deferred (INC-2 passes the relevant node).
3. **Response** per roadmap §8.2: `valves_to_close[]`, `isolated_nodes[]`, `isolated_pipes[]`, `graph_version`. `isolated_pipes` = valveless pipes internal to the segment; boundary valved pipes are NOT listed (they are only partially in the zone). All lists sorted for determinism.
4. **Not-isolatable case:** if the segment has no incident valved pipes, `valves_to_close` is empty and `isolated_nodes` is the whole valveless-reachable component — the caller (INC-2) interprets "empty valves + large zone" as not isolatable. No error, no extra flag in TOP-3.
5. **`graph_version`** = global `TenantGraphs::version()` (same as TOP-2). Unknown tenant / unknown start node → empty result, not an error.
6. **Perf budget:** `compute_isolation_zone` is O(V+E) over the segment; an `#[ignore]`d perf test builds a 100k-edge graph and asserts completion under 200ms (roadmap §8.3 p99 < 200ms — a single-run bound, not a full statistical harness).

---

## Verified current state (TOP-2, on `main`)

- `topology-core/src/graph.rs`: `NetworkGraph` (private `graph: StableUnGraph<NodeVertex,PipeEdge>`, `node_ix`, `pipe_ix`, `devices`). `PipeEdge { pub pipe_id: String, pub valves: HashSet<String> }`. Existing analysis methods `validate`, `trace`, `nearest_valves` use `self.graph.edges(ix)` with `use petgraph::visit::EdgeRef;` already imported (for `.source()/.target()`). `use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};` imported.
- `lib.rs` re-exports include `IssueKind, NearestValve, NetworkGraph, TopologyIssue, …`.
- `topology-service`: `proto/topology.proto` (package `waternetwork.topology.v1`) has `TopologyService` with `ValidateTopology`, `TraceNetwork`, `FindNearestValves`. `src/proto.rs` = `tonic::include_proto!` (with `#![allow(clippy::all)]`). `src/grpc.rs` = `TopologyGrpc { state: SharedState }` implementing the generated `TopologyService` trait (3 methods), each: `request.into_inner()` → `state.graphs.read().await` → `graphs.tenant(&req.tenant_id)` → core call → map → response with `graph_version: graphs.version()`. `build.rs` compiles the proto via vendored protoc. `main.rs` spawns the tonic server (topology + gRPC health) — it serves whatever the trait defines, so **adding a method to the trait requires only a new `grpc.rs` impl method**, no main change.
- gRPC integration tests live in `grpc.rs`'s `#[cfg(test)] mod tests` (in-process server on `127.0.0.1:0` + generated client via `tokio-stream` dev-dep).

---

## File structure

```
src/services/water-network-topology-rs/
├── proto/topology.proto                       # Modify: add ComputeIsolationZone RPC + messages
├── crates/topology-core/src/graph.rs          # Modify: IsolationZone type + compute_isolation_zone + tests + perf test
├── crates/topology-core/src/lib.rs            # Modify: re-export IsolationZone
└── crates/topology-service/src/grpc.rs        # Modify: implement compute_isolation_zone + integration test
docs/decisions/0020-topology-isolation-zone.md # Create
docs/stories/backlog.md, .../2026-06-13-master-implementation-roadmap.md, docs/conventions/template-mapping.md  # Modify
```

---

## Task 0: Decision record 0020

**Files:** Create `docs/decisions/0020-topology-isolation-zone.md`

- [ ] **Step 1: Write the ADR** mirroring `docs/decisions/0019-topology-grpc-api.md` format (`# 0020 …`, Date 2026-06-17, Status Accepted, Context, Decision, Consequences, Follow-ups). Capture the 6 design decisions above: valve-segment isolation model (BFS over valveless pipes; boundary valves closed; minimal for given valve placement, not global min-cut); node-based start; response shape (valves_to_close / isolated_nodes / isolated_pipes / graph_version; boundary valved pipes excluded from isolated_pipes); not-isolatable = empty valves + whole component; unknown tenant/start → empty; perf budget O(V+E), 100k-edge test < 200ms. Follow-ups: pipe/device assetRef resolution; global min-cut optimisation; valve open/closed state (`valve.state.changed`, Phase 5) refining "closeable".

- [ ] **Step 2: Commit**

```bash
git checkout -b feature/phase3-top3-isolation-zone
git add docs/decisions/0020-topology-isolation-zone.md
git commit -m "docs(topology): TOP-3 decision 0020 valve-segment isolation model (TOP-3)"
```

---

## Task 1: `compute_isolation_zone` analysis (`topology-core`)

**Files:** Modify `crates/topology-core/src/graph.rs`, `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write failing tests** — append to the `tests` module in `graph.rs`:

```rust
    #[test]
    fn isolation_segment_bounded_by_valves() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // valveless
        g.add_pipe("p2", "n2", "n3"); // valved boundary
        g.add_pipe("p3", "n3", "n4"); // valveless, outside
        for n in ["n1", "n2", "n3", "n4"] { g.register_node(n); }
        g.set_device("v1", "Valve", Some("p2"), None);
        let z = g.compute_isolation_zone("n1");
        assert_eq!(z.valves_to_close, vec!["v1"]);
        assert_eq!(z.isolated_nodes, vec!["n1", "n2"]); // n3,n4 outside the boundary
        assert_eq!(z.isolated_pipes, vec!["p1"]);        // p2 is boundary (excluded), p3 outside
    }

    #[test]
    fn isolation_valve_directly_at_incident() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // valved right at n1's edge
        g.register_node("n1"); g.register_node("n2");
        g.set_device("v1", "Valve", Some("p1"), None);
        let z = g.compute_isolation_zone("n1");
        assert_eq!(z.valves_to_close, vec!["v1"]);
        assert_eq!(z.isolated_nodes, vec!["n1"]);
        assert!(z.isolated_pipes.is_empty());
    }

    #[test]
    fn isolation_no_valves_returns_whole_component_no_valves() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        for n in ["n1", "n2", "n3"] { g.register_node(n); }
        let z = g.compute_isolation_zone("n1");
        assert!(z.valves_to_close.is_empty(), "no valves → not isolatable");
        assert_eq!(z.isolated_nodes, vec!["n1", "n2", "n3"]);
        assert_eq!(z.isolated_pipes, vec!["p1", "p2"]);
    }

    #[test]
    fn isolation_unknown_start_is_empty() {
        let g = NetworkGraph::default();
        let z = g.compute_isolation_zone("nope");
        assert!(z.valves_to_close.is_empty() && z.isolated_nodes.is_empty() && z.isolated_pipes.is_empty());
    }
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core graph::tests::isolation`
Expected: FAIL — `compute_isolation_zone` / `IsolationZone` undefined.

- [ ] **Step 3: Implement**

Add the public type near the other public types in `graph.rs`:

```rust
/// The result of an isolation computation: the valves to close to isolate the
/// incident's segment, and the nodes/pipes that become isolated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IsolationZone {
    pub valves_to_close: Vec<String>,
    pub isolated_nodes: Vec<String>,
    pub isolated_pipes: Vec<String>,
}
```

Add inside `impl NetworkGraph`:

```rust
    /// Compute the valve-segment isolation zone around `start_node_id`: BFS over
    /// valveless pipes builds the segment; every valved pipe incident to it is a
    /// boundary whose valves must close. Empty if the start node is absent.
    pub fn compute_isolation_zone(&self, start_node_id: &str) -> IsolationZone {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return IsolationZone { valves_to_close: Vec::new(), isolated_nodes: Vec::new(), isolated_pipes: Vec::new() };
        };
        let mut in_segment: HashSet<NodeIndex> = HashSet::new();
        let mut isolated_pipes: HashSet<String> = HashSet::new();
        let mut valves: HashSet<String> = HashSet::new();
        let mut q: VecDeque<NodeIndex> = VecDeque::new();
        in_segment.insert(start);
        q.push_back(start);
        while let Some(ix) = q.pop_front() {
            for e in self.graph.edges(ix) {
                let w = e.weight();
                if w.valves.is_empty() {
                    // valveless pipe: internal to the segment — traverse it
                    isolated_pipes.insert(w.pipe_id.clone());
                    let nb = if e.source() == ix { e.target() } else { e.source() };
                    if in_segment.insert(nb) {
                        q.push_back(nb);
                    }
                } else {
                    // valved pipe: boundary — close its valves, do not cross
                    for v in &w.valves {
                        valves.insert(v.clone());
                    }
                }
            }
        }
        let mut isolated_nodes: Vec<String> =
            in_segment.iter().map(|&i| self.graph[i].node_id.clone()).collect();
        let mut valves_to_close: Vec<String> = valves.into_iter().collect();
        let mut isolated_pipes: Vec<String> = isolated_pipes.into_iter().collect();
        isolated_nodes.sort();
        valves_to_close.sort();
        isolated_pipes.sort();
        IsolationZone { valves_to_close, isolated_nodes, isolated_pipes }
    }
```

- [ ] **Step 4: Re-export** — in `lib.rs` add `IsolationZone` to the `pub use graph::{...}` list (keep all existing exports).

- [ ] **Step 5: Run tests + clippy + fmt**

Run: `cargo test -p topology-core` (all pass — 4 new + all prior), `cargo clippy -p topology-core --all-targets -- -D warnings` (clean), `cargo fmt -p topology-core` then `cargo fmt --check`. Report.

- [ ] **Step 6: Commit**

```bash
git add crates/topology-core
git commit -m "feat(topology): TOP-3 compute_isolation_zone (valve-segment BFS) (TOP-3)"
```

---

## Task 2: Add the `ComputeIsolationZone` RPC to the proto

**Files:** Modify `proto/topology.proto`

- [ ] **Step 1: Add the RPC + messages**

In `proto/topology.proto`, add a method to the `TopologyService` service (after `FindNearestValves`):

```proto
  rpc ComputeIsolationZone(ComputeIsolationZoneRequest) returns (ComputeIsolationZoneResponse);
```

and add these messages (after the `FindNearestValves*` messages):

```proto
message ComputeIsolationZoneRequest {
  string tenant_id = 1;
  string start_node_id = 2;
}
message ComputeIsolationZoneResponse {
  repeated string valves_to_close = 1;
  repeated string isolated_nodes = 2;
  repeated string isolated_pipes = 3;
  uint64 graph_version = 4;
}
```

- [ ] **Step 2: Build to regenerate (will fail to compile until Task 3)**

Run: `cargo build -p topology-service 2>&1 | head -30`
Expected: the proto recompiles and the generated `TopologyService` trait now has a fourth required method `compute_isolation_zone`, so `grpc.rs`'s `impl TopologyService for TopologyGrpc` will FAIL with "not all trait items implemented" (E0046). This confirms the proto change took effect. (The proto.rs smoke test alone won't catch it; the missing-method error is expected and fixed in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add proto/topology.proto
git commit -m "feat(topology): TOP-3 add ComputeIsolationZone RPC to proto contract (TOP-3)"
```

(Committing a momentarily-non-compiling proto-only change is acceptable here because Task 3 immediately follows and the two are one logical unit; if you prefer, combine Tasks 2 and 3 into a single commit — implement the handler before committing. Either is fine.)

---

## Task 3: Implement the gRPC handler + integration test

**Files:** Modify `crates/topology-service/src/grpc.rs`

- [ ] **Step 1: Write the failing integration test** — add to the `#[cfg(test)] mod tests` in `grpc.rs` (the `seeded_state`/`start_server`/`client` helpers already exist there from TOP-2; reuse them). Add a richer seed inline:

```rust
    #[tokio::test]
    async fn compute_isolation_zone_returns_boundary_valves() {
        use crate::proto::ComputeIsolationZoneRequest;
        let mut tg = TenantGraphs::default();
        let mut n = 0u32;
        let mut ev = |kind| { n += 1; GraphEvent { event_id: format!("e{n}"), tenant_id: "t1".into(), kind } };
        for id in ["n1", "n2", "n3"] {
            tg.apply(&ev(GraphEventKind::NodeRegistered { node_id: id.into(), node_type: "J".into(), lat: 0.0, lng: 0.0 }));
        }
        tg.apply(&ev(GraphEventKind::PipeRegistered { pipe_id: "p1".into(), from_node_id: "n1".into(), to_node_id: "n2".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() }));
        tg.apply(&ev(GraphEventKind::PipeRegistered { pipe_id: "p2".into(), from_node_id: "n2".into(), to_node_id: "n3".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() }));
        tg.apply(&ev(GraphEventKind::DeviceInstalled { device_id: "v1".into(), device_type: "Valve".into(), host_pipe_id: Some("p2".into()), host_node_id: None, lat: 0.0, lng: 0.0 }));

        let addr = start_server(SharedState::new(tg)).await;
        let mut c = client(addr).await;
        let resp = c.compute_isolation_zone(ComputeIsolationZoneRequest { tenant_id: "t1".into(), start_node_id: "n1".into() }).await.unwrap().into_inner();
        assert_eq!(resp.valves_to_close, vec!["v1"]);
        assert_eq!(resp.isolated_nodes, vec!["n1", "n2"]);
        assert_eq!(resp.isolated_pipes, vec!["p1"]);
        assert!(resp.graph_version >= 6);
    }

    #[tokio::test]
    async fn compute_isolation_zone_unknown_tenant_empty() {
        use crate::proto::ComputeIsolationZoneRequest;
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c.compute_isolation_zone(ComputeIsolationZoneRequest { tenant_id: "ghost".into(), start_node_id: "n1".into() }).await.unwrap().into_inner();
        assert!(resp.valves_to_close.is_empty() && resp.isolated_nodes.is_empty());
    }
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-service grpc::tests::compute_isolation_zone 2>&1 | head -20`
Expected: FAIL — the trait isn't fully implemented (E0046: missing `compute_isolation_zone`) and/or the new test refers to a method that doesn't exist yet.

- [ ] **Step 3: Implement the handler** — in `grpc.rs`, add the import for the new message types to the existing `use crate::proto::{...}` block (`ComputeIsolationZoneRequest, ComputeIsolationZoneResponse`), and add this method inside `impl TopologyService for TopologyGrpc`:

```rust
    async fn compute_isolation_zone(
        &self,
        request: Request<ComputeIsolationZoneRequest>,
    ) -> Result<Response<ComputeIsolationZoneResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let (valves_to_close, isolated_nodes, isolated_pipes) = match graphs.tenant(&req.tenant_id) {
            Some(g) => {
                let z = g.compute_isolation_zone(&req.start_node_id);
                (z.valves_to_close, z.isolated_nodes, z.isolated_pipes)
            }
            None => (Vec::new(), Vec::new(), Vec::new()),
        };
        Ok(Response::new(ComputeIsolationZoneResponse {
            valves_to_close,
            isolated_nodes,
            isolated_pipes,
            graph_version: graphs.version(),
        }))
    }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p topology-service grpc::tests` → all pass (the 2 new + the 4 from TOP-2). Then `cargo test -p topology-service` (whole crate; `consumer_rabbitmq` stays ignored). Report.

- [ ] **Step 5: Commit**

```bash
git add crates/topology-service
git commit -m "feat(topology): TOP-3 ComputeIsolationZone gRPC handler + integration test (TOP-3)"
```

---

## Task 4: Perf test + full workspace gate

**Files:** Modify `crates/topology-core/src/graph.rs`

- [ ] **Step 1: Add an ignored perf test** — append to the `tests` module in `graph.rs`:

```rust
    #[test]
    #[ignore = "perf: run with --ignored"]
    fn isolation_zone_perf_100k_edges_under_budget() {
        // A 100k-edge valveless chain with a valve at the far end → the segment
        // from n0 spans the whole chain (worst case BFS). Asserts O(V+E) stays
        // well under the 200ms budget for a single run.
        let mut g = NetworkGraph::default();
        let n = 100_000usize;
        for i in 0..n {
            g.add_pipe(&format!("p{i}"), &format!("nd{i}"), &format!("nd{}", i + 1));
        }
        g.set_device("vend", "Valve", Some(&format!("p{}", n - 1)), None);

        let start = std::time::Instant::now();
        let z = g.compute_isolation_zone("nd0");
        let elapsed = start.elapsed();

        assert_eq!(z.valves_to_close, vec!["vend"]);
        assert!(elapsed.as_millis() < 200, "isolation took {elapsed:?}, budget 200ms");
    }
```

- [ ] **Step 2: Run the perf test explicitly**

Run: `cargo test -p topology-core --release isolation_zone_perf -- --ignored --nocapture`
Expected: PASS (release build; comfortably under 200ms). Report the actual elapsed if printed. If it exceeds 200ms in debug, note that the budget is asserted on `--release` (which is how it's run here).

- [ ] **Step 3: Full workspace gate**

Run (service dir): `cargo test` (all pass, perf test ignored by default), `cargo clippy --all-targets -- -D warnings` (clean), `cargo build --release` (succeeds), `cargo fmt --all -- --check` (clean — run `cargo fmt --all` and include if needed). Report all four.

- [ ] **Step 4: Commit**

```bash
git add crates/topology-core
git commit -m "test(topology): TOP-3 isolation-zone 100k-edge perf budget test (TOP-3)"
```

---

## Task 5: End-to-end verification + docs

**Files:** Modify `docs/stories/backlog.md`, `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`, `docs/conventions/template-mapping.md`

- [ ] **Step 1: e2e grpcurl against the running binary**

Reuse the TOP-2 e2e harness pattern (throwaway RabbitMQ on a free port — host 5432/5672 are taken by `platform-core`). Boot a broker, run the release binary with `TOPOLOGY_GRPC_BIND=127.0.0.1:50071`, publish events that create a valved boundary (a node + two pipes + a valve on the second pipe) — extend the ignored `consumer_rabbitmq` publish test or publish inline — then:

```bash
grpcurl -plaintext -import-path src/services/water-network-topology-rs/proto -proto topology.proto \
  -d '{"tenant_id":"<t>","start_node_id":"<n>"}' \
  127.0.0.1:50071 waternetwork.topology.v1.TopologyService/ComputeIsolationZone
```

Assert the response contains the expected `valvesToClose`/`isolatedNodes`/`isolatedPipes`/`graphVersion`. Capture the actual JSON as verification evidence (superpowers:verification-before-completion — do not claim success without it). If seeding a valved boundary over the wire is awkward, the Task 3 in-process integration tests are the authoritative behaviour evidence; at minimum grpcurl `ComputeIsolationZone` against a single consumed node and confirm a well-formed (empty-valve) response + `graphVersion`. Tear down the broker + binary afterward.

- [ ] **Step 2: Full Rust sweep** — `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check` (service dir). All green.

- [ ] **Step 3: Update docs**

- `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`: in §8.3, mark the TOP-3 item `✓ SHIPPED` with a one-line summary (valve-segment isolation, node-based, perf-budgeted). (TOP-3 has no dedicated §3.3 table row — INC-2 "Isolation analysis qua gRPC" consumes it; optionally note in the INC-2 row that the topology RPC is ready.)
- `docs/stories/backlog.md`: add a `## Follow-up sau TOP-3` section: pipe/device assetRef resolution for the isolation start; global min-cut optimisation (vs valve-segment); valve open/closed state (`valve.state.changed`, Phase 5) refining which valves are "closeable"; boundary valved pipes excluded from `isolated_pipes` (partial-isolation semantics); INC-2 will be the first real consumer (+ the deferred .NET contract test).
- `docs/conventions/template-mapping.md`: extend the §9 gRPC note to mention the topology service now exposes 4 RPCs incl. `ComputeIsolationZone` (valve-segment isolation).

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(topology): TOP-3 mark done + follow-ups + isolation note (TOP-3)"
```

- [ ] **Step 5: Finish the branch** — use superpowers:finishing-a-development-branch to merge `feature/phase3-top3-isolation-zone` into `main` after a final review.

---

## Self-review

**Spec coverage (roadmap §8.2/§8.3 TOP-3):**
- `ComputeIsolationZone(assetRef) → {valvesToClose, isolatedNodes, isolatedPipes, graphVersion}` → Task 1 (core) + Task 2 (proto) + Task 3 (gRPC) ✓
- BFS from incident, stop at closeable (valved) edges, minimal valve set → Task 1 `compute_isolation_zone` (valve-segment) ✓
- benchmark on 100k-edge graph, budget < 200ms → Task 4 perf test ✓
- decision record → Task 0 (0020) ✓

**Deferred (recorded in 0020 + backlog):** pipe/device assetRef resolution, global min-cut optimisation, valve open/closed state, partial-isolation of boundary pipes.

**Type consistency:** `IsolationZone { valves_to_close, isolated_nodes, isolated_pipes }` (Task 1) re-exported (lib.rs) and consumed by `grpc.rs` (Task 3) mapping to proto `ComputeIsolationZoneResponse { valves_to_close, isolated_nodes, isolated_pipes, graph_version }` (Task 2). `compute_isolation_zone(&str)->IsolationZone` signature matches the gRPC call. Proto method name `compute_isolation_zone` (snake_case generated) matches the trait method added in Task 3. Reuses existing `seeded_state/start_server/client` test helpers + `SharedState`/`TenantGraphs::{tenant,version}`.

**Verification points:** Task 2 deliberately leaves the crate non-compiling until Task 3 (trait gains a required method) — flagged inline; the perf budget is asserted on `--release` (Task 4).
