# TOP-1 — topology-rs Scaffold + Graph-from-Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory (superpowers:test-driven-development) — write the failing test first, watch it fail, then implement.

**Goal:** Stand up the first Rust microservice (`water-network-topology-rs`) that consumes GIS integration events from RabbitMQ and maintains an in-memory, per-tenant network graph, with snapshot/rebuild warm-up — proving the scaffold end-to-end. gRPC, ValidateTopology, and isolation analysis are explicitly OUT (those are TOP-2 / TOP-3).

**Architecture:** A Cargo workspace with two crates: `topology-core` (pure library — event types, graph model, idempotent `apply`, snapshot serde; fully unit/property testable with no I/O) and `topology-service` (binary — lapin AMQP consumer, GIS rebuild HTTP client, warm-up, axum `/health`, `main`). The service binds a raw-AMQP queue to MassTransit's fanout message exchange, filters by `EventType`, double-parses the envelope (`Payload` is a JSON string containing a `Data` object), and applies events to an `Arc<RwLock<TenantGraphs>>`. A node is a graph vertex, a pipe is an edge, and a valve (device with `DeviceType == "Valve"` hosted on a pipe) is an attribute on that edge — per decision 0017. Tenant is read from the **payload** (`TenantId`), never the envelope (outbox events carry a null envelope tenant). On the .NET side, gis-be gains a keyset-paginated `GET /api/network/assets/export` bulk endpoint for full rebuild.

**Tech Stack:** Rust (stable) + Cargo workspace · petgraph (StableGraph) · lapin (AMQP) · tokio · serde/serde_json · reqwest · axum · proptest + wiremock (dev) · multi-stage Rust Dockerfile. .NET 10 (gis-be export endpoint) · Dapper · existing `IQueryBus` / `IEndpointModule` patterns.

---

## Verified contract facts (do not re-derive — these were confirmed against source)

These pin every wire-format decision in the plan. File refs are for confirmation only.

1. **Envelope** (`IntegrationEventEnvelope.cs:12-23`), serialized **PascalCase**, default `System.Text.Json`:
   ```jsonc
   {
     "EventId": "...", "EventType": "network.node.registered", "EventVersion": 1,
     "OccurredAt": "2026-06-17T00:00:00Z",
     "TenantId": null,            // null for outbox-published events — DO NOT rely on this
     "OrganizationId": null, "BranchId": null, "CorrelationId": "...", "CausationId": null,
     "Producer": "water-network-gis-be",
     "Payload": "{...json string...}"   // NOTE: Payload is a STRING, not an object
   }
   ```
2. **Inner payload** (the decoded `Payload` string) is itself `{ EventType, EventVersion, ..., Data: {…} }`; the GIS-5 consumer reads `doc.RootElement.GetProperty("Data")`. So the typed fields live under `Payload`→parse→`.Data`. **The Rust consumer must double-parse.**
3. **Every GIS payload `Data` carries `TenantId`** (PascalCase). Tenant partitioning uses this.
4. **The 7 event types** (`GisEventTypes.cs`) and their `Data` shapes (all PascalCase):
   - `network.node.registered` → `{ NodeId, TenantId, AssetCode, NodeType, Latitude(double), Longitude(double) }`
   - `network.node.relocated` → `{ NodeId, TenantId, AssetCode, OldLatitude, OldLongitude, NewLatitude, NewLongitude, Reason(string?) }`
   - `network.node.deleted` → `{ NodeId, TenantId, AssetCode, NodeType }`
   - `network.pipe.registered` → `{ PipeId, TenantId, AssetCode, FromNodeId, ToNodeId, LengthM(double), DiameterMm(int), Material }` — **no geometry**
   - `network.pipe.deleted` → `{ PipeId, TenantId, AssetCode }`
   - `network.device.installed` → `{ DeviceId, TenantId, AssetCode, DeviceType, HostPipeId(string?), HostNodeId(string?), Latitude, Longitude }` — exactly one host is non-null
   - `network.device.deleted` → `{ DeviceId, TenantId, AssetCode, DeviceType }`
5. **RabbitMQ topology:** single fanout message exchange (durable), consumers create their own queue and **filter by `EventType` in code** (no broker routing keys). Connection defaults host `rabbitmq`/`localhost`, port 5672, vhost `/`, user/pass `guest`/`guest` (config keys `MassTransit:RabbitMq:*`). The exact exchange name is **not hardcoded anywhere** in the repo and MUST be verified empirically (Task 8, Step 1).
6. **gis-be tables:** `network_nodes(id, tenant_id, asset_code, node_type, location, deleted_at, …)`, `network_pipes(id, tenant_id, asset_code, from_node_id, to_node_id, geometry, diameter_mm, material, length_m, status, deleted_at, …)`, `network_devices(id, tenant_id, asset_code, device_type, host_pipe_id, host_node_id, location, status, deleted_at, …)`. Ids are `character varying(64)` strings. No cursor pagination exists yet.
7. **gis-be read pattern:** `IQuery<T>` + `IQueryBus.ExecuteAsync` + `IQueryHandler`; auto-registered via `AddHandlersFromAssembly`. Dapper DAO via `dbContext.Database.GetDbConnection()`. Endpoints via `IEndpointModule` under route group `/api/network/assets`, guarded with `.RequirePermission("network-gis:read")` and `.WithValidation<TRequest>()`. Tenant from `ITenantContextAccessor.Current`.

---

## File structure

**New Rust service** under `src/services/water-network-topology-rs/`:

```
src/services/water-network-topology-rs/
├── Cargo.toml                      # [workspace] manifest
├── rust-toolchain.toml             # channel = "stable"
├── .gitignore                      # /target
├── Dockerfile                      # multi-stage rust → debian-slim
├── crates/
│   ├── topology-core/              # pure lib, no I/O — unit + proptest
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # re-exports
│   │       ├── events.rs           # serde: Envelope + 7 payloads + GraphEvent + parsing
│   │       ├── graph.rs            # NetworkGraph, TenantGraphs, indexes
│   │       ├── apply.rs            # idempotent apply_envelope / apply_event
│   │       └── snapshot.rs         # (de)serialize TenantGraphs + version metadata
│   └── topology-service/           # binary
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs             # config, warm-up, spawn consumer + health
│           ├── config.rs           # env config
│           ├── state.rs            # Arc<RwLock<TenantGraphs>> + SharedState
│           ├── consumer.rs         # lapin: connect, declare/bind, consume loop
│           ├── gis_client.rs       # reqwest export pager → TenantGraphs (per tenant)
│           ├── warmup.rs           # snapshot-first warm-up
│           └── health.rs           # axum /health
└── tests/                          # topology-service integration tests
    └── consumer_rabbitmq.rs        # real RabbitMQ round-trip (ignored by default)
```

**Modified .NET (gis-be)** — bulk export endpoint:

```
src/services/water-network-gis-be/src/
├── WaterNetwork.Gis.Application/
│   ├── Queries/ExportAssetsQuery.cs                 # Create
│   ├── Queries/ExportAssetsQueryHandler.cs          # Create
│   ├── Ports/IExportAssetReadDao.cs                 # Create (DAO port + row type + page DTO)
│   └── Dtos/AssetExportPageDto.cs                   # Create
├── WaterNetwork.Gis.Infrastructure/
│   └── Repositories/ExportAssetReadDao.cs           # Create (keyset SQL)
└── WaterNetwork.Gis.Api/
    └── Endpoints/AssetsEndpointModule.cs            # Modify: add GET /export
tests/WaterNetwork.Gis.IntegrationTests/
    └── ExportAssetsApiTests.cs                      # Create
```

**Docs:** `docs/decisions/0017-topology-graph-model.md`, `docs/decisions/0018-topology-warmup-and-consumption.md` (Create); `docs/conventions/template-mapping.md`, `docs/stories/backlog.md`, `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (Modify).

---

## Task 0: Decision records (architecture lock for Phase 3)

User confirmed both decisions "theo đề xuất roadmap" (§18 #4 valve-as-edge-attribute, #5 snapshot+replay warm-up). Capture them as durable ADRs before any code (CLAUDE.md mandates ADRs for architecture changes).

**Files:**
- Create: `docs/decisions/0017-topology-graph-model.md`
- Create: `docs/decisions/0018-topology-warmup-and-consumption.md`

- [ ] **Step 1: Write decision 0017 (graph model)**

Create `docs/decisions/0017-topology-graph-model.md` mirroring the format of `0013-gis-asset-state-projection.md` (sections: title, Date, Status=Accepted, Context, Decision, Consequences, Follow-ups). Content must state:
- Context: topology-rs needs an in-memory model for isolation/cut-set analysis (Phase 3). Three modelling questions: vertex/edge mapping, where a valve lives, tenant partitioning.
- Decision: (1) **node = vertex, pipe = edge** in a petgraph `StableGraph` per tenant. (2) **valve = attribute on the edge** it is hosted on (`DeviceType == "Valve"` + non-null `HostPipeId`) — isolation closes valves to cut edges, so the valve belongs on the edge, not a vertex. Non-valve devices are tracked in a side map but do not alter graph topology in TOP-1. (3) **per-tenant graph** keyed by `TenantId` read from the event payload (`TenantId` is in every GIS payload; the envelope tenant is null for outbox events — ref decision 0013). Graphs of two tenants are never mixed. (4) Pipes arriving before their endpoint nodes implicitly create placeholder vertices (eventual consistency / out-of-order tolerance).
- Consequences: isolation = minimal closeable-edge (valve) set; relocate is a geometry-only event with no topological effect in TOP-1; device-on-node hosting carries no edge semantics yet.
- Follow-ups: pipe diameter/length as edge weights for hydraulic cost (HYD); `valve.state.changed` (open/closed) consumption is Phase 5.

- [ ] **Step 2: Write decision 0018 (warm-up & consumption)**

Create `docs/decisions/0018-topology-warmup-and-consumption.md` stating:
- Context: stateless-about-business Rust service holding a rebuildable read model; needs warm-up on restart and a robust AMQP binding to MassTransit.
- Decision: (1) **warm-up = snapshot + replay**: periodically serialize `TenantGraphs` to disk; on startup load the snapshot then continue consuming from the durable queue (queue is durable so messages persist while the service is down). (2) **fallback = full rebuild via GIS bulk export** (`GET /api/network/assets/export`, keyset-paginated) when no snapshot exists; TOP-1 implements per-tenant rebuild (multi-tenant enumeration deferred — snapshot is the primary path). (3) **raw-AMQP binding**: declare a durable queue `water-network-topology-rs`, bind it to MassTransit's fanout message exchange (name verified empirically, Task 8). (4) **idempotency by `EventId`** held in the snapshot, mirroring the .NET inbox. (5) **tenant from payload**, never envelope.
- Consequences: graph is an eventually-consistent read model; every future gRPC response (TOP-2) will carry a `graphVersion`; drift-reconciliation job is TOP-3+.
- Follow-ups: service-to-service auth for the export call (system identity / mock token factory, roadmap §15.2) — TOP-1 uses an env-configured bearer token; snapshot store on disk now, Redis later; multi-tenant rebuild enumeration.

- [ ] **Step 3: Commit**

```bash
git checkout -b feature/phase3-top1-topology-scaffold
git add docs/decisions/0017-topology-graph-model.md docs/decisions/0018-topology-warmup-and-consumption.md
git commit -m "docs(topology): TOP-1 decisions 0017 graph model + 0018 warm-up/consumption (TOP-1)"
```

---

## Task 1: Rust workspace scaffold

**Files:**
- Create: `src/services/water-network-topology-rs/Cargo.toml`
- Create: `src/services/water-network-topology-rs/rust-toolchain.toml`
- Create: `src/services/water-network-topology-rs/.gitignore`
- Create: `src/services/water-network-topology-rs/crates/topology-core/Cargo.toml`
- Create: `src/services/water-network-topology-rs/crates/topology-core/src/lib.rs`
- Create: `src/services/water-network-topology-rs/crates/topology-service/Cargo.toml`
- Create: `src/services/water-network-topology-rs/crates/topology-service/src/main.rs`

- [ ] **Step 1: Verify Rust toolchain is available**

Run: `cargo --version && rustc --version`
Expected: prints cargo/rustc versions (stable). If absent, install via `rustup` before continuing.

- [ ] **Step 2: Create the workspace manifest**

Create `src/services/water-network-topology-rs/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/topology-core", "crates/topology-service"]

[workspace.package]
edition = "2021"
version = "0.1.0"
license = "proprietary"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
petgraph = { version = "0.6", features = ["serde-1"] }
thiserror = "1"
anyhow = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "signal"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
lapin = "2"
futures-util = "0.3"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
axum = "0.7"
proptest = "1"
wiremock = "0.6"
```

- [ ] **Step 3: Pin toolchain and ignore build output**

Create `src/services/water-network-topology-rs/rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

Create `src/services/water-network-topology-rs/.gitignore`:

```gitignore
/target
```

- [ ] **Step 4: Create the `topology-core` library crate with a smoke test**

Create `crates/topology-core/Cargo.toml`:

```toml
[package]
name = "topology-core"
edition.workspace = true
version.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
petgraph.workspace = true
thiserror.workspace = true

[dev-dependencies]
proptest.workspace = true
```

Create `crates/topology-core/src/lib.rs`:

```rust
//! Pure, I/O-free core of the topology service: event types, the per-tenant
//! network graph, idempotent event application, and snapshot serialization.

#[cfg(test)]
mod smoke {
    #[test]
    fn workspace_builds() {
        assert_eq!(2 + 2, 4);
    }
}
```

- [ ] **Step 5: Create the `topology-service` binary crate**

Create `crates/topology-service/Cargo.toml`:

```toml
[package]
name = "topology-service"
edition.workspace = true
version.workspace = true
license.workspace = true

[dependencies]
topology-core = { path = "../topology-core" }
serde.workspace = true
serde_json.workspace = true
tokio.workspace = true
tracing.workspace = true
tracing-subscriber.workspace = true
lapin.workspace = true
futures-util.workspace = true
reqwest.workspace = true
axum.workspace = true
anyhow.workspace = true

[dev-dependencies]
wiremock.workspace = true
```

Create `crates/topology-service/src/main.rs`:

```rust
fn main() {
    println!("water-network-topology-rs placeholder");
}
```

- [ ] **Step 6: Build and test the workspace**

Run (from the service dir): `cd src/services/water-network-topology-rs && cargo test`
Expected: compiles; `smoke::workspace_builds` PASS; binary builds.

- [ ] **Step 7: Document the Rust-service convention**

In `docs/conventions/template-mapping.md`, add a new section `## 9. Rust service convention (topology-rs, Phase 3)` noting: Rust services live under `src/services/<name>-rs/` as a Cargo workspace (deliberate divergence from the .NET `.slnx` recipe — recorded here per §2 rule), with a pure `*-core` lib (unit + proptest) and a `*-service` binary (I/O), a multi-stage Rust Dockerfile, and a compose block; they integrate only via the event envelope and (later) gRPC proto — never another service's DB.

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-topology-rs docs/conventions/template-mapping.md
git commit -m "feat(topology): TOP-1 Rust workspace scaffold (core lib + service bin) (TOP-1)"
```

---

## Task 2: Event types and envelope parsing (`topology-core`)

The Rust consumer must deserialize the PascalCase envelope, then double-parse the `Payload` string into `{ Data: {…} }`, and convert into a strongly-typed `GraphEvent`. We test against **verbatim wire JSON** so the structs are guaranteed to match.

**Files:**
- Create: `crates/topology-core/src/events.rs`
- Modify: `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write the failing test for envelope + node.registered parsing**

Create `crates/topology-core/src/events.rs` with only the tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Verbatim wire shape: envelope is PascalCase; Payload is a STRING whose
    // decoded form has a `Data` object with the typed fields (also PascalCase).
    fn node_registered_wire() -> String {
        let data = r#"{"NodeId":"node-1","TenantId":"t-1","AssetCode":"ND-1","NodeType":"Junction","Latitude":10.5,"Longitude":106.7}"#;
        let payload = serde_json::json!({
            "EventType": "network.node.registered",
            "EventVersion": 1,
            "Data": serde_json::from_str::<serde_json::Value>(data).unwrap()
        });
        serde_json::json!({
            "EventId": "evt-1",
            "EventType": "network.node.registered",
            "EventVersion": 1,
            "OccurredAt": "2026-06-17T00:00:00Z",
            "TenantId": serde_json::Value::Null,
            "Producer": "water-network-gis-be",
            "Payload": serde_json::to_string(&payload).unwrap()
        })
        .to_string()
    }

    #[test]
    fn parses_node_registered_into_graph_event() {
        let raw = node_registered_wire();
        let parsed = GraphEvent::from_envelope_bytes(raw.as_bytes())
            .expect("must parse")
            .expect("node.registered is a known type");
        assert_eq!(parsed.event_id, "evt-1");
        assert_eq!(parsed.tenant_id, "t-1");
        match parsed.kind {
            GraphEventKind::NodeRegistered { node_id, .. } => assert_eq!(node_id, "node-1"),
            other => panic!("wrong kind: {other:?}"),
        }
    }

    #[test]
    fn ignores_unknown_event_type() {
        let raw = node_registered_wire().replace("network.node.registered", "asset.registered");
        let parsed = GraphEvent::from_envelope_bytes(raw.as_bytes()).expect("valid json");
        assert!(parsed.is_none(), "non-topology events return Ok(None)");
    }
}
```

- [ ] **Step 2: Run the test to confirm it fails to compile**

Run: `cargo test -p topology-core events::tests`
Expected: FAIL — `GraphEvent`, `GraphEventKind`, `from_envelope_bytes` not defined.

- [ ] **Step 3: Implement the event types and parsing**

Prepend to `crates/topology-core/src/events.rs` (above the `tests` module):

```rust
use serde::Deserialize;

/// MassTransit envelope. PascalCase on the wire; `Payload` is a JSON *string*.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Envelope {
    event_id: String,
    event_type: String,
    #[serde(default)]
    payload: String,
}

/// The decoded `Payload` string: `{ EventType, EventVersion, ..., Data: {…} }`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InnerPayload {
    data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeRegisteredData {
    node_id: String,
    tenant_id: String,
    node_type: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeRelocatedData {
    node_id: String,
    tenant_id: String,
    new_latitude: f64,
    new_longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeDeletedData {
    node_id: String,
    tenant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PipeRegisteredData {
    pipe_id: String,
    tenant_id: String,
    from_node_id: String,
    to_node_id: String,
    length_m: f64,
    diameter_mm: i32,
    material: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PipeDeletedData {
    pipe_id: String,
    tenant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DeviceInstalledData {
    device_id: String,
    tenant_id: String,
    device_type: String,
    host_pipe_id: Option<String>,
    host_node_id: Option<String>,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DeviceDeletedData {
    device_id: String,
    tenant_id: String,
}

/// A topology-relevant event, tenant-scoped, with idempotency key.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphEvent {
    pub event_id: String,
    pub tenant_id: String,
    pub kind: GraphEventKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GraphEventKind {
    NodeRegistered { node_id: String, node_type: String, lat: f64, lng: f64 },
    NodeRelocated { node_id: String, lat: f64, lng: f64 },
    NodeDeleted { node_id: String },
    PipeRegistered { pipe_id: String, from_node_id: String, to_node_id: String, length_m: f64, diameter_mm: i32, material: String },
    PipeDeleted { pipe_id: String },
    DeviceInstalled { device_id: String, device_type: String, host_pipe_id: Option<String>, host_node_id: Option<String>, lat: f64, lng: f64 },
    DeviceDeleted { device_id: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("invalid envelope json: {0}")]
    Envelope(serde_json::Error),
    #[error("invalid payload json: {0}")]
    Payload(serde_json::Error),
    #[error("invalid data for {event_type}: {source}")]
    Data { event_type: String, source: serde_json::Error },
}

impl GraphEvent {
    /// Parse raw AMQP body. Returns `Ok(None)` for well-formed but non-topology
    /// events (filtered by `EventType`), `Err` only for malformed JSON.
    pub fn from_envelope_bytes(bytes: &[u8]) -> Result<Option<GraphEvent>, ParseError> {
        let env: Envelope = serde_json::from_slice(bytes).map_err(ParseError::Envelope)?;
        if !is_topology_event(&env.event_type) {
            return Ok(None);
        }
        let inner: InnerPayload = serde_json::from_str(&env.payload).map_err(ParseError::Payload)?;
        let kind = parse_kind(&env.event_type, &inner.data)
            .map_err(|source| ParseError::Data { event_type: env.event_type.clone(), source })?;
        // tenant always comes from the payload Data, never the envelope.
        let tenant_id = tenant_of(&inner.data);
        Ok(Some(GraphEvent { event_id: env.event_id, tenant_id, kind }))
    }
}

fn is_topology_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "network.node.registered" | "network.node.relocated" | "network.node.deleted"
            | "network.pipe.registered" | "network.pipe.deleted"
            | "network.device.installed" | "network.device.deleted"
    )
}

fn tenant_of(data: &serde_json::Value) -> String {
    data.get("TenantId").and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn parse_kind(event_type: &str, data: &serde_json::Value) -> Result<GraphEventKind, serde_json::Error> {
    Ok(match event_type {
        "network.node.registered" => {
            let d: NodeRegisteredData = serde_json::from_value(data.clone())?;
            GraphEventKind::NodeRegistered { node_id: d.node_id, node_type: d.node_type, lat: d.latitude, lng: d.longitude }
        }
        "network.node.relocated" => {
            let d: NodeRelocatedData = serde_json::from_value(data.clone())?;
            GraphEventKind::NodeRelocated { node_id: d.node_id, lat: d.new_latitude, lng: d.new_longitude }
        }
        "network.node.deleted" => {
            let d: NodeDeletedData = serde_json::from_value(data.clone())?;
            GraphEventKind::NodeDeleted { node_id: d.node_id }
        }
        "network.pipe.registered" => {
            let d: PipeRegisteredData = serde_json::from_value(data.clone())?;
            GraphEventKind::PipeRegistered { pipe_id: d.pipe_id, from_node_id: d.from_node_id, to_node_id: d.to_node_id, length_m: d.length_m, diameter_mm: d.diameter_mm, material: d.material }
        }
        "network.pipe.deleted" => {
            let d: PipeDeletedData = serde_json::from_value(data.clone())?;
            GraphEventKind::PipeDeleted { pipe_id: d.pipe_id }
        }
        "network.device.installed" => {
            let d: DeviceInstalledData = serde_json::from_value(data.clone())?;
            GraphEventKind::DeviceInstalled { device_id: d.device_id, device_type: d.device_type, host_pipe_id: d.host_pipe_id, host_node_id: d.host_node_id, lat: d.latitude, lng: d.longitude }
        }
        "network.device.deleted" => {
            let d: DeviceDeletedData = serde_json::from_value(data.clone())?;
            GraphEventKind::DeviceDeleted { device_id: d.device_id }
        }
        other => unreachable!("is_topology_event gated {other}"),
    })
}
```

Note: the `tenant_id` fields on the typed `*Data` structs are deliberately kept (even if only read via `tenant_of`) so the structs are a faithful 1:1 of the wire contract and serde validates their presence.

- [ ] **Step 4: Register the module**

Replace `crates/topology-core/src/lib.rs` body with:

```rust
//! Pure, I/O-free core of the topology service.

pub mod events;

pub use events::{GraphEvent, GraphEventKind, ParseError};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p topology-core`
Expected: PASS — both `events::tests` pass; smoke test still passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-core
git commit -m "feat(topology): TOP-1 envelope + GIS event parsing (double-parse Payload.Data) (TOP-1)"
```

---

## Task 3: Per-tenant graph model (`topology-core`)

**Files:**
- Create: `crates/topology-core/src/graph.rs`
- Modify: `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write failing tests for graph primitives**

Create `crates/topology-core/src/graph.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_node_is_idempotent_on_index() {
        let mut g = NetworkGraph::default();
        let a = g.upsert_node("n1");
        let b = g.upsert_node("n1");
        assert_eq!(a, b, "same node id maps to the same vertex");
        assert_eq!(g.node_count(), 1);
    }

    #[test]
    fn add_pipe_creates_endpoints_when_missing() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        assert_eq!(g.node_count(), 2, "missing endpoints are created implicitly");
        assert_eq!(g.pipe_count(), 1);
        assert!(g.has_pipe("p1"));
    }

    #[test]
    fn remove_pipe_drops_edge_only() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.remove_pipe("p1");
        assert!(!g.has_pipe("p1"));
        assert_eq!(g.node_count(), 2, "endpoints remain");
    }

    #[test]
    fn valve_marks_host_edge() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.set_device("d1", "Valve", Some("p1"), None);
        assert!(g.pipe_has_valve("p1"));
        g.remove_device("d1");
        assert!(!g.pipe_has_valve("p1"));
    }

    #[test]
    fn non_valve_device_does_not_mark_edge() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.set_device("d1", "PressureSensor", Some("p1"), None);
        assert!(!g.pipe_has_valve("p1"));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core graph::tests`
Expected: FAIL — `NetworkGraph` not defined.

- [ ] **Step 3: Implement the graph model**

Prepend to `crates/topology-core/src/graph.rs`:

```rust
use std::collections::{HashMap, HashSet};

use petgraph::stable_graph::{EdgeIndex, NodeIndex, StableUnGraph};
use serde::{Deserialize, Serialize};

/// Edge payload: the pipe id plus the set of valve device ids hosted on it.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipeEdge {
    pub pipe_id: String,
    pub valves: HashSet<String>,
}

/// Vertex payload: the node id (kept so a deserialized graph can rebuild indexes).
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeVertex {
    pub node_id: String,
}

/// A device's placement, tracked so deletes can find and unmark the host edge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DevicePlacement {
    pub device_type: String,
    pub host_pipe_id: Option<String>,
    pub host_node_id: Option<String>,
}

/// One tenant's network as an undirected, stable graph.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct NetworkGraph {
    graph: StableUnGraph<NodeVertex, PipeEdge>,
    #[serde(skip)]
    node_ix: HashMap<String, NodeIndex>,
    #[serde(skip)]
    pipe_ix: HashMap<String, EdgeIndex>,
    devices: HashMap<String, DevicePlacement>,
}

impl NetworkGraph {
    /// Rebuild the transient `node_ix`/`pipe_ix` lookups after deserialization.
    pub fn reindex(&mut self) {
        self.node_ix.clear();
        self.pipe_ix.clear();
        for ix in self.graph.node_indices() {
            self.node_ix.insert(self.graph[ix].node_id.clone(), ix);
        }
        for ix in self.graph.edge_indices() {
            self.pipe_ix.insert(self.graph[ix].pipe_id.clone(), ix);
        }
    }

    pub fn upsert_node(&mut self, node_id: &str) -> NodeIndex {
        if let Some(&ix) = self.node_ix.get(node_id) {
            return ix;
        }
        let ix = self.graph.add_node(NodeVertex { node_id: node_id.to_string() });
        self.node_ix.insert(node_id.to_string(), ix);
        ix
    }

    pub fn add_pipe(&mut self, pipe_id: &str, from_node_id: &str, to_node_id: &str) {
        if self.pipe_ix.contains_key(pipe_id) {
            return; // idempotent: pipe already present
        }
        let a = self.upsert_node(from_node_id);
        let b = self.upsert_node(to_node_id);
        let ix = self.graph.add_edge(a, b, PipeEdge { pipe_id: pipe_id.to_string(), valves: HashSet::new() });
        self.pipe_ix.insert(pipe_id.to_string(), ix);
    }

    pub fn remove_pipe(&mut self, pipe_id: &str) {
        if let Some(ix) = self.pipe_ix.remove(pipe_id) {
            self.graph.remove_edge(ix);
        }
    }

    pub fn remove_node(&mut self, node_id: &str) {
        if let Some(ix) = self.node_ix.remove(node_id) {
            // remove_node also drops incident edges; purge those from pipe_ix.
            let dropped: Vec<String> = self
                .graph
                .edges(ix)
                .map(|e| e.weight().pipe_id.clone())
                .collect();
            for pid in dropped {
                self.pipe_ix.remove(&pid);
            }
            self.graph.remove_node(ix);
        }
    }

    pub fn set_device(&mut self, device_id: &str, device_type: &str, host_pipe_id: Option<&str>, host_node_id: Option<&str>) {
        // If re-installing, clear any previous valve mark first.
        self.remove_device(device_id);
        let placement = DevicePlacement {
            device_type: device_type.to_string(),
            host_pipe_id: host_pipe_id.map(str::to_string),
            host_node_id: host_node_id.map(str::to_string),
        };
        if device_type == "Valve" {
            if let Some(pid) = host_pipe_id {
                if let Some(&ix) = self.pipe_ix.get(pid) {
                    self.graph[ix].valves.insert(device_id.to_string());
                }
            }
        }
        self.devices.insert(device_id.to_string(), placement);
    }

    pub fn remove_device(&mut self, device_id: &str) {
        if let Some(prev) = self.devices.remove(device_id) {
            if prev.device_type == "Valve" {
                if let Some(pid) = prev.host_pipe_id {
                    if let Some(&ix) = self.pipe_ix.get(&pid) {
                        self.graph[ix].valves.remove(device_id);
                    }
                }
            }
        }
    }

    pub fn node_count(&self) -> usize { self.graph.node_count() }
    pub fn pipe_count(&self) -> usize { self.graph.edge_count() }
    pub fn has_pipe(&self, pipe_id: &str) -> bool { self.pipe_ix.contains_key(pipe_id) }
    pub fn has_node(&self, node_id: &str) -> bool { self.node_ix.contains_key(node_id) }
    pub fn pipe_has_valve(&self, pipe_id: &str) -> bool {
        self.pipe_ix.get(pipe_id).map(|&ix| !self.graph[ix].valves.is_empty()).unwrap_or(false)
    }
}
```

- [ ] **Step 4: Register the module**

Update `crates/topology-core/src/lib.rs`:

```rust
//! Pure, I/O-free core of the topology service.

pub mod events;
pub mod graph;

pub use events::{GraphEvent, GraphEventKind, ParseError};
pub use graph::{DevicePlacement, NetworkGraph, NodeVertex, PipeEdge};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p topology-core graph::tests`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-core
git commit -m "feat(topology): TOP-1 per-tenant network graph (node=vertex, pipe=edge, valve=edge attr) (TOP-1)"
```

---

## Task 4: Idempotent event application + TenantGraphs (`topology-core`)

**Files:**
- Create: `crates/topology-core/src/apply.rs`
- Modify: `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write failing tests (incl. property-based idempotency)**

Create `crates/topology-core/src/apply.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{GraphEvent, GraphEventKind};
    use proptest::prelude::*;

    fn ev(id: &str, tenant: &str, kind: GraphEventKind) -> GraphEvent {
        GraphEvent { event_id: id.to_string(), tenant_id: tenant.to_string(), kind }
    }

    #[test]
    fn applies_node_then_pipe_per_tenant() {
        let mut tg = TenantGraphs::default();
        tg.apply(&ev("e1", "t1", GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "Junction".into(), lat: 0.0, lng: 0.0 }));
        tg.apply(&ev("e2", "t1", GraphEventKind::PipeRegistered { pipe_id: "p1".into(), from_node_id: "n1".into(), to_node_id: "n2".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() }));
        let g = tg.tenant("t1").unwrap();
        assert_eq!(g.node_count(), 2);
        assert!(g.has_pipe("p1"));
        assert_eq!(tg.version(), 2);
    }

    #[test]
    fn tenants_are_isolated() {
        let mut tg = TenantGraphs::default();
        tg.apply(&ev("e1", "t1", GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 }));
        tg.apply(&ev("e2", "t2", GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 }));
        assert_eq!(tg.tenant("t1").unwrap().node_count(), 1);
        assert_eq!(tg.tenant("t2").unwrap().node_count(), 1);
        assert_eq!(tg.tenant_count(), 2);
    }

    #[test]
    fn duplicate_event_id_is_a_noop() {
        let mut tg = TenantGraphs::default();
        let e = ev("dup", "t1", GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 });
        assert!(tg.apply(&e), "first apply takes effect");
        assert!(!tg.apply(&e), "second apply is a no-op");
        assert_eq!(tg.tenant("t1").unwrap().node_count(), 1);
        assert_eq!(tg.version(), 1, "version only advances on effective applies");
    }

    proptest! {
        // apply(e); apply(e) == apply(e)  — replay safety for every event kind.
        #[test]
        fn applying_twice_equals_once(seq in proptest::collection::vec(0u8..7, 1..40)) {
            let mut once = TenantGraphs::default();
            let mut twice = TenantGraphs::default();
            for (i, code) in seq.iter().enumerate() {
                let e = sample_event(i, *code);
                once.apply(&e);
                twice.apply(&e);
                twice.apply(&e); // replay
            }
            prop_assert_eq!(once.snapshot_graphs(), twice.snapshot_graphs());
        }
    }

    // Deterministic event generator over a tiny fixed id space so collisions
    // (and thus add/remove interplay) actually happen.
    fn sample_event(i: usize, code: u8) -> GraphEvent {
        let n = |x: usize| format!("n{}", x % 4);
        let p = |x: usize| format!("p{}", x % 3);
        let d = |x: usize| format!("d{}", x % 3);
        let kind = match code {
            0 => GraphEventKind::NodeRegistered { node_id: n(i), node_type: "J".into(), lat: 0.0, lng: 0.0 },
            1 => GraphEventKind::NodeRelocated { node_id: n(i), lat: 1.0, lng: 1.0 },
            2 => GraphEventKind::NodeDeleted { node_id: n(i) },
            3 => GraphEventKind::PipeRegistered { pipe_id: p(i), from_node_id: n(i), to_node_id: n(i + 1), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() },
            4 => GraphEventKind::PipeDeleted { pipe_id: p(i) },
            5 => GraphEventKind::DeviceInstalled { device_id: d(i), device_type: "Valve".into(), host_pipe_id: Some(p(i)), host_node_id: None, lat: 0.0, lng: 0.0 },
            _ => GraphEventKind::DeviceDeleted { device_id: d(i) },
        };
        GraphEvent { event_id: format!("e{i}"), tenant_id: "t1".into(), kind }
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core apply::tests`
Expected: FAIL — `TenantGraphs` not defined.

- [ ] **Step 3: Implement application + idempotency**

Prepend to `crates/topology-core/src/apply.rs`:

```rust
use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::events::{GraphEvent, GraphEventKind};
use crate::graph::NetworkGraph;

/// All tenants' graphs plus the processed-event-id set (the inbox) and a
/// monotonically increasing version (count of effective applies).
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct TenantGraphs {
    graphs: BTreeMap<String, NetworkGraph>,
    processed: HashSet<String>,
    version: u64,
}

impl TenantGraphs {
    /// Apply one event. Returns `true` if it took effect, `false` if it was a
    /// duplicate (already-seen `event_id`). Idempotent by `event_id`.
    pub fn apply(&mut self, event: &GraphEvent) -> bool {
        if self.processed.contains(&event.event_id) {
            return false;
        }
        let g = self.graphs.entry(event.tenant_id.clone()).or_default();
        match &event.kind {
            GraphEventKind::NodeRegistered { node_id, .. } => { g.upsert_node(node_id); }
            GraphEventKind::NodeRelocated { node_id, .. } => { g.upsert_node(node_id); } // geometry-only; ensures vertex exists
            GraphEventKind::NodeDeleted { node_id } => { g.remove_node(node_id); }
            GraphEventKind::PipeRegistered { pipe_id, from_node_id, to_node_id, .. } => { g.add_pipe(pipe_id, from_node_id, to_node_id); }
            GraphEventKind::PipeDeleted { pipe_id } => { g.remove_pipe(pipe_id); }
            GraphEventKind::DeviceInstalled { device_id, device_type, host_pipe_id, host_node_id, .. } =>
                g.set_device(device_id, device_type, host_pipe_id.as_deref(), host_node_id.as_deref()),
            GraphEventKind::DeviceDeleted { device_id } => { g.remove_device(device_id); }
        }
        self.processed.insert(event.event_id.clone());
        self.version += 1;
        true
    }

    pub fn tenant(&self, tenant_id: &str) -> Option<&NetworkGraph> { self.graphs.get(tenant_id) }
    pub fn tenant_count(&self) -> usize { self.graphs.len() }
    pub fn version(&self) -> u64 { self.version }
    pub fn already_processed(&self, event_id: &str) -> bool { self.processed.contains(event_id) }

    /// Deterministic comparable view used in tests (ignores transient indexes).
    pub fn snapshot_graphs(&self) -> &BTreeMap<String, NetworkGraph> { &self.graphs }

    /// Rebuild transient indexes for every tenant after deserialization.
    pub fn reindex_all(&mut self) {
        for g in self.graphs.values_mut() {
            g.reindex();
        }
    }
}
```

- [ ] **Step 4: Register the module**

Update `crates/topology-core/src/lib.rs`:

```rust
//! Pure, I/O-free core of the topology service.

pub mod apply;
pub mod events;
pub mod graph;

pub use apply::TenantGraphs;
pub use events::{GraphEvent, GraphEventKind, ParseError};
pub use graph::{DevicePlacement, NetworkGraph, NodeVertex, PipeEdge};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p topology-core`
Expected: PASS — including the proptest `applying_twice_equals_once` across all generated sequences.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-core
git commit -m "feat(topology): TOP-1 idempotent event application + per-tenant graphs (proptest replay-safe) (TOP-1)"
```

---

## Task 5: Snapshot persistence (`topology-core`)

**Files:**
- Create: `crates/topology-core/src/snapshot.rs`
- Modify: `crates/topology-core/src/lib.rs`

- [ ] **Step 1: Write the failing round-trip test**

Create `crates/topology-core/src/snapshot.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{GraphEvent, GraphEventKind};

    #[test]
    fn round_trip_preserves_graph_and_dedup_and_indexes() {
        let mut tg = TenantGraphs::default();
        tg.apply(&GraphEvent { event_id: "e1".into(), tenant_id: "t1".into(),
            kind: GraphEventKind::PipeRegistered { pipe_id: "p1".into(), from_node_id: "n1".into(), to_node_id: "n2".into(), length_m: 1.0, diameter_mm: 100, material: "HDPE".into() } });
        tg.apply(&GraphEvent { event_id: "e2".into(), tenant_id: "t1".into(),
            kind: GraphEventKind::DeviceInstalled { device_id: "d1".into(), device_type: "Valve".into(), host_pipe_id: Some("p1".into()), host_node_id: None, lat: 0.0, lng: 0.0 } });

        let bytes = to_bytes(&tg).expect("serialize");
        let mut restored = from_bytes(&bytes).expect("deserialize");

        // dedup survives
        assert!(restored.already_processed("e1"));
        // indexes were rebuilt → graph queries work and a fresh event lands correctly
        assert!(restored.tenant("t1").unwrap().pipe_has_valve("p1"));
        restored.apply(&GraphEvent { event_id: "e3".into(), tenant_id: "t1".into(),
            kind: GraphEventKind::PipeDeleted { pipe_id: "p1".into() } });
        assert!(!restored.tenant("t1").unwrap().has_pipe("p1"));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-core snapshot::tests`
Expected: FAIL — `to_bytes` / `from_bytes` not defined.

- [ ] **Step 3: Implement snapshot (de)serialization**

Prepend to `crates/topology-core/src/snapshot.rs`:

```rust
use crate::apply::TenantGraphs;

/// Serialize the whole state to JSON bytes. JSON keeps the snapshot
/// human-inspectable; switch to a binary codec only if size becomes a problem.
pub fn to_bytes(state: &TenantGraphs) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(state)
}

/// Deserialize and rebuild transient per-tenant indexes (which are `#[serde(skip)]`).
pub fn from_bytes(bytes: &[u8]) -> Result<TenantGraphs, serde_json::Error> {
    let mut state: TenantGraphs = serde_json::from_slice(bytes)?;
    state.reindex_all();
    Ok(state)
}
```

- [ ] **Step 4: Register the module**

Update `crates/topology-core/src/lib.rs` — add `pub mod snapshot;` and `pub use snapshot::{from_bytes, to_bytes};`.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p topology-core`
Expected: PASS — `snapshot::tests::round_trip...` confirms graph, dedup set, and rebuilt indexes all survive.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-core
git commit -m "feat(topology): TOP-1 snapshot serialize/deserialize with index rebuild (TOP-1)"
```

---

## Task 6: gis-be bulk export endpoint (.NET, keyset pagination)

Mirrors the bbox read pattern (Dapper DAO + `IQueryBus` + `IEndpointModule`) but unbounded-by-bbox and keyset-paginated by `id`, returning the minimal fields topology needs to rebuild a graph. Follows the GIS-4 patterns confirmed above.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Dtos/AssetExportPageDto.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IExportAssetReadDao.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/ExportAssetsQuery.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/ExportAssetsQueryHandler.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/ExportAssetReadDao.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Endpoints/AssetsEndpointModule.cs`
- Create: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ExportAssetsApiTests.cs`

- [ ] **Step 1: Define the export DTO, row, and DAO port**

Create `AssetExportPageDto.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Dtos;

/// <summary>One page of the topology rebuild export, keyset-paginated by id.</summary>
public sealed record AssetExportPageDto(
    IReadOnlyList<AssetExportItemDto> Items,
    string? NextCursor); // null when the last page is reached

public sealed record AssetExportItemDto(
    string Kind,            // Node | Pipe | Device
    string Id,
    string AssetCode,
    string? NodeType,       // Node
    string? FromNodeId,     // Pipe
    string? ToNodeId,       // Pipe
    int? DiameterMm,        // Pipe
    string? Material,       // Pipe
    double? LengthM,        // Pipe
    string? DeviceType,     // Device
    string? HostPipeId,     // Device
    string? HostNodeId);    // Device
```

Create `Ports/IExportAssetReadDao.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IExportAssetReadDao
{
    /// <summary>Returns up to <paramref name="fetchLimit"/> live assets for the
    /// tenant with id &gt; <paramref name="afterId"/>, ordered by id ascending.</summary>
    Task<IReadOnlyList<AssetExportItemDto>> QueryAsync(
        string tenantId, string? afterId, int fetchLimit, CancellationToken ct = default);
}
```

- [ ] **Step 2: Write the failing handler unit test**

Create `tests/WaterNetwork.Gis.UnitTests/Queries/ExportAssetsQueryHandlerTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Queries;

public sealed class ExportAssetsQueryHandlerTests
{
    private sealed class FakeDao(IReadOnlyList<AssetExportItemDto> rows) : IExportAssetReadDao
    {
        public Task<IReadOnlyList<AssetExportItemDto>> QueryAsync(string tenantId, string? afterId, int fetchLimit, CancellationToken ct = default)
            => Task.FromResult(rows);
    }

    private static AssetExportItemDto Node(string id) =>
        new("Node", id, "ND-" + id, "Junction", null, null, null, null, null, null, null, null);

    [Fact]
    public async Task SetsNextCursorWhenMoreRowsThanLimit()
    {
        // limit 2, DAO returns 3 (limit+1) → truncated → cursor = last *returned* (2nd) id
        var dao = new FakeDao([Node("a"), Node("b"), Node("c")]);
        var handler = new ExportAssetsQueryHandler(dao, new StubTenant("t1"));

        var page = await handler.HandleAsync(new ExportAssetsQuery(null, 2), default);

        page.Items.Should().HaveCount(2);
        page.NextCursor.Should().Be("b");
    }

    [Fact]
    public async Task NoCursorOnLastPage()
    {
        var dao = new FakeDao([Node("a")]);
        var handler = new ExportAssetsQueryHandler(dao, new StubTenant("t1"));

        var page = await handler.HandleAsync(new ExportAssetsQuery(null, 2), default);

        page.Items.Should().HaveCount(1);
        page.NextCursor.Should().BeNull();
    }

    private sealed class StubTenant(string id) : ITenantContextAccessor
    {
        public TenantContext? Current { get; set; } = new(id, null, null);
    }
}
```

Note: match `ITenantContextAccessor` / `TenantContext`'s actual shape — confirm the constructor signature in `BuildingBlocks.MultiTenancy` (the GIS-4 handler uses `tenantAccessor.Current.TenantId`); adjust `StubTenant` to the real interface members if they differ.

- [ ] **Step 3: Run to confirm failure**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests --filter ExportAssetsQueryHandlerTests`
Expected: FAIL — `ExportAssetsQuery` / handler not defined.

- [ ] **Step 4: Implement the query + handler**

Create `Queries/ExportAssetsQuery.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>Keyset export of all live assets for the caller's tenant, for
/// topology-rs full graph rebuild. Cursor is the last returned id.</summary>
public sealed record ExportAssetsQuery(string? Cursor, int Limit) : IQuery<AssetExportPageDto>;
```

Create `Queries/ExportAssetsQueryHandler.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class ExportAssetsQueryHandler(
    IExportAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<ExportAssetsQuery, AssetExportPageDto>
{
    public async Task<AssetExportPageDto> HandleAsync(ExportAssetsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Fetch limit+1 to detect whether another page exists without a COUNT.
        var rows = await readDao.QueryAsync(tenant.TenantId, query.Cursor, query.Limit + 1, ct);

        var hasMore = rows.Count > query.Limit;
        var items = hasMore ? rows.Take(query.Limit).ToList() : rows.ToList();
        var nextCursor = hasMore ? items[^1].Id : null;

        return new AssetExportPageDto(items, nextCursor);
    }
}
```

Note: confirm `UnauthorizedException.InvalidToken` and `tenant.TenantId` against the GIS-4 handler (they are used identically there).

- [ ] **Step 5: Run the unit test to green**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests --filter ExportAssetsQueryHandlerTests`
Expected: PASS (both facts).

- [ ] **Step 6: Implement the Dapper DAO**

Create `Infrastructure/Repositories/ExportAssetReadDao.cs` (keyset by `id`, ids globally comparable strings; `@afterId` empty string on first page so `id > ''` matches all):

```csharp
using Dapper;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class ExportAssetReadDao(GisDbContext dbContext) : IExportAssetReadDao
{
    private const string NodeSelect = """
        SELECT 'Node' AS Kind, n.id AS Id, n.asset_code AS AssetCode,
               n.node_type AS NodeType,
               NULL::text AS FromNodeId, NULL::text AS ToNodeId,
               NULL::int AS DiameterMm, NULL::text AS Material, NULL::double precision AS LengthM,
               NULL::text AS DeviceType, NULL::text AS HostPipeId, NULL::text AS HostNodeId
        FROM network_nodes n
        WHERE n.tenant_id = @tenantId AND n.deleted_at IS NULL AND n.id > @afterId
        """;

    private const string PipeSelect = """
        SELECT 'Pipe' AS Kind, p.id AS Id, p.asset_code AS AssetCode,
               NULL::text AS NodeType,
               p.from_node_id AS FromNodeId, p.to_node_id AS ToNodeId,
               p.diameter_mm AS DiameterMm, p.material AS Material, p.length_m AS LengthM,
               NULL::text AS DeviceType, NULL::text AS HostPipeId, NULL::text AS HostNodeId
        FROM network_pipes p
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL AND p.id > @afterId
        """;

    private const string DeviceSelect = """
        SELECT 'Device' AS Kind, d.id AS Id, d.asset_code AS AssetCode,
               NULL::text AS NodeType,
               NULL::text AS FromNodeId, NULL::text AS ToNodeId,
               NULL::int AS DiameterMm, NULL::text AS Material, NULL::double precision AS LengthM,
               d.device_type AS DeviceType, d.host_pipe_id AS HostPipeId, d.host_node_id AS HostNodeId
        FROM network_devices d
        WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL AND d.id > @afterId
        """;

    public async Task<IReadOnlyList<AssetExportItemDto>> QueryAsync(
        string tenantId, string? afterId, int fetchLimit, CancellationToken ct = default)
    {
        // Single global keyset over the union so the cursor is one opaque id
        // across all three asset kinds (ids are globally unique, decision #2).
        var sql = string.Join("\nUNION ALL\n", [NodeSelect, PipeSelect, DeviceSelect])
                  + "\nORDER BY Id\nLIMIT @fetchLimit";

        var parameters = new { tenantId, afterId = afterId ?? string.Empty, fetchLimit };
        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<AssetExportItemDto>(
            new CommandDefinition(sql, parameters, cancellationToken: ct));
        return rows.AsList();
    }
}
```

Note: `ORDER BY Id` on the outer UNION uses the projected column alias; if Postgres rejects the alias in this position, change to `ORDER BY 2` (the 2nd select column) — verify when running.

- [ ] **Step 7: Map the endpoint**

In `AssetsEndpointModule.cs`, inside `MapEndpoints`, after the existing bbox `MapGet("/")`, add:

```csharp
        group.MapGet("/export", async (
                string? cursor,
                int? limit,
                IQueryBus queryBus,
                CancellationToken ct) =>
            {
                var pageSize = Math.Clamp(limit ?? 1000, 1, 5000);
                var result = await queryBus.ExecuteAsync(new ExportAssetsQuery(cursor, pageSize), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-gis:read");
```

Add the needed `using WaterNetwork.Gis.Application.Queries;` if not already present. Register the DAO in `Program.cs` next to the bbox DAO registration: `builder.Services.AddScoped<IExportAssetReadDao, ExportAssetReadDao>();` (the handler auto-registers via `AddHandlersFromAssembly`).

- [ ] **Step 8: Write the integration test (real PostGIS)**

Create `tests/WaterNetwork.Gis.IntegrationTests/ExportAssetsApiTests.cs` modelled on `GetAssetsInBboxApiTests`: register a node + a pipe via the existing POST endpoints (or seed), then page `GET /api/network/assets/export?limit=1`, assert the first page returns one item with a non-null `nextCursor`, the second page (`?cursor=<that>`) continues, and the final page returns `nextCursor: null`. Assert 401/403 when the `network-gis:read` permission is missing (mirror the bbox auth assertions). Reuse the same `PostgisFixture` collection and auth-token helper the bbox test uses.

- [ ] **Step 9: Run gis-be tests**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests` and `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter ExportAssetsApiTests`
Expected: PASS. Also `dotnet build src/services/water-network-gis-be/WaterNetwork.Gis.slnx --nologo` → 0 warnings.

- [ ] **Step 10: Commit**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): TOP-1 keyset bulk export endpoint for topology rebuild (TOP-1)"
```

---

## Task 7: GIS rebuild HTTP client (`topology-service`)

**Files:**
- Create: `crates/topology-service/src/config.rs`
- Create: `crates/topology-service/src/gis_client.rs`
- Modify: `crates/topology-service/src/main.rs` (add `mod` declarations)

- [ ] **Step 1: Write the failing test against a mock HTTP server**

Create `crates/topology-service/src/gis_client.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use topology_core::TenantGraphs;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn pages_through_export_and_builds_graph() {
        let server = MockServer::start().await;

        // page 1: one node, cursor "node-1"
        Mock::given(method("GET"))
            .and(path("/api/network/assets/export"))
            .and(query_param("limit", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{"kind":"Node","id":"node-1","assetCode":"ND-1","nodeType":"Junction"}],
                "nextCursor": "node-1"
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // page 2: one pipe, no cursor (end)
        Mock::given(method("GET"))
            .and(path("/api/network/assets/export"))
            .and(query_param("cursor", "node-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{"kind":"Pipe","id":"pipe-1","assetCode":"PP-1","fromNodeId":"node-1","toNodeId":"node-2"}],
                "nextCursor": serde_json::Value::Null
            })))
            .mount(&server)
            .await;

        let client = GisRebuildClient::new(server.uri(), "dev-token".into(), 2);
        let mut tg = TenantGraphs::default();
        client.rebuild_tenant("t1", &mut tg).await.expect("rebuild ok");

        let g = tg.tenant("t1").unwrap();
        assert!(g.has_node("node-1"));
        assert!(g.has_pipe("pipe-1"));
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-service gis_client`
Expected: FAIL — `GisRebuildClient` not defined.

- [ ] **Step 3: Implement the rebuild client + config**

Create `crates/topology-service/src/config.rs`:

```rust
/// Service configuration sourced from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    pub amqp_url: String,
    pub queue_name: String,
    pub exchange_name: String,
    pub gis_base_url: String,
    pub gis_token: String,
    pub snapshot_path: String,
    pub http_bind: String,
    pub export_page_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        let get = |k: &str, default: &str| std::env::var(k).unwrap_or_else(|_| default.to_string());
        Config {
            amqp_url: get("TOPOLOGY_AMQP_URL", "amqp://guest:guest@rabbitmq:5672/%2f"),
            queue_name: get("TOPOLOGY_QUEUE", "water-network-topology-rs"),
            // Verified empirically in Task 8 Step 1; default is the MassTransit URN-derived name.
            exchange_name: get(
                "TOPOLOGY_EXCHANGE",
                "WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope",
            ),
            gis_base_url: get("TOPOLOGY_GIS_BASE_URL", "http://water-network-gis-be:8080"),
            gis_token: get("TOPOLOGY_GIS_TOKEN", ""),
            snapshot_path: get("TOPOLOGY_SNAPSHOT_PATH", "/app/data/topology-snapshot.json"),
            http_bind: get("TOPOLOGY_HTTP_BIND", "0.0.0.0:8080"),
            export_page_size: get("TOPOLOGY_EXPORT_PAGE_SIZE", "1000").parse().unwrap_or(1000),
        }
    }
}
```

Prepend to `crates/topology-service/src/gis_client.rs`:

```rust
use serde::Deserialize;
use topology_core::{GraphEvent, GraphEventKind, TenantGraphs};

#[derive(Debug, Deserialize)]
struct ExportPage {
    items: Vec<ExportItem>,
    #[serde(rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")] // gis-be serializes responses camelCase (ASP.NET default)
struct ExportItem {
    kind: String,
    id: String,
    node_type: Option<String>,
    from_node_id: Option<String>,
    to_node_id: Option<String>,
    diameter_mm: Option<i32>,
    material: Option<String>,
    length_m: Option<f64>,
    device_type: Option<String>,
    host_pipe_id: Option<String>,
    host_node_id: Option<String>,
}

pub struct GisRebuildClient {
    base_url: String,
    token: String,
    page_size: usize,
    http: reqwest::Client,
}

impl GisRebuildClient {
    pub fn new(base_url: String, token: String, page_size: usize) -> Self {
        GisRebuildClient { base_url, token, page_size, http: reqwest::Client::new() }
    }

    /// Page the export endpoint for one tenant and apply every item into `tg`.
    /// Synthesizes deterministic event ids (`rebuild:<tenant>:<id>`) so a later
    /// live event with the real `event_id` is never deduped against the rebuild.
    pub async fn rebuild_tenant(&self, tenant_id: &str, tg: &mut TenantGraphs) -> Result<(), anyhow::Error> {
        let mut cursor: Option<String> = None;
        loop {
            let mut req = self
                .http
                .get(format!("{}/api/network/assets/export", self.base_url))
                .query(&[("limit", self.page_size.to_string())])
                .header("X-Tenant-Id", tenant_id);
            if !self.token.is_empty() {
                req = req.bearer_auth(&self.token);
            }
            if let Some(c) = &cursor {
                req = req.query(&[("cursor", c)]);
            }
            let page: ExportPage = req.send().await?.error_for_status()?.json().await?;
            for item in &page.items {
                if let Some(kind) = item_to_kind(item) {
                    tg.apply(&GraphEvent {
                        event_id: format!("rebuild:{tenant_id}:{}", item.id),
                        tenant_id: tenant_id.to_string(),
                        kind,
                    });
                }
            }
            match page.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        Ok(())
    }
}

fn item_to_kind(item: &ExportItem) -> Option<GraphEventKind> {
    match item.kind.as_str() {
        "Node" => Some(GraphEventKind::NodeRegistered {
            node_id: item.id.clone(),
            node_type: item.node_type.clone().unwrap_or_default(),
            lat: 0.0, lng: 0.0,
        }),
        "Pipe" => Some(GraphEventKind::PipeRegistered {
            pipe_id: item.id.clone(),
            from_node_id: item.from_node_id.clone()?,
            to_node_id: item.to_node_id.clone()?,
            length_m: item.length_m.unwrap_or(0.0),
            diameter_mm: item.diameter_mm.unwrap_or(0),
            material: item.material.clone().unwrap_or_default(),
        }),
        "Device" => Some(GraphEventKind::DeviceInstalled {
            device_id: item.id.clone(),
            device_type: item.device_type.clone().unwrap_or_default(),
            host_pipe_id: item.host_pipe_id.clone(),
            host_node_id: item.host_node_id.clone(),
            lat: 0.0, lng: 0.0,
        }),
        _ => None,
    }
}
```

Add to `crates/topology-service/src/main.rs` (above `fn main`): `mod config;` and `mod gis_client;`.

- [ ] **Step 4: Run the test**

Run: `cargo test -p topology-service gis_client`
Expected: PASS — graph built from two paged responses.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-service
git commit -m "feat(topology): TOP-1 GIS export rebuild client (paged) + env config (TOP-1)"
```

---

## Task 8: lapin AMQP consumer (`topology-service`)

This is the broker-bound piece. **Step 1 empirically pins the exchange name** so we never silently consume nothing.

**Files:**
- Create: `crates/topology-service/src/state.rs`
- Create: `crates/topology-service/src/consumer.rs`
- Create: `crates/topology-service/tests/consumer_rabbitmq.rs`
- Modify: `crates/topology-service/src/main.rs` (add `mod` declarations)

- [ ] **Step 1: Empirically discover the MassTransit exchange name**

Boot the infra + gis-be and publish one event, then read RabbitMQ's actual topology:

```bash
docker compose up -d rabbitmq postgres redis water-network-gis-be
# wait for gis-be healthy, then trigger one publish (register a node via its API,
# using a dev mock JWT — reuse the token helper from the gis integration tests or
# DevJwtTokenFactory). Then inspect:
docker compose exec rabbitmq rabbitmqctl list_exchanges name type durable | grep -i integration
docker compose exec rabbitmq rabbitmqctl list_bindings | grep -i integration
```

Record the exact exchange name. Set it as the default in `config.rs` (`exchange_name`) and in the compose `TOPOLOGY_EXCHANGE` env (Task 10). Expected: a single durable `fanout` exchange whose name is the MassTransit URN form `WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope` (NOT `integration-event-envelope`). If it differs, use the observed value verbatim everywhere.

- [ ] **Step 2: Implement shared state**

Create `crates/topology-service/src/state.rs`:

```rust
use std::sync::Arc;

use tokio::sync::RwLock;
use topology_core::TenantGraphs;

/// Graph state shared between the consumer (writer) and the health server (reader).
#[derive(Clone)]
pub struct SharedState {
    pub graphs: Arc<RwLock<TenantGraphs>>,
}

impl SharedState {
    pub fn new(initial: TenantGraphs) -> Self {
        SharedState { graphs: Arc::new(RwLock::new(initial)) }
    }
}
```

- [ ] **Step 3: Write the (ignored-by-default) real-RabbitMQ integration test**

Create `crates/topology-service/tests/consumer_rabbitmq.rs`. It is `#[ignore]` so `cargo test` stays hermetic; CI/dev runs it explicitly against the compose RabbitMQ. It publishes an envelope to the discovered exchange via lapin and asserts the graph updates:

```rust
//! Run with a live RabbitMQ:  cargo test -p topology-service --test consumer_rabbitmq -- --ignored
use lapin::{options::*, types::FieldTable, BasicProperties, Connection, ConnectionProperties, ExchangeKind};

#[tokio::test]
#[ignore = "requires RabbitMQ at TOPOLOGY_AMQP_URL"]
async fn consumes_node_registered_into_graph() {
    let url = std::env::var("TOPOLOGY_AMQP_URL")
        .unwrap_or_else(|_| "amqp://guest:guest@localhost:5672/%2f".into());
    let exchange = std::env::var("TOPOLOGY_EXCHANGE")
        .expect("set TOPOLOGY_EXCHANGE to the value discovered in Step 1");

    // Build the same envelope the .NET publisher emits.
    let data = serde_json::json!({"NodeId":"itnode-1","TenantId":"itt-1","AssetCode":"ND-IT","NodeType":"Junction","Latitude":10.0,"Longitude":106.0});
    let payload = serde_json::json!({"EventType":"network.node.registered","EventVersion":1,"Data":data}).to_string();
    let envelope = serde_json::json!({
        "EventId":"it-evt-1","EventType":"network.node.registered","EventVersion":1,
        "OccurredAt":"2026-06-17T00:00:00Z","TenantId":serde_json::Value::Null,
        "Producer":"test","Payload":payload
    }).to_string();

    let conn = Connection::connect(&url, ConnectionProperties::default()).await.unwrap();
    let ch = conn.create_channel().await.unwrap();
    ch.exchange_declare(&exchange, ExchangeKind::Fanout,
        ExchangeDeclareOptions { durable: true, ..Default::default() }, FieldTable::default())
        .await.unwrap();
    ch.basic_publish("", &exchange, BasicPublishOptions::default(), envelope.as_bytes(),
        BasicProperties::default().with_content_type("application/json".into()))
        .await.unwrap();
    // NOTE: this scaffolds the publish side; the assertion that the service's
    // graph reflects the event is exercised end-to-end in Task 11. Keeping the
    // publish path here documents the exact wire bytes the consumer must accept.
}
```

(The full consume-and-assert path is verified in the Task 11 end-to-end test, which runs the actual binary. This test pins the publish bytes.)

- [ ] **Step 4: Implement the consumer**

Create `crates/topology-service/src/consumer.rs`:

```rust
use futures_util::StreamExt;
use lapin::{
    options::{BasicAckOptions, BasicConsumeOptions, ExchangeDeclareOptions, QueueBindOptions, QueueDeclareOptions},
    types::FieldTable,
    Connection, ConnectionProperties, ExchangeKind,
};
use topology_core::GraphEvent;
use tracing::{error, info, warn};

use crate::state::SharedState;

/// Connect, declare a durable queue, bind it to the fanout message exchange,
/// and apply every topology event to shared state. Acks after a successful
/// apply (or skip); a parse error is logged and acked (poison messages must not
/// block the queue — they cannot be retried into validity).
pub async fn run(
    amqp_url: &str,
    exchange: &str,
    queue: &str,
    state: SharedState,
) -> Result<(), anyhow::Error> {
    let conn = Connection::connect(amqp_url, ConnectionProperties::default()).await?;
    let channel = conn.create_channel().await?;

    // Declare both sides defensively: the exchange is durable+fanout (matches
    // MassTransit); the queue is durable so events persist while we are down.
    channel
        .exchange_declare(exchange, ExchangeKind::Fanout,
            ExchangeDeclareOptions { durable: true, ..Default::default() }, FieldTable::default())
        .await?;
    channel
        .queue_declare(queue, QueueDeclareOptions { durable: true, ..Default::default() }, FieldTable::default())
        .await?;
    channel
        .queue_bind(queue, exchange, "", QueueBindOptions::default(), FieldTable::default())
        .await?;

    let mut consumer = channel
        .basic_consume(queue, "topology-rs", BasicConsumeOptions::default(), FieldTable::default())
        .await?;
    info!(queue, exchange, "topology consumer started");

    while let Some(delivery) = consumer.next().await {
        let delivery = match delivery {
            Ok(d) => d,
            Err(e) => { error!(error = %e, "delivery error"); continue; }
        };
        match GraphEvent::from_envelope_bytes(&delivery.data) {
            Ok(Some(event)) => {
                let mut graphs = state.graphs.write().await;
                let applied = graphs.apply(&event);
                drop(graphs);
                if applied {
                    info!(event_id = %event.event_id, tenant = %event.tenant_id, "applied");
                }
            }
            Ok(None) => { /* non-topology event: ignore */ }
            Err(e) => warn!(error = %e, "skipping unparseable message (poison)"),
        }
        delivery.ack(BasicAckOptions::default()).await?;
    }
    Ok(())
}
```

Add to `main.rs`: `mod state;` and `mod consumer;`.

- [ ] **Step 5: Build (consumer compiles; ignored test is not run)**

Run: `cargo test -p topology-service` then `cargo test -p topology-service --test consumer_rabbitmq -- --list`
Expected: workspace compiles; the `consumer_rabbitmq` test is listed as ignored.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-service
git commit -m "feat(topology): TOP-1 lapin consumer binds fanout exchange, applies events idempotently (TOP-1)"
```

---

## Task 9: Warm-up, health endpoint, and `main` wiring (`topology-service`)

**Files:**
- Create: `crates/topology-service/src/warmup.rs`
- Create: `crates/topology-service/src/health.rs`
- Modify: `crates/topology-service/src/main.rs`

- [ ] **Step 1: Write the failing warm-up test**

Create `crates/topology-service/src/warmup.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use topology_core::{to_bytes, GraphEvent, GraphEventKind, TenantGraphs};

    #[tokio::test]
    async fn loads_existing_snapshot_when_present() {
        let dir = std::env::temp_dir().join(format!("topo-warmup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("snap.json");

        let mut seed = TenantGraphs::default();
        seed.apply(&GraphEvent { event_id: "e1".into(), tenant_id: "t1".into(),
            kind: GraphEventKind::NodeRegistered { node_id: "n1".into(), node_type: "J".into(), lat: 0.0, lng: 0.0 } });
        std::fs::write(&path, to_bytes(&seed).unwrap()).unwrap();

        let loaded = warm_up(path.to_str().unwrap()).await;
        assert!(loaded.tenant("t1").unwrap().has_node("n1"));
    }

    #[tokio::test]
    async fn returns_empty_when_no_snapshot() {
        let loaded = warm_up("/nonexistent/path/snap.json").await;
        assert_eq!(loaded.tenant_count(), 0);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p topology-service warmup`
Expected: FAIL — `warm_up` not defined.

- [ ] **Step 3: Implement warm-up and the periodic snapshot writer**

Prepend to `crates/topology-service/src/warmup.rs`:

```rust
use std::time::Duration;

use tracing::{info, warn};
use topology_core::{from_bytes, to_bytes, TenantGraphs};

use crate::state::SharedState;

/// Snapshot-first warm-up (decision 0018). If a snapshot file exists, load it;
/// otherwise start empty (the consumer replays the durable queue from the start,
/// and a full GIS rebuild can be triggered separately). Returns the initial state.
pub async fn warm_up(snapshot_path: &str) -> TenantGraphs {
    match std::fs::read(snapshot_path) {
        Ok(bytes) => match from_bytes(&bytes) {
            Ok(state) => {
                info!(path = snapshot_path, tenants = state.tenant_count(), version = state.version(), "warm-up: snapshot loaded");
                state
            }
            Err(e) => { warn!(error = %e, "warm-up: snapshot unreadable, starting empty"); TenantGraphs::default() }
        },
        Err(_) => { info!(path = snapshot_path, "warm-up: no snapshot, starting empty"); TenantGraphs::default() }
    }
}

/// Periodically persist the shared state to disk so the next warm-up is fast.
pub async fn snapshot_loop(state: SharedState, snapshot_path: String, every: Duration) {
    let mut tick = tokio::time::interval(every);
    loop {
        tick.tick().await;
        let bytes = { let g = state.graphs.read().await; to_bytes(&g) };
        match bytes {
            Ok(bytes) => {
                if let Some(parent) = std::path::Path::new(&snapshot_path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&snapshot_path, &bytes) {
                    warn!(error = %e, "snapshot write failed");
                }
            }
            Err(e) => warn!(error = %e, "snapshot serialize failed"),
        }
    }
}
```

- [ ] **Step 4: Run the warm-up tests**

Run: `cargo test -p topology-service warmup`
Expected: PASS (both).

- [ ] **Step 5: Implement the health endpoint**

Create `crates/topology-service/src/health.rs`:

```rust
use axum::{extract::State, routing::get, Json, Router};
use serde_json::json;

use crate::state::SharedState;

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

async fn health(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let g = state.graphs.read().await;
    Json(json!({
        "status": "ok",
        "graphVersion": g.version(),
        "tenantCount": g.tenant_count()
    }))
}
```

- [ ] **Step 6: Wire `main`**

Replace `crates/topology-service/src/main.rs` with:

```rust
mod config;
mod consumer;
mod gis_client;
mod health;
mod state;
mod warmup;

use std::time::Duration;

use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::{config::Config, state::SharedState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let cfg = Config::from_env();
    info!(?cfg.queue_name, ?cfg.exchange_name, "starting water-network-topology-rs");

    let initial = warmup::warm_up(&cfg.snapshot_path).await;
    let shared = SharedState::new(initial);

    // periodic snapshot
    tokio::spawn(warmup::snapshot_loop(shared.clone(), cfg.snapshot_path.clone(), Duration::from_secs(30)));

    // health server
    let health_state = shared.clone();
    let bind = cfg.http_bind.clone();
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind health port");
        info!(%bind, "health endpoint listening");
        axum::serve(listener, health::router(health_state)).await.expect("health server");
    });

    // consumer (foreground; reconnect-on-error loop keeps the service alive)
    loop {
        if let Err(e) = consumer::run(&cfg.amqp_url, &cfg.exchange_name, &cfg.queue_name, shared.clone()).await {
            error!(error = %e, "consumer stopped, retrying in 5s");
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}
```

- [ ] **Step 7: Build and test the whole workspace**

Run: `cargo test` (from the service dir) and `cargo build --release`
Expected: all unit/property/warm-up tests PASS; release binary builds.

- [ ] **Step 8: Lint**

Run: `cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: no warnings, formatting clean. Fix any clippy findings.

- [ ] **Step 9: Commit**

```bash
git add src/services/water-network-topology-rs/crates/topology-service
git commit -m "feat(topology): TOP-1 warm-up + periodic snapshot + health endpoint + main wiring (TOP-1)"
```

---

## Task 10: Dockerfile + docker-compose service block

**Files:**
- Create: `src/services/water-network-topology-rs/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write the multi-stage Rust Dockerfile**

Create `src/services/water-network-topology-rs/Dockerfile`:

```dockerfile
# Build the binary against the workspace at the service directory.
FROM rust:1-slim AS build
WORKDIR /build
COPY src/services/water-network-topology-rs/ ./
RUN cargo build --release -p topology-service

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/topology-service /usr/local/bin/topology-service
RUN mkdir -p /app/data
EXPOSE 8080
ENV TOPOLOGY_HTTP_BIND=0.0.0.0:8080
ENTRYPOINT ["topology-service"]
```

Note: build context is the repo root (matches the other services' compose `context: .`), so the `COPY` path is repo-relative.

- [ ] **Step 2: Add the compose service block**

In `docker-compose.yml`, add under `services:` (after `water-network-design-be`), using the next free port **8085** and the exchange name discovered in Task 8 Step 1:

```yaml
  water-network-topology-rs:
    build:
      context: .
      dockerfile: src/services/water-network-topology-rs/Dockerfile
    ports: ["8085:8080"]
    environment:
      - TOPOLOGY_AMQP_URL=amqp://guest:guest@rabbitmq:5672/%2f
      - TOPOLOGY_QUEUE=water-network-topology-rs
      - TOPOLOGY_EXCHANGE=WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope
      - TOPOLOGY_GIS_BASE_URL=http://water-network-gis-be:8080
      - TOPOLOGY_SNAPSHOT_PATH=/app/data/topology-snapshot.json
      - RUST_LOG=info
    depends_on:
      rabbitmq: { condition: service_healthy }
    networks: [wn-network]
```

(Replace `TOPOLOGY_EXCHANGE` with the verbatim value observed in Task 8 if different.)

- [ ] **Step 3: Validate compose and build the image**

Run: `docker compose config --quiet && docker compose build water-network-topology-rs`
Expected: YAML parses with no output; image builds successfully.

- [ ] **Step 4: Commit**

```bash
git add src/services/water-network-topology-rs/Dockerfile docker-compose.yml
git commit -m "feat(topology): TOP-1 multi-stage Rust Dockerfile + compose service block (port 8085) (TOP-1)"
```

---

## Task 11: End-to-end verification + docs update

**Files:**
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
- Modify: `docs/conventions/template-mapping.md`

- [ ] **Step 1: Run the full stack and verify graph reflects a real GIS event**

```bash
docker compose up -d
# wait for health, then register a node through gis-be (dev mock JWT + X-Tenant-Id),
# e.g. POST http://localhost:8081/api/network/nodes  (reuse the request shape from
# the gis integration tests). Then:
curl -s http://localhost:8085/health
```

Expected: `/health` shows `graphVersion` ≥ 1 and `tenantCount` ≥ 1 after the node (and any pipe/device) events flow gis-be → RabbitMQ → topology-rs. Register a pipe and a valve device and re-check that `graphVersion` advances. Capture the output as verification evidence (superpowers:verification-before-completion — paste the actual `/health` JSON, do not assert success without it).

- [ ] **Step 2: Run the ignored RabbitMQ publish test against the live broker**

Run: `TOPOLOGY_AMQP_URL=amqp://guest:guest@localhost:5672/%2f TOPOLOGY_EXCHANGE='<verified-name>' cargo test -p topology-service --test consumer_rabbitmq -- --ignored`
Expected: PASS (publish path works against the real exchange).

- [ ] **Step 3: Full Rust test + lint sweep**

Run (from service dir): `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: all green, no warnings.

- [ ] **Step 4: Update tracking docs**

- `docs/stories/backlog.md`: change the Phase 3 row to reflect TOP-1 done (e.g. `unsliced` → `in progress (TOP-1 done)`), and add a `## Follow-up sau TOP-1` section capturing the deferrals: service-to-service auth for export (env token → system identity/mock token factory, roadmap §15.2); multi-tenant rebuild enumeration; `valve.state.changed` (open/closed) consumption (Phase 5); snapshot store on disk → Redis; drift-reconciliation job (TOP-3); the empirically-verified exchange name.
- `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`: tick TOP-1 in the §3.3 table and the §8.3 list.
- `docs/conventions/template-mapping.md`: confirm the §9 Rust convention note (added in Task 1) reflects the final crate layout, and add the verified exchange name + the "raw-AMQP consumer binds the MassTransit fanout message exchange and double-parses Payload→Data" note for future Rust/non-.NET consumers.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(topology): TOP-1 mark done + follow-ups + verified exchange name (TOP-1)"
```

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch to merge `feature/phase3-top1-topology-scaffold` (squash/merge per repo convention) after a final review.

---

## Self-review

**Spec coverage (roadmap §8.3 TOP-1 + §4.5):**
- cargo workspace under `src/services/water-network-topology-rs/` → Task 1 ✓
- consumer events → graph → Tasks 2–4 (parse), 8 (consume), wired in 9 ✓
- proptest idempotency `apply(e); apply(e) == apply(e)` → Task 4 Step 1 ✓
- GIS bulk export endpoint → Task 6 ✓
- warm-up snapshot/rebuild → Task 5 (snapshot), 7 (rebuild client), 9 (warm-up) ✓
- Dockerfile multi-stage rust → Task 10 ✓
- decisions #4 (valve=edge attr) and #5 (snapshot+replay) → Task 0 (0017, 0018) ✓
- tenant isolation (multi-tenancy discipline, §2.3) → Task 4 `tenants_are_isolated` + payload-derived tenant ✓
- idempotency by eventId (at-least-once, §2.2) → Task 4 `duplicate_event_id_is_a_noop` ✓

**Out of scope (correctly deferred to TOP-2/TOP-3):** tonic/gRPC, `ValidateTopology`, `TraceNetwork`, `FindNearestValves`, `ComputeIsolationZone`, drift reconciliation, multi-tenant rebuild enumeration, real service-identity auth.

**Type consistency:** `GraphEvent`/`GraphEventKind` defined in Task 2 are used unchanged in Tasks 3–9. `TenantGraphs::apply` returns `bool` (Task 4) and is relied on as such in `consumer.rs` (Task 8) and `gis_client.rs` (Task 7). `to_bytes`/`from_bytes` (Task 5) are used in Task 9 warm-up/snapshot. `SharedState.graphs: Arc<RwLock<TenantGraphs>>` (Task 8 state) is read in `health.rs` and `snapshot_loop` (Task 9). Export DTO field names (`AssetExportItemDto`, camelCase on the wire) in Task 6 match the `ExportItem` serde struct in Task 7.

**Known verification points flagged inline (must confirm during execution, not assumed):**
1. Exchange name — Task 8 Step 1 empirical discovery (default is a best-effort URN guess).
2. `ITenantContextAccessor` / `TenantContext` / `UnauthorizedException.InvalidToken` exact shapes — Task 6 notes to confirm against the GIS-4 handler.
3. Postgres `ORDER BY` alias on a UNION — Task 6 Step 6 note (fallback `ORDER BY 2`).
4. gis-be response casing (camelCase assumed for `ExportItem`) — confirm against an existing endpoint response; adjust serde rename if PascalCase.
