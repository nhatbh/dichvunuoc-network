# TOP-2 — topology-rs ValidateTopology + TraceNetwork + FindNearestValves over gRPC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory — failing test first, watch it fail, then implement.

**Goal:** Expose the topology-rs in-memory graph (built in TOP-1) over gRPC with three read RPCs — `ValidateTopology`, `TraceNetwork`, `FindNearestValves` — each tenant-scoped and carrying a `graph_version` freshness token, served alongside the existing RabbitMQ consumer and HTTP `/health`.

**Architecture:** A `.proto` (package `waternetwork.topology.v1`) is the contract. `topology-core` gains pure, unit-tested graph-analysis methods (`validate`, `trace`, `nearest_valves`) and node *provenance* (registered vs pipe-created placeholder) so `MissingEndpoint` is detectable. `topology-service` adds a tonic gRPC server (`src/grpc.rs`) that maps proto ↔ core analysis over the shared `Arc<RwLock<TenantGraphs>>`, plus the standard gRPC health service, wired into `main` next to the consumer and HTTP health. The proto is compiled at build time with a vendored `protoc` (no system dependency). Tenant is an explicit request field; ComputeIsolationZone and flow-direction trace are explicitly OUT (TOP-3 / later).

**Tech Stack:** Rust · tonic 0.12 + prost 0.13 (gRPC) · tonic-build + protoc-bin-vendored (build) · tonic-health 0.12 · petgraph (BFS/components) · tokio · existing TOP-1 crates.

---

## Design decisions (locked for this plan — review before executing)

These extend roadmap §8.2/§8.3 where it left choices open. They will be recorded in decision **0019**.

1. **gRPC stack:** tonic + prost, package `waternetwork.topology.v1`, proto at `src/services/water-network-topology-rs/proto/topology.proto`. Proto compiled by `tonic-build` in `build.rs`; `protoc` supplied by the `protoc-bin-vendored` crate (set `PROTOC` env in `build.rs`) so neither local dev nor the Docker build needs a system `protoc`.
2. **Tenant = explicit request field** (`tenant_id` on every request message), not gRPC metadata. Simple, explicit, trivially testable. Service-to-service auth (system identity / mTLS, roadmap §15.2) is a separate, deferred concern.
3. **All RPCs are node-id-based.** `TraceNetwork`/`FindNearestValves` take a `start_node_id`. Resolving a pipe/device assetRef to its node(s) is a deferred refinement (incident assets are often on pipes — note as follow-up; INC-2 can pass the nearest node, or TOP-x adds resolution).
4. **`TraceNetwork` is depth-limited undirected BFS.** The graph is undirected (TOP-1); flow direction (upstream/downstream) is not modelled yet, so no `direction` field — added when pipe directionality/hydraulics land.
5. **`graph_version` = the global applied-event counter** (`TenantGraphs::version()`), a monotonic freshness token. A per-tenant version is a refinement (follow-up).
6. **`ValidateTopology` issue types:** `ORPHAN_NODE` (registered node, degree 0), `MISSING_ENDPOINT` (a node that exists only because a pipe referenced it — never `NodeRegistered`/`NodeRelocated`), `DISCONNECTED_COMPONENT` (graph splits into >1 connected component — report every component except the largest). Requires tracking node **provenance** (a `registered` flag on the vertex).
7. **Contract test:** the `.proto` is the committed contract. TOP-2 validates the **server** with a Rust in-process server+client integration test. The **.NET client** contract test is **deferred to INC-2** (incident-be, the first gRPC caller, does not exist yet) — recorded in 0019 and the backlog.
8. **Out of scope (later slices):** `ComputeIsolationZone` (TOP-3), `BuildNetworkSnapshot` (Phase 6 hydraulic), flow-direction trace, pipe/device-ref resolution, per-tenant version, real s2s auth.

---

## Verified current state (TOP-1, on `main`)

- `topology-core` (`src/services/water-network-topology-rs/crates/topology-core/`): `lib.rs` re-exports `apply::TenantGraphs`, `events::{GraphEvent,GraphEventKind,ParseError}`, `graph::{CanonicalGraph,DevicePlacement,NetworkGraph,NodeVertex,PipeEdge}`, `snapshot::{from_bytes,to_bytes}`.
  - `NetworkGraph` fields (private): `graph: StableUnGraph<NodeVertex, PipeEdge>`, `node_ix: HashMap<String,NodeIndex>` (`#[serde(skip)]`), `pipe_ix: HashMap<String,EdgeIndex>` (`#[serde(skip)]`), `devices: HashMap<String,DevicePlacement>`. Methods: `reindex`, `upsert_node(&str)->NodeIndex`, `add_pipe`, `remove_pipe`, `remove_node`, `set_device`, `remove_device`, `node_count`, `pipe_count`, `has_pipe`, `has_node`, `pipe_has_valve`, `canonical`.
  - `NodeVertex { pub node_id: String }` (Debug, Default, Clone, Serialize, Deserialize, PartialEq).
  - `PipeEdge { pub pipe_id: String, pub valves: HashSet<String> }`.
  - `TenantGraphs`: `apply(&GraphEvent)->bool`, `tenant(&str)->Option<&NetworkGraph>`, `tenant_count`, `version()->u64`, `already_processed`, `canonical`, `reindex_all`.
  - `apply.rs`: `NodeRegistered`/`NodeRelocated` → `g.upsert_node(node_id)`; `PipeRegistered` → `g.add_pipe(...)`.
- `topology-service` (`crates/topology-service/`): `main.rs` (consumer reconnect loop + spawned snapshot loop + spawned axum health on `cfg.http_bind`), `config.rs` (`Config::from_env()` fields: `amqp_url, queue_name, exchange_name, gis_base_url, gis_token, snapshot_path, http_bind, export_page_size`), `consumer.rs`, `state.rs` (`SharedState { graphs: Arc<RwLock<TenantGraphs>> }`, `SharedState::new`), `warmup.rs`, `health.rs`, `gis_client.rs`.
- Workspace `Cargo.toml` `[workspace.dependencies]` already has serde, serde_json, petgraph (feature serde-1), thiserror, anyhow, tokio, tracing, tracing-subscriber, lapin, futures-util, reqwest, axum, proptest, wiremock.
- petgraph note (from TOP-1): the `edges()` iterator's `EdgeReference` exposes `.weight()` without importing `EdgeRef`. `.source()`/`.target()` may require `use petgraph::visit::EdgeRef;` — add it if the compiler asks.

---

## File structure

```
src/services/water-network-topology-rs/
├── Cargo.toml                       # Modify: add tonic/prost/tonic-build/tonic-health/protoc-bin-vendored to [workspace.dependencies]
├── proto/
│   └── topology.proto               # Create: the gRPC contract (package waternetwork.topology.v1)
├── crates/topology-core/src/
│   ├── graph.rs                     # Modify: add `registered` provenance + analysis (validate/trace/nearest_valves) + result types
│   ├── apply.rs                     # Modify: NodeRegistered/NodeRelocated → register_node
│   └── lib.rs                       # Modify: re-export new analysis types
└── crates/topology-service/
    ├── Cargo.toml                   # Modify: add tonic, prost, tonic-health deps + [build-dependencies] tonic-build, protoc-bin-vendored
    ├── build.rs                     # Create: compile proto with vendored protoc
    └── src/
        ├── proto.rs                 # Create: tonic::include_proto! module
        ├── grpc.rs                  # Create: TopologyService impl mapping proto ↔ core
        ├── config.rs               # Modify: add grpc_bind
        └── main.rs                  # Modify: spawn tonic server (+ gRPC health) alongside consumer/health
Dockerfile                           # Modify: EXPOSE 50051 (protoc vendored → no apt change)
docker-compose.yml                   # Modify: map gRPC port, add GRPC_BIND env
docs/decisions/0019-topology-grpc-api.md   # Create
docs/stories/backlog.md, .../2026-06-13-master-implementation-roadmap.md, docs/conventions/template-mapping.md  # Modify
```

---

## Task 0: Decision record 0019

**Files:** Create `docs/decisions/0019-topology-grpc-api.md`

- [ ] **Step 1: Write the ADR**

Mirror the format of `docs/decisions/0018-topology-warmup-and-consumption.md` (`# 0019 …`, Date 2026-06-17, Status Accepted, Context, Decision, Consequences, Follow-ups). Capture the 8 "Design decisions" above verbatim in the Decision section, especially: tonic + package `waternetwork.topology.v1`; tenant as explicit request field; node-id-based RPCs; undirected depth-limited trace (no direction field); `graph_version` = global counter; the three issue types + node provenance for MissingEndpoint; `.proto` is the contract with the .NET client contract test deferred to INC-2; ComputeIsolationZone/BuildNetworkSnapshot/flow-direction/per-tenant-version out of scope.

- [ ] **Step 2: Commit**

```bash
git checkout -b feature/phase3-top2-topology-grpc
git add docs/decisions/0019-topology-grpc-api.md
git commit -m "docs(topology): TOP-2 decision 0019 gRPC API (tonic, tenant-as-field, node-based) (TOP-2)"
```

---

## Task 1: Node provenance + `ValidateTopology` analysis (`topology-core`)

**Files:** Modify `crates/topology-core/src/graph.rs`, `crates/topology-core/src/apply.rs`, `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write failing tests** — append to the `tests` module in `graph.rs`:

```rust
    #[test]
    fn validate_flags_orphan_registered_node() {
        let mut g = NetworkGraph::default();
        g.register_node("n_lonely"); // registered, no edges
        g.add_pipe("p1", "n1", "n2"); // n1,n2 connected
        g.register_node("n1");
        g.register_node("n2");
        let issues = g.validate();
        assert!(issues.iter().any(|i| i.kind == IssueKind::OrphanNode && i.asset_ids == vec!["n_lonely".to_string()]));
    }

    #[test]
    fn validate_flags_missing_endpoint_placeholder() {
        let mut g = NetworkGraph::default();
        g.register_node("n1");
        g.add_pipe("p1", "n1", "n_ghost"); // n_ghost never registered → placeholder
        let issues = g.validate();
        assert!(issues.iter().any(|i| i.kind == IssueKind::MissingEndpoint && i.asset_ids == vec!["n_ghost".to_string()]));
        // a registered endpoint is NOT a missing endpoint
        assert!(!issues.iter().any(|i| i.kind == IssueKind::MissingEndpoint && i.asset_ids.contains(&"n1".to_string())));
    }

    #[test]
    fn validate_flags_disconnected_components_except_largest() {
        let mut g = NetworkGraph::default();
        // component A (size 3): a1-a2-a3
        g.add_pipe("pa1", "a1", "a2"); g.add_pipe("pa2", "a2", "a3");
        for n in ["a1","a2","a3"] { g.register_node(n); }
        // component B (size 2): b1-b2
        g.add_pipe("pb1", "b1", "b2");
        for n in ["b1","b2"] { g.register_node(n); }
        let issues = g.validate();
        let disc: Vec<_> = issues.iter().filter(|i| i.kind == IssueKind::DisconnectedComponent).collect();
        assert_eq!(disc.len(), 1, "only the smaller component is reported");
        assert_eq!(disc[0].asset_ids, vec!["b1".to_string(), "b2".to_string()]);
    }

    #[test]
    fn validate_clean_graph_has_no_issues() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.register_node("n1"); g.register_node("n2");
        assert!(g.validate().is_empty());
    }
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core graph::tests::validate`
Expected: FAIL — `register_node`, `validate`, `IssueKind` undefined.

- [ ] **Step 3: Add provenance to `NodeVertex`**

In `graph.rs`, change `NodeVertex` to carry a `registered` flag (default false, `#[serde(default)]` for snapshot forward-compat):

```rust
/// Vertex payload. `registered` is true once a NodeRegistered/NodeRelocated
/// event was applied; false means the vertex exists only because a pipe
/// referenced it (a placeholder / missing endpoint).
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeVertex {
    pub node_id: String,
    #[serde(default)]
    pub registered: bool,
}
```

Update the two `NodeVertex { node_id: ... }` literals in `graph.rs` (`upsert_node` and any other) to `NodeVertex { node_id: ..., registered: false }`. Then add a `register_node` method inside `impl NetworkGraph`:

```rust
    /// Mark a node as backed by a real NodeRegistered/NodeRelocated event,
    /// creating the vertex first if a pipe already referenced it.
    pub fn register_node(&mut self, node_id: &str) {
        let ix = self.upsert_node(node_id);
        self.graph[ix].registered = true;
    }
```

- [ ] **Step 4: Add the issue types and `validate()`**

Add near the other public types in `graph.rs`:

```rust
/// A topology problem found by `NetworkGraph::validate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopologyIssue {
    pub kind: IssueKind,
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueKind {
    OrphanNode,
    MissingEndpoint,
    DisconnectedComponent,
}
```

Add `validate` inside `impl NetworkGraph` (uses `petgraph::visit::EdgeRef` for `.source()/.target()` if needed; the BFS uses `self.graph.neighbors(ix)`):

```rust
    /// Structural validation: orphan registered nodes, placeholder (missing)
    /// endpoints, and disconnected components (all but the largest).
    pub fn validate(&self) -> Vec<TopologyIssue> {
        let mut issues = Vec::new();

        // Per-node classification (deterministic by node id).
        let mut node_ids: Vec<&String> = self.node_ix.keys().collect();
        node_ids.sort();
        for nid in &node_ids {
            let ix = self.node_ix[*nid];
            if !self.graph[ix].registered {
                // exists only via a pipe reference → missing real node
                issues.push(TopologyIssue { kind: IssueKind::MissingEndpoint, asset_ids: vec![(*nid).clone()] });
            } else if self.graph.neighbors(ix).next().is_none() {
                issues.push(TopologyIssue { kind: IssueKind::OrphanNode, asset_ids: vec![(*nid).clone()] });
            }
        }

        // Connected components (BFS). Report every component except the largest.
        let mut components = self.connected_components();
        // sort by size desc, then by first id asc, for deterministic "largest"
        components.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.first().cmp(&b.first())));
        for comp in components.into_iter().skip(1) {
            issues.push(TopologyIssue { kind: IssueKind::DisconnectedComponent, asset_ids: comp });
        }

        issues
    }

    /// All connected components as sorted lists of node ids (each list sorted,
    /// the outer order is unspecified — caller sorts).
    fn connected_components(&self) -> Vec<Vec<String>> {
        use std::collections::VecDeque;
        let mut seen: HashSet<NodeIndex> = HashSet::new();
        let mut out: Vec<Vec<String>> = Vec::new();
        let mut starts: Vec<(&String, NodeIndex)> = self.node_ix.iter().map(|(k, &v)| (k, v)).collect();
        starts.sort_by(|a, b| a.0.cmp(b.0)); // deterministic component discovery
        for (_, start) in starts {
            if seen.contains(&start) {
                continue;
            }
            let mut comp: Vec<String> = Vec::new();
            let mut q = VecDeque::new();
            seen.insert(start);
            q.push_back(start);
            while let Some(ix) = q.pop_front() {
                comp.push(self.graph[ix].node_id.clone());
                for nb in self.graph.neighbors(ix) {
                    if seen.insert(nb) {
                        q.push_back(nb);
                    }
                }
            }
            comp.sort();
            out.push(comp);
        }
        out
    }
```

- [ ] **Step 5: Mark registration in `apply.rs`**

In `apply.rs`, change the `NodeRegistered` and `NodeRelocated` arms from `g.upsert_node(node_id)` to `g.register_node(node_id)`:

```rust
            GraphEventKind::NodeRegistered { node_id, .. } => {
                g.register_node(node_id);
            }
            GraphEventKind::NodeRelocated { node_id, .. } => {
                g.register_node(node_id); // geometry-only; ensures the vertex is marked real
            }
```

(Leave `PipeRegistered` calling `add_pipe` — its endpoints stay placeholders until their own NodeRegistered arrives.)

- [ ] **Step 6: Re-export new types** — in `lib.rs` extend the graph re-export:

```rust
pub use graph::{
    CanonicalGraph, DevicePlacement, IssueKind, NetworkGraph, NodeVertex, PipeEdge, TopologyIssue,
};
```

- [ ] **Step 7: Run tests + clippy**

Run: `cargo test -p topology-core` then `cargo clippy -p topology-core --all-targets -- -D warnings`
Expected: all pass (the 4 new validate tests + all prior); clippy clean. If a prior test constructed `NodeVertex { node_id }` without `registered`, fix it to include `registered: false` (or `..Default::default()`).

- [ ] **Step 8: Commit**

```bash
git add crates/topology-core
git commit -m "feat(topology): TOP-2 node provenance + ValidateTopology analysis (orphan/missing-endpoint/disconnected) (TOP-2)"
```

---

## Task 2: `TraceNetwork` + `FindNearestValves` analysis (`topology-core`)

**Files:** Modify `crates/topology-core/src/graph.rs`, `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write failing tests** — append to the `tests` module in `graph.rs`:

```rust
    #[test]
    fn trace_returns_nodes_and_pipes_within_depth() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4"); // n4 is 3 hops from n1
        let (nodes, pipes) = g.trace("n1", 2);
        assert_eq!(nodes, vec!["n1", "n2", "n3"]); // n4 excluded (depth 3)
        assert_eq!(pipes, vec!["p1", "p2"]);
    }

    #[test]
    fn trace_unknown_start_is_empty() {
        let g = NetworkGraph::default();
        assert_eq!(g.trace("nope", 5), (Vec::<String>::new(), Vec::<String>::new()));
    }

    #[test]
    fn nearest_valves_sorted_by_distance() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4");
        g.set_device("v_far", "Valve", Some("p3"), None);   // 2 hops from n1 (via n3)
        g.set_device("v_near", "Valve", Some("p1"), None);  // 0 hops from n1
        let valves = g.nearest_valves("n1", 5);
        let ids: Vec<&str> = valves.iter().map(|v| v.device_id.as_str()).collect();
        assert_eq!(ids, vec!["v_near", "v_far"]);
        assert_eq!(valves[0].distance, 0);
        assert_eq!(valves[0].pipe_id, "p1");
        assert!(valves[1].distance <= 2);
    }

    #[test]
    fn nearest_valves_respects_k() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.set_device("v1", "Valve", Some("p1"), None);
        g.set_device("v2", "Valve", Some("p2"), None);
        assert_eq!(g.nearest_valves("n1", 1).len(), 1);
    }
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core graph::tests::trace graph::tests::nearest`
Expected: FAIL — `trace`, `nearest_valves`, `NearestValve` undefined.

- [ ] **Step 3: Add the result type and methods**

Add the public type near the others in `graph.rs`:

```rust
/// A valve reachable from a start node, with hop distance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NearestValve {
    pub device_id: String,
    pub pipe_id: String,
    pub distance: u32,
}
```

Add inside `impl NetworkGraph` (add `use petgraph::visit::EdgeRef;` at the top of `graph.rs` if `.source()/.target()` don't resolve):

```rust
    /// Depth-limited undirected BFS from `start_node_id`. Returns the reached
    /// node ids and the traversed pipe ids (both sorted). Empty if start absent.
    pub fn trace(&self, start_node_id: &str, max_depth: u32) -> (Vec<String>, Vec<String>) {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return (Vec::new(), Vec::new());
        };
        let mut visited: HashSet<NodeIndex> = HashSet::new();
        let mut pipes: HashSet<String> = HashSet::new();
        let mut q: VecDeque<(NodeIndex, u32)> = VecDeque::new();
        visited.insert(start);
        q.push_back((start, 0));
        while let Some((ix, depth)) = q.pop_front() {
            if depth >= max_depth {
                continue;
            }
            for e in self.graph.edges(ix) {
                pipes.insert(e.weight().pipe_id.clone());
                let nb = if e.source() == ix { e.target() } else { e.source() };
                if visited.insert(nb) {
                    q.push_back((nb, depth + 1));
                }
            }
        }
        let mut node_ids: Vec<String> = visited.iter().map(|&i| self.graph[i].node_id.clone()).collect();
        let mut pipe_ids: Vec<String> = pipes.into_iter().collect();
        node_ids.sort();
        pipe_ids.sort();
        (node_ids, pipe_ids)
    }

    /// The `k` nearest valves (by hop distance) reachable from `start_node_id`,
    /// sorted by (distance, pipe_id, device_id). Empty if start absent.
    pub fn nearest_valves(&self, start_node_id: &str, k: usize) -> Vec<NearestValve> {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return Vec::new();
        };
        let mut dist: HashMap<NodeIndex, u32> = HashMap::new();
        let mut q: VecDeque<NodeIndex> = VecDeque::new();
        let mut found: Vec<NearestValve> = Vec::new();
        let mut seen_pipes: HashSet<String> = HashSet::new();
        dist.insert(start, 0);
        q.push_back(start);
        while let Some(ix) = q.pop_front() {
            let d = dist[&ix];
            for e in self.graph.edges(ix) {
                let w = e.weight();
                if !w.valves.is_empty() && seen_pipes.insert(w.pipe_id.clone()) {
                    for dev in &w.valves {
                        found.push(NearestValve { device_id: dev.clone(), pipe_id: w.pipe_id.clone(), distance: d });
                    }
                }
                let nb = if e.source() == ix { e.target() } else { e.source() };
                if let std::collections::hash_map::Entry::Vacant(slot) = dist.entry(nb) {
                    slot.insert(d + 1);
                    q.push_back(nb);
                }
            }
        }
        found.sort_by(|a, b| {
            a.distance.cmp(&b.distance).then(a.pipe_id.cmp(&b.pipe_id)).then(a.device_id.cmp(&b.device_id))
        });
        found.truncate(k);
        found
    }
```

- [ ] **Step 4: Re-export** — extend the `lib.rs` graph re-export to add `NearestValve`:

```rust
pub use graph::{
    CanonicalGraph, DevicePlacement, IssueKind, NearestValve, NetworkGraph, NodeVertex, PipeEdge,
    TopologyIssue,
};
```

- [ ] **Step 5: Run tests + clippy**

Run: `cargo test -p topology-core` then `cargo clippy -p topology-core --all-targets -- -D warnings`
Expected: all pass; clippy clean.

- [ ] **Step 6: Commit**

```bash
git add crates/topology-core
git commit -m "feat(topology): TOP-2 TraceNetwork + FindNearestValves graph analysis (TOP-2)"
```

---

## Task 3: Proto contract + build pipeline

**Files:** Modify workspace `Cargo.toml` and `crates/topology-service/Cargo.toml`; Create `proto/topology.proto`, `crates/topology-service/build.rs`, `crates/topology-service/src/proto.rs`

- [ ] **Step 1: Add dependencies**

In the workspace `Cargo.toml` `[workspace.dependencies]`, add:

```toml
tonic = "0.12"
prost = "0.13"
tonic-health = "0.12"
tonic-build = "0.12"
protoc-bin-vendored = "0.10"
```

In `crates/topology-service/Cargo.toml`, add to `[dependencies]`:

```toml
tonic.workspace = true
prost.workspace = true
tonic-health.workspace = true
```

and add a new section:

```toml
[build-dependencies]
tonic-build.workspace = true
protoc-bin-vendored.workspace = true
```

- [ ] **Step 2: Write the proto contract**

Create `proto/topology.proto`:

```proto
syntax = "proto3";

package waternetwork.topology.v1;

// Read-only topology queries over the per-tenant in-memory network graph.
// Tenant is an explicit field on every request (no ambient metadata).
service TopologyService {
  rpc ValidateTopology(ValidateTopologyRequest) returns (ValidateTopologyResponse);
  rpc TraceNetwork(TraceNetworkRequest) returns (TraceNetworkResponse);
  rpc FindNearestValves(FindNearestValvesRequest) returns (FindNearestValvesResponse);
}

enum IssueType {
  ISSUE_TYPE_UNSPECIFIED = 0;
  ORPHAN_NODE = 1;
  MISSING_ENDPOINT = 2;
  DISCONNECTED_COMPONENT = 3;
}

message TopologyIssue {
  IssueType type = 1;
  repeated string asset_ids = 2;
}

message ValidateTopologyRequest { string tenant_id = 1; }
message ValidateTopologyResponse {
  repeated TopologyIssue issues = 1;
  uint64 graph_version = 2;
}

message TraceNetworkRequest {
  string tenant_id = 1;
  string start_node_id = 2;
  uint32 max_depth = 3;
}
message TraceNetworkResponse {
  repeated string node_ids = 1;
  repeated string pipe_ids = 2;
  uint64 graph_version = 3;
}

message FindNearestValvesRequest {
  string tenant_id = 1;
  string start_node_id = 2;
  uint32 k = 3;
}
message NearestValve {
  string device_id = 1;
  string pipe_id = 2;
  uint32 distance = 3;
}
message FindNearestValvesResponse {
  repeated NearestValve valves = 1;
  uint64 graph_version = 2;
}
```

- [ ] **Step 3: Write `build.rs`**

Create `crates/topology-service/build.rs` (self-contained protoc via the vendored binary; the proto path is relative to the crate dir, so go up two levels to the workspace `proto/`):

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Make the build self-contained: no system `protoc` required.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);

    let proto = "../../proto/topology.proto";
    let include = "../../proto";
    println!("cargo:rerun-if-changed={proto}");
    tonic_build::configure()
        .build_server(true)
        .build_client(true) // client is used by the integration test
        .compile_protos(&[proto], &[include])?;
    Ok(())
}
```

(Note: `tonic-build` 0.12 uses `compile_protos`; if the installed version exposes `compile` instead, use that — report the adjustment. The proto path is relative to `crates/topology-service/`.)

- [ ] **Step 4: Create the generated-code module + a smoke test**

Create `crates/topology-service/src/proto.rs`:

```rust
//! gRPC types generated from `proto/topology.proto` at build time.
#![allow(clippy::all)]
tonic::include_proto!("waternetwork.topology.v1");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_types_are_constructible() {
        let req = ValidateTopologyRequest { tenant_id: "t1".into() };
        assert_eq!(req.tenant_id, "t1");
        // enum + nested message exist
        let issue = TopologyIssue { r#type: IssueType::OrphanNode as i32, asset_ids: vec!["n1".into()] };
        assert_eq!(issue.asset_ids, vec!["n1".to_string()]);
    }
}
```

Add `mod proto;` to `main.rs` (anywhere among the `mod` lines).

- [ ] **Step 5: Build + run the smoke test**

Run: `cargo test -p topology-service proto::tests`
Expected: PASS — the proto compiles (vendored protoc), generated `ValidateTopologyRequest`/`TopologyIssue`/`IssueType` are usable. If the build fails because `protoc` couldn't be located, verify `protoc-bin-vendored` resolved; report the exact error.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml proto crates/topology-service
git commit -m "feat(topology): TOP-2 gRPC proto contract + tonic-build pipeline (vendored protoc) (TOP-2)"
```

---

## Task 4: gRPC service implementation + integration test

**Files:** Create `crates/topology-service/src/grpc.rs`; Modify `crates/topology-service/src/main.rs` (add `mod grpc;`)

- [ ] **Step 1: Write the failing integration test** — at the bottom of `grpc.rs` (server + client over an ephemeral TCP port, against a seeded graph):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::topology_service_client::TopologyServiceClient;
    use crate::proto::topology_service_server::TopologyServiceServer;
    use crate::proto::{
        FindNearestValvesRequest, IssueType, TraceNetworkRequest, ValidateTopologyRequest,
    };
    use crate::state::SharedState;
    use topology_core::{GraphEvent, GraphEventKind, TenantGraphs};

    fn seeded_state() -> SharedState {
        let mut tg = TenantGraphs::default();
        let mut n = 0u32;
        let mut ev = |kind| {
            n += 1;
            GraphEvent { event_id: format!("e{n}"), tenant_id: "t1".into(), kind }
        };
        tg.apply(&ev(GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 }));
        tg.apply(&ev(GraphEventKind::NodeRegistered { node_id: "n2".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 }));
        tg.apply(&ev(GraphEventKind::PipeRegistered { pipe_id: "p1".into(), from_node_id: "n1".into(), to_node_id: "n2".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() }));
        tg.apply(&ev(GraphEventKind::DeviceInstalled { device_id: "v1".into(), device_type: "Valve".into(), host_pipe_id: Some("p1".into()), host_node_id: None, lat: 0.0, lng: 0.0 }));
        SharedState::new(tg)
    }

    async fn start_server(state: SharedState) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = TopologyServiceServer::new(TopologyGrpc::new(state));
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        addr
    }

    async fn client(addr: std::net::SocketAddr) -> TopologyServiceClient<tonic::transport::Channel> {
        // small retry: server task may not be listening on the first connect
        for _ in 0..20 {
            if let Ok(c) = TopologyServiceClient::connect(format!("http://{addr}")).await {
                return c;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        panic!("could not connect to test gRPC server");
    }

    #[tokio::test]
    async fn validate_reports_no_issues_for_clean_graph() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c.validate_topology(ValidateTopologyRequest { tenant_id: "t1".into() }).await.unwrap().into_inner();
        assert!(resp.issues.is_empty());
        assert!(resp.graph_version >= 4);
    }

    #[tokio::test]
    async fn validate_flags_missing_endpoint() {
        let mut tg = TenantGraphs::default();
        tg.apply(&GraphEvent { event_id: "e1".into(), tenant_id: "t1".into(),
            kind: GraphEventKind::PipeRegistered { pipe_id: "p1".into(), from_node_id: "n1".into(), to_node_id: "ghost".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() } });
        let addr = start_server(SharedState::new(tg)).await;
        let mut c = client(addr).await;
        let resp = c.validate_topology(ValidateTopologyRequest { tenant_id: "t1".into() }).await.unwrap().into_inner();
        assert!(resp.issues.iter().any(|i| i.r#type == IssueType::MissingEndpoint as i32 && i.asset_ids == vec!["ghost".to_string()]));
    }

    #[tokio::test]
    async fn trace_and_nearest_valves_work() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;

        let trace = c.trace_network(TraceNetworkRequest { tenant_id: "t1".into(), start_node_id: "n1".into(), max_depth: 5 }).await.unwrap().into_inner();
        assert_eq!(trace.node_ids, vec!["n1", "n2"]);
        assert_eq!(trace.pipe_ids, vec!["p1"]);

        let valves = c.find_nearest_valves(FindNearestValvesRequest { tenant_id: "t1".into(), start_node_id: "n1".into(), k: 5 }).await.unwrap().into_inner();
        assert_eq!(valves.valves.len(), 1);
        assert_eq!(valves.valves[0].device_id, "v1");
        assert_eq!(valves.valves[0].pipe_id, "p1");
    }

    #[tokio::test]
    async fn unknown_tenant_returns_empty_not_error() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c.validate_topology(ValidateTopologyRequest { tenant_id: "ghost-tenant".into() }).await.unwrap().into_inner();
        assert!(resp.issues.is_empty());
    }
}
```

This test needs `tokio-stream` (for `TcpListenerStream`). Add `tokio-stream = "0.1"` to the workspace deps and as a **dev-dependency** of `topology-service` (`tokio-stream = { workspace = true }`). Add `tokio-stream = "0.1"` under `[workspace.dependencies]` in Task 3's dependency step if doing them together, or here.

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-service grpc::tests`
Expected: FAIL — `TopologyGrpc` undefined.

- [ ] **Step 3: Implement the gRPC service**

Create `crates/topology-service/src/grpc.rs` (prepend, above the tests module):

```rust
use tonic::{Request, Response, Status};

use crate::proto::topology_service_server::TopologyService;
use crate::proto::{
    FindNearestValvesRequest, FindNearestValvesResponse, IssueType, NearestValve, TopologyIssue,
    TraceNetworkRequest, TraceNetworkResponse, ValidateTopologyRequest, ValidateTopologyResponse,
};
use crate::state::SharedState;
use topology_core::IssueKind;

/// gRPC adapter over the shared per-tenant graph state. Read-only: every method
/// takes a read lock, looks up the tenant graph, runs a pure core analysis, and
/// maps the result to the proto response. An unknown tenant yields empty results
/// (not an error) — the graph is eventually consistent and may not have seen the
/// tenant's events yet.
pub struct TopologyGrpc {
    state: SharedState,
}

impl TopologyGrpc {
    pub fn new(state: SharedState) -> Self {
        TopologyGrpc { state }
    }
}

fn map_issue_kind(kind: &IssueKind) -> IssueType {
    match kind {
        IssueKind::OrphanNode => IssueType::OrphanNode,
        IssueKind::MissingEndpoint => IssueType::MissingEndpoint,
        IssueKind::DisconnectedComponent => IssueType::DisconnectedComponent,
    }
}

#[tonic::async_trait]
impl TopologyService for TopologyGrpc {
    async fn validate_topology(
        &self,
        request: Request<ValidateTopologyRequest>,
    ) -> Result<Response<ValidateTopologyResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let issues = match graphs.tenant(&req.tenant_id) {
            Some(g) => g
                .validate()
                .into_iter()
                .map(|i| TopologyIssue { r#type: map_issue_kind(&i.kind) as i32, asset_ids: i.asset_ids })
                .collect(),
            None => Vec::new(),
        };
        Ok(Response::new(ValidateTopologyResponse { issues, graph_version: graphs.version() }))
    }

    async fn trace_network(
        &self,
        request: Request<TraceNetworkRequest>,
    ) -> Result<Response<TraceNetworkResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let (node_ids, pipe_ids) = match graphs.tenant(&req.tenant_id) {
            Some(g) => g.trace(&req.start_node_id, req.max_depth),
            None => (Vec::new(), Vec::new()),
        };
        Ok(Response::new(TraceNetworkResponse { node_ids, pipe_ids, graph_version: graphs.version() }))
    }

    async fn find_nearest_valves(
        &self,
        request: Request<FindNearestValvesRequest>,
    ) -> Result<Response<FindNearestValvesResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let valves = match graphs.tenant(&req.tenant_id) {
            Some(g) => g
                .nearest_valves(&req.start_node_id, req.k as usize)
                .into_iter()
                .map(|v| NearestValve { device_id: v.device_id, pipe_id: v.pipe_id, distance: v.distance })
                .collect(),
            None => Vec::new(),
        };
        Ok(Response::new(FindNearestValvesResponse { valves, graph_version: graphs.version() }))
    }
}
```

Add `mod grpc;` to `main.rs`.

- [ ] **Step 4: Run the integration tests**

Run: `cargo test -p topology-service grpc::tests`
Expected: PASS (all 4). These spin a real tonic server on an ephemeral port and call it via the generated client — the Rust-side contract test for the proto.

- [ ] **Step 5: Commit**

```bash
git add crates/topology-service Cargo.toml
git commit -m "feat(topology): TOP-2 tonic gRPC service (validate/trace/nearest-valves) + integration test (TOP-2)"
```

---

## Task 5: Wire the gRPC server (+ gRPC health) into `main`

**Files:** Modify `crates/topology-service/src/config.rs`, `crates/topology-service/src/main.rs`

- [ ] **Step 1: Add `grpc_bind` to config**

In `config.rs`, add a field `pub grpc_bind: String,` to `Config`, and in `from_env()` add:

```rust
            grpc_bind: get("TOPOLOGY_GRPC_BIND", "0.0.0.0:50051"),
```

- [ ] **Step 2: Spawn the gRPC server in `main`**

In `main.rs`, after the HTTP health server spawn and before the consumer loop, add a gRPC server spawn that shares `shared` and reports SERVING via `tonic-health`:

```rust
    // gRPC server (+ standard gRPC health) — shares the same graph state.
    let grpc_state = shared.clone();
    let grpc_bind = cfg.grpc_bind.clone();
    tokio::spawn(async move {
        use crate::proto::topology_service_server::TopologyServiceServer;
        let addr = grpc_bind.parse().expect("valid TOPOLOGY_GRPC_BIND");
        let topology = TopologyServiceServer::new(crate::grpc::TopologyGrpc::new(grpc_state));

        let (health_reporter, health_service) = tonic_health::server::health_reporter();
        health_reporter.set_serving::<TopologyServiceServer<crate::grpc::TopologyGrpc>>().await;

        info!(%grpc_bind, "gRPC server listening");
        tonic::transport::Server::builder()
            .add_service(health_service)
            .add_service(topology)
            .serve(addr)
            .await
            .expect("gRPC server");
    });
```

(`info!` is already imported in `main.rs`.)

- [ ] **Step 3: Build, test, clippy, fmt — full workspace**

Run:
- `cargo test` (from the service dir) → all pass (core + service incl. grpc integration tests; the lapin `consumer_rabbitmq` test stays ignored).
- `cargo clippy --all-targets -- -D warnings` → clean.
- `cargo build --release` → succeeds.
- `cargo fmt --all -- --check` → clean (run `cargo fmt --all` and include in the commit if needed).

Expected: all green. Note: `tonic::include_proto!` generated code can trigger clippy lints — `src/proto.rs` already has `#![allow(clippy::all)]` at module scope to suppress them; if clippy still flags generated code, confirm the allow is at the top of `proto.rs`.

- [ ] **Step 4: Commit**

```bash
git add crates/topology-service
git commit -m "feat(topology): TOP-2 serve gRPC + gRPC health alongside consumer and HTTP health (TOP-2)"
```

---

## Task 6: Dockerfile + compose (expose gRPC port)

**Files:** Modify `src/services/water-network-topology-rs/Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Expose the gRPC port in the Dockerfile**

In `src/services/water-network-topology-rs/Dockerfile`, add `EXPOSE 50051` next to the existing `EXPOSE 8080`, and set a default bind env. The build needs no `protoc` apt package — `protoc-bin-vendored` provides it at build time. Add after the existing `ENV TOPOLOGY_HTTP_BIND=...` line:

```dockerfile
EXPOSE 50051
ENV TOPOLOGY_GRPC_BIND=0.0.0.0:50051
```

- [ ] **Step 2: Map the gRPC port in compose**

In `docker-compose.yml`, in the `water-network-topology-rs` service, change the `ports` line to also publish gRPC, and add the env var:

```yaml
    ports: ["8085:8080", "50051:50051"]
    environment:
      - TOPOLOGY_AMQP_URL=amqp://guest:guest@rabbitmq:5672/%2f
      - TOPOLOGY_QUEUE=water-network-topology-rs
      - TOPOLOGY_EXCHANGE=WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope
      - TOPOLOGY_GIS_BASE_URL=http://water-network-gis-be:8080
      - TOPOLOGY_SNAPSHOT_PATH=/app/data/topology-snapshot.json
      - TOPOLOGY_GRPC_BIND=0.0.0.0:50051
      - RUST_LOG=info
```

(Read the current block first to preserve exact indentation and the other env lines.)

- [ ] **Step 3: Verify compose + build**

Run: `docker compose config --quiet` (exit 0, no output) then `docker compose build water-network-topology-rs` (compiles the proto with vendored protoc inside the container — may take several minutes; expected). Report both results. Do NOT `docker compose up` the whole stack (host ports 5432/5672 are taken by the `platform-core` stack).

- [ ] **Step 4: Commit**

```bash
git add src/services/water-network-topology-rs/Dockerfile docker-compose.yml
git commit -m "feat(topology): TOP-2 expose gRPC port 50051 (Dockerfile + compose) (TOP-2)"
```

---

## Task 7: End-to-end verification + docs

**Files:** Modify `docs/stories/backlog.md`, `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`, `docs/conventions/template-mapping.md`

- [ ] **Step 1: e2e against the running binary (gRPC health + a real RPC)**

Build and run the binary locally against a throwaway broker on a free port (the full compose stack can't bind 5432/5672 here), seed one node+pipe+valve by publishing envelopes, then call gRPC. Concretely:

```bash
# 1) throwaway rabbitmq
docker run -d --rm --name topo-e2e-rmq -p 5673:5672 rabbitmq:3-management-alpine
# wait for it: docker exec topo-e2e-rmq rabbitmq-diagnostics -q ping

# 2) run the binary (release) with gRPC on a free port
export TOPOLOGY_AMQP_URL='amqp://guest:guest@localhost:5673/%2f'
export TOPOLOGY_EXCHANGE='WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope'
export TOPOLOGY_HTTP_BIND='127.0.0.1:8099'
export TOPOLOGY_GRPC_BIND='127.0.0.1:50071'
export TOPOLOGY_SNAPSHOT_PATH='/tmp/topo-top2-e2e.json'
# (run target/release/topology-service in the background)

# 3) gRPC health check (grpcurl if available; else the Rust client/grpc tests already prove the RPCs)
grpcurl -plaintext 127.0.0.1:50071 grpc.health.v1.Health/Check    # expects {"status":"SERVING"}
grpcurl -plaintext 127.0.0.1:50071 list                            # lists waternetwork.topology.v1.TopologyService
```

If `grpcurl` is not installed, the Task 4 in-process server+client integration tests are the authoritative server contract evidence — record that, and at minimum confirm the binary logs `gRPC server listening`. Capture the actual output as verification evidence (do not claim success without it). Tear down: stop the binary, `docker rm -f topo-e2e-rmq`, `rm -f /tmp/topo-top2-e2e.json`.

- [ ] **Step 2: Full Rust test + lint sweep**

Run (service dir): `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check`
Expected: all green.

- [ ] **Step 3: Update docs**

- `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`: tick TOP-2 in the §3.3 table (`| 3 | TOP-2 ValidateTopology + gRPC … |` → add `✓`) and the §8.3 list item 2 (`**TOP-2** — …` → `**TOP-2** ✓ SHIPPED — …` with a one-line summary).
- `docs/stories/backlog.md`: add a `## Follow-up sau TOP-2` section capturing: .NET client contract test deferred to INC-2 (proto is the contract); pipe/device-assetRef resolution for trace/nearest (currently node-id only); flow-direction trace; per-tenant `graph_version`; ComputeIsolationZone is TOP-3; isolated-placeholder cleanup on `remove_pipe` (a registered=false degree-0 node lingers and is reported as MissingEndpoint).
- `docs/conventions/template-mapping.md`: in §9, add a short note that the Rust topology service also exposes gRPC (tonic) with the proto at `proto/topology.proto` (package `waternetwork.topology.v1`), compiled via `tonic-build` + vendored `protoc` (no system protoc), with the standard `grpc.health.v1.Health` service; the `.proto` is the cross-language contract for future .NET callers (INC-2).

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(topology): TOP-2 mark done + follow-ups + gRPC convention note (TOP-2)"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch to merge `feature/phase3-top2-topology-grpc` into `main` after a final review.

---

## Self-review

**Spec coverage (roadmap §8.2/§8.3 TOP-2):**
- `ValidateTopology` (orphan/missing-endpoint/disconnected) → Task 1 (core) + Task 4 (gRPC) ✓
- `TraceNetwork` → Task 2 (core) + Task 4 (gRPC) ✓
- `FindNearestValves` → Task 2 (core) + Task 4 (gRPC) ✓
- gRPC via tonic, proto as contract → Tasks 3, 4 ✓
- `graphVersion` on every response → Task 4 (all three responses carry `graph_version`) ✓
- gRPC healthcheck → Task 5 (`tonic-health`) ✓
- contract test → Task 4 (Rust server+client integration; .NET client deferred to INC-2 per decision 0019) ✓
- Dockerfile/compose gRPC port → Task 6 ✓
- decision record → Task 0 (0019) ✓

**Deferred (recorded in 0019 + backlog):** ComputeIsolationZone (TOP-3), BuildNetworkSnapshot (Phase 6), flow-direction trace, pipe/device-ref resolution, per-tenant version, real s2s auth, isolated-placeholder cleanup.

**Type consistency:** `IssueKind`/`TopologyIssue`/`NearestValve` defined in Tasks 1–2 (topology-core), re-exported in `lib.rs`, consumed by `grpc.rs` (Task 4) via `map_issue_kind`. `NetworkGraph::{validate,trace,nearest_valves}` signatures (Tasks 1–2) match the calls in `grpc.rs` (Task 4): `validate()->Vec<TopologyIssue>`, `trace(&str,u32)->(Vec<String>,Vec<String>)`, `nearest_valves(&str,usize)->Vec<NearestValve>` (gRPC passes `req.k as usize`, `req.max_depth` is u32). Proto message/field names in Task 3 (`r#type`, `asset_ids`, `start_node_id`, `max_depth`, `graph_version`, `node_ids`, `pipe_ids`) match their use in Tasks 4. `SharedState.graphs` read-lock + `TenantGraphs::{tenant,version}` (TOP-1) used in `grpc.rs`. `Config.grpc_bind` (Task 5) used in `main.rs` (Task 5).

**Verification points flagged inline:** tonic-build `compile_protos` vs `compile` name (Task 3); `petgraph::visit::EdgeRef` import for `.source()/.target()` (Tasks 1–2); clippy on generated proto code suppressed via `#![allow(clippy::all)]` in `proto.rs` (Tasks 3, 5); `tokio-stream` dev-dep for the integration test (Task 4).
