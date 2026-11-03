# Template & Convention Mapping

This document is the single source of truth for **how a new service maps to the
building blocks, the spec, and the conventions used by `water-network-gis-be`**.
It satisfies spec Phase 0 AC #7.

Future services (`water-network-asset-be`, `water-network-customer-be`, ...)
follow this guide verbatim. Anything missing here lives in:

- `docs/spec-init-01.md` — product spec.
- `docs/superpowers/specs/2026-06-11-water-network-platform-design.md` — platform
  design.
- `docs/superpowers/plans/2026-06-11-phase0-foundation-register-node.md` —
  the Phase 0 implementation plan.

## 1. Building blocks inventory

The `src/building-blocks/` folder ships every cross-cutting concern a service needs.
The table below is the source of truth for "where does X live?".

| Block | Assembly | Path | Purpose |
|---|---|---|---|
| Domain | `WaterPlatform.BuildingBlocks.Domain` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/` | `Entity`, `AggregateRoot`, `ValueObject`, domain exceptions, rules & specs |
| Application | `WaterPlatform.BuildingBlocks.Application` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Application/` | Custom `ICommandBus` / `IQueryBus` (no MediatR), `ICommandHandler`, `IQueryHandler`, pipeline behaviors |
| Infrastructure | `WaterPlatform.BuildingBlocks.Infrastructure` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/` | `PlatformDbContext`, unit-of-work, outbox, inbox, projections, cache, idempotency, SQL helpers |
| EventBus | `WaterPlatform.BuildingBlocks.EventBus` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/` | Spec-compliant envelope, `IIntegrationEventPublisher`, MassTransit + RabbitMQ transport |
| Security | `WaterPlatform.BuildingBlocks.Security` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Security/` | JWT bearer (`Mock` and `Authority` modes), `DevJwtTokenFactory`, permission policies |
| MultiTenancy | `WaterPlatform.BuildingBlocks.MultiTenancy` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.MultiTenancy/` | `ITenantContextAccessor`, header-based resolution, request scope |
| Observability | `WaterPlatform.BuildingBlocks.Observability` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Observability/` | Serilog bootstrap, OpenTelemetry traces/metrics, health check bootstrap |
| WebApi | `WaterPlatform.BuildingBlocks.WebApi` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.WebApi/` | `AddPlatformWebApi`, correlation id middleware, `IEndpointModule` + minimal API hosting, ProblemDetails |
| Testing | `WaterPlatform.BuildingBlocks.Testing` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Testing/` | `PostgisFixture`, `RabbitMqFixture` — shared Testcontainers / docker fixtures for integration tests |

### How `water-network-gis-be` uses each block

| Concern | gis-be usage |
|---|---|
| Domain | `NetworkNode` aggregate, `GeoPoint` / `AssetCode` / `NodeType` value objects, `NodeRegistered` / `NodeDeleted` domain events. See `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/`. |
| Application | `RegisterNodeCommand` + handler + FluentValidation validator; `GetNodeDetailQuery` + handler. See `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/`. |
| Infrastructure | `GisDbContext` (subclasses `PlatformDbContext`); `NetworkNodePersistenceModel` + EF configuration; `NetworkNodeRepository`; Dapper-backed `NodeReadDao`; `GisIntegrationEventMapper`. |
| EventBus | Publishes `NodeRegisteredIntegrationEvent` to the `water-network.gis` topic via outbox. |
| Security | `Jwt:Mode=Mock` in Development, role/permission policies guarding `POST /api/v1/gis/nodes`. |
| MultiTenancy | `MultiTenancy:AllowHeaderFallback=true` so dev `X-Tenant-Id` flows through. |
| Observability | Serilog console + OTel OTLP exporter to Jaeger; `/health` endpoint. |
| WebApi | `app.MapEndpointModules(...)` hosts `NodesEndpointModule`; ProblemDetails + correlation id on every 4xx/5xx. |
| Testing | `PostgisFixture` boots real PostGIS for repository / E2E tests. |

## 2. Service scaffold recipe

Mirrors the steps that produced `src/services/water-network-gis-be/` (Task 10).
Every new service repeats this recipe.

1. **Pick the slice** — the bounded context the service owns (GIS, Asset, ...).
2. **Add an `.slnx` entry** — `services/<service>/<Service>.slnx` listing
   `Domain`, `Application`, `Infrastructure`, `Api`, `Contracts` inside a
   `src/` subfolder, and `UnitTests`, `ContractTests`, `IntegrationTests`
   grouped inside a `tests/` subfolder (see
   `src/services/water-network-gis-be/WaterNetwork.Gis.slnx` for the exact
   shape). Reference the building blocks via `<ProjectReference>`.
3. **Add `global.json` to the service** if it needs a different SDK — otherwise
   inherit the repo root.
4. **Domain first (TDD)** — value objects → aggregate → domain events. Red
   tests, then green. Lives in `Domain/`.
5. **Application second (TDD)** — commands, queries, handlers, validators,
   DTOs, ports. Lives in `Application/`. Use `ICommandBus` / `IQueryBus`,
   **not MediatR**.
6. **Infrastructure third** — `DbContext` subclassing `PlatformDbContext`,
   persistence models + EF configuration, repositories, read DAOs, outbox /
   integration event mappers. Generate the first migration.
7. **Contracts** — `Contracts.Events` holds public integration event
   records; never expose domain types across service boundaries.
8. **Api fourth (TDD)** — `IEndpointModule` for each resource group,
   `Validators/`, request DTOs, `Program.cs` wiring. Add E2E tests
   (`WebApplicationFactory<Program>`) using `PostgisFixture` + `RabbitMqFixture`.
9. **Wire it up** — register handlers, validators, repositories, mappers in
   `Program.cs`. Wire minimal APIs via `MapEndpointModules`.
10. **Container** — add a `Dockerfile` next to the `.slnx` (multistage
    `sdk:10.0` → `aspnet:10.0`, expose 8080, `dotnet <Service>.Api.dll`).
    Add a service block to `docker-compose.yml` matching the existing
    `water-network-gis-be` shape.
11. **Verify** — `dotnet test <Service>.slnx` (all green, 0 warnings) and
    `docker compose config --quiet` (YAML parses).

## 3. Layer dependency rules (spec §3.3)

The dependency arrow points **inward only**. Outer layers depend on inner
layers, never the other way around.

| Layer | May depend on | Must NOT depend on |
|---|---|---|
| `Domain` | `BuildingBlocks.Domain` only | `Application`, `Infrastructure`, `Api`, EF Core, ASP.NET |
| `Application` | `Domain`, `BuildingBlocks.Application`, `BuildingBlocks.Domain`, FluentValidation | `Infrastructure`, `Api`, EF Core, ASP.NET |
| `Infrastructure` | `Application`, `Domain`, `BuildingBlocks.Infrastructure`, `BuildingBlocks.EventBus`, EF Core, Dapper | `Api` |
| `Contracts` | `BuildingBlocks.EventBus` (envelope) | any internal layer |
| `Api` | `Application`, `Infrastructure` (only for DI wiring), `Contracts`, all `BuildingBlocks.*` | reaching into `Domain` entities for HTTP shaping — map to DTOs |
| Tests | everything in their project under test + `BuildingBlocks.Testing` | n/a |

Rule of thumb: if a `using` statement looks wrong (e.g. `Domain` importing
`Microsoft.AspNetCore.*`), the dependency arrow is broken — fix it.

## 4. Decisions made vs the spec sample

The spec sketch implied a simpler stack. The Phase 0 implementation diverged
deliberately, for the reasons in the linked decisions.

| Concern | Spec sketch | Phase 0 decision | Why |
|---|---|---|---|
| CQRS dispatch | MediatR | Custom `ICommandBus` / `IQueryBus` + pipeline behaviors in `BuildingBlocks.Application` | No third-party dispatcher; pipeline behavior contract lives in our own code. |
| Auth provider | Keycloak (real) | Keycloak **mock** (`DevJwtTokenFactory` + symmetric key) in Development | Keycloak isn't deployed in Phase 0. One config flip turns it on. |
| HTTP style | ASP.NET controllers | Minimal APIs hosted through `IEndpointModule` | Less ceremony, one endpoint module per resource, no controller base classes. |
| DbContext | One `AppDbContext` per service | Services subclass `BuildingBlocks.Infrastructure.Persistence.PlatformDbContext` (abstract base) | Cross-service invariants (outbox/inbox tables, tenant id shadow property, conventions) live once. |
| Mapping | AutoMapper | Hand-written mappers (`GisIntegrationEventMapper`, `RegisterNodeRequest → Command`) | One less dependency; mappers are obvious and grep-able. |

## 5. Switching `Jwt:Mode` from Mock to Authority

Authentication is configured in `appsettings.json` under the `Jwt` section.
The block `src/building-blocks/src/WaterPlatform.BuildingBlocks.Security/ServiceCollectionExtensions.cs`
reads it and branches.

**Phase 0 default (Development):**

```json
"Jwt": {
  "Mode": "Mock"
}
```

**When Keycloak is integrated:**

```json
"Jwt": {
  "Mode": "Authority",
  "Authority": "https://keycloak/realms/water-platform",
  "Audience": "water-network-be",
  "RequireHttpsMetadata": true
}
```

Behaviour change (no code change required):

- `Mock` — `AddPlatformAuthentication` registers a symmetric-key JWT bearer
  using `DevJwtTokenFactory` for local tokens. **Production startup throws
  if Mode is `Mock`.**
- `Authority` — `AddJwtBearer` is configured with OIDC discovery against
  `Jwt:Authority`. The mock token factory and symmetric key are not
  registered.

Also update `docker-compose.yml`: the `water-network-gis-be` service gets a
`Jwt__Authority=https://keycloak/realms/water-platform` env var, a
`depends_on: keycloak: { condition: service_healthy }`, and the Keycloak
service block is added once that container is defined.

## 6. Mock external adapters

Phase 0 services are intentionally self-contained — no live Keycloak, no
MinIO/S3, no SMTP, no external master-data API. The mock seams are explicit,
and swapping them is a one-line configuration change.

| Capability | Mock | Source-of-truth file | Real replacement |
|---|---|---|---|
| Identity / auth | `DevJwtTokenFactory` + symmetric-key JWT | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Security/DevJwtTokenFactory.cs` | Keycloak realm (set `Jwt:Mode=Authority`) |
| File storage | `InMemory` cache-backed store (no real blob) | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/Caching/` | S3 / MinIO — replace via DI registration |
| Notifications | No-op publisher | `BuildingBlocks.Infrastructure` (publisher interface) | SMTP / push gateway |
| Audit log | `ILogger` sink | `BuildingBlocks.Observability/LoggingBootstrap.cs` | Centralised audit DB / SIEM |
| Master-data | Hard-coded seed values in the integration test fixtures | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Testing/` | The `master-data` service once it ships |
| Production / business data for the water industry (sản xuất / kinh doanh ngành nước) | Synthetic seed data inside `PostgisFixture` | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Testing/PostgisFixture.cs` | Real SCADA / customer / asset feeds via dedicated adapters |

**Rule for swapping a mock for a real adapter:**

1. Add a new implementation under the service's `Infrastructure/` folder
   (e.g. `S3FileStorageAdapter`).
2. Register it in `Program.cs` **instead of** the mock — keep the interface
   stable, only the registration changes.
3. Add a config flag (e.g. `FileStorage:Provider=S3`) so the mock stays
   selectable per environment.
4. Add an integration test that exercises the real adapter against a
   Testcontainers instance.

The contract between a service and the adapter never changes — only the
concrete implementation registered in DI.

## 7. New patterns introduced in GIS-1 RegisterPipe (Phase 1)

### 7.1 Value object wrapping a list of points

`PipeGeometry` (`WaterNetwork.Gis.Domain/ValueObjects/PipeGeometry.cs`) wraps
`IReadOnlyList<GeoPoint>`. Equality is defined over the entire sequence — the
`GetEqualityComponents()` override yields each point in order.  Validation
rules (too-few-points, degenerate-line) are enforced in the constructor.
The Domain layer never references NetTopologySuite — NTS coordinates are only
in Infrastructure.

Pattern rule: for any VO that owns a sequence, yield each element in
`GetEqualityComponents()` and validate the sequence invariants in the
constructor.

### 7.2 Server-side length calculator port (Application port + PostGIS impl)

`IPipeLengthCalculator` (`WaterNetwork.Gis.Application/Ports/IPipeLengthCalculator.cs`)
is an Application-layer port that keeps the handler free of geo-calculation
logic.

The Infrastructure implementation (`WaterNetwork.Gis.Infrastructure/Repositories/PipeLengthCalculator.cs`)
uses Dapper and executes:

```sql
SELECT ST_Length(geography(ST_GeomFromText(@wkt, 4326)))
```

Key implementation notes:
- `FormattableString.Invariant($"{p.Lng} {p.Lat}")` is mandatory when building
  WKT strings — comma-decimal locales (vi-VN, de-DE) would produce invalid WKT
  (`0,0009` instead of `0.0009`).
- Coordinates in WKT are `lng lat` (X Y) — matches the NTS `Coordinate(X=lng, Y=lat)`
  convention used throughout the repo.
- The `geography` cast ensures the result is in metres, not degrees.

### 7.3 Multi-event integration event mapper (registry)

`GisIntegrationEventMapper` (`WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs`)
maps several domain event types via a registry (refactored from an if-chain in
GIS-2 once the third event, `DeviceInstalled`, was added).  Pattern:

- A `private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry`
  keyed on the domain event's `EventType` string (the value `DomainEventBase`
  hard-codes per event, e.g. `"NodeRegistered"`, `"PipeRegistered"`,
  `"DeviceInstalled"`). Use `StringComparer.Ordinal` — keys are compile-time
  ASCII identifiers.
- `CanMap(string eventType)` → `Registry.ContainsKey(eventType)`.
- `Map(IDomainEvent)` → `Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null`.
- Each registry lambda is `e => e is X x ? MapX(x) : null`. The `: null` branch is
  the soft-failure path for a spoofed/mismatched `EventType` string; for a
  well-formed event the type-guard always succeeds because the key *is* the
  event's own `EventType`.
- Each event kind keeps its own private `static Map<EventKind>(...)` helper and a
  matching `…IntegrationEvent` record.

Adding a fourth event is a one-line registry entry plus a mapper helper + record.

### 7.4 API-assembly validator registration

When request validators live in the `Api` assembly (e.g.
`RegisterPipeRequestValidator` in `WaterNetwork.Gis.Api/Validators/`), they are
NOT discovered by `AddValidatorsFromAssembly(typeof(RegisterNodeCommand).Assembly)`
(which scans the Application assembly only).  A second call is required:

```csharp
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);
```

Without this, `ValidationEndpointFilter` in `AddPlatformWebApi` cannot resolve
request validators defined in the Api assembly and will silently skip them.

Rule: always register validators from both the Application assembly **and** the
Api assembly.

### 7.5 Id generation: UUID v7 (time-ordered)

Every id written to the database is generated with `Guid.CreateVersion7()`
(RFC 9562, timestamp in the leading bits) so primary keys sort by creation time
and b-tree inserts stay append-mostly:

- Aggregate ids: `$"node-{Guid.CreateVersion7():N}"`, `$"pipe-{Guid.CreateVersion7():N}"`
  (`{prefix}-{32 hex}` format unchanged) — mirror this in every new aggregate's
  `Register` factory.
- `OutboxEntry.Id` and `EventId` in both domain-event base classes
  (building-blocks) use `Guid.CreateVersion7().ToString()`.

Notes: lexicographic string order equals time order for both formats; ordering
precision is per-millisecond (ids minted in the same millisecond are not ordered
relative to each other). Never use `Guid.NewGuid()` for DB ids. Spec:
`docs/superpowers/specs/2026-06-13-uuid-v7-ids-design.md`.

### 7.6 Soft-delete pattern (GIS-3)

Reference-guard rules that require I/O live in the **handler**, not the aggregate:

1. The handler calls `repository.ExistsByXxx(...)` methods (which respect the
   `DeletedAt == null` query filter, so they count only **live** references).
2. A live reference is found → `throw new BusinessRuleException("Rule.Code", "...")` (422).
3. No live references → call `repository.DeleteAsync(id, ct)`, which internally does
   `GetByIdAsync` (query-filter applies, so a missing/already-deleted entity surfaces as
   `null` → 404 `NotFoundException`) → `aggregate.SoftDelete()` → `SaveAsync`.
4. `SoftDelete()` and the accompanying domain event (`NodeDeleted`, `PipeDeleted`,
   `DeviceDeleted`) live in the **aggregate** — not the handler.
5. The EF global query filter (`HasQueryFilter(x => x.DeletedAt == null)`) on every
   persistence model ensures soft-deleted rows are invisible to all normal queries,
   including the `Exists*` guards above.

Pattern rule: guard rules that need I/O → handler; state mutation + domain event → aggregate;
`DeleteAsync` = load (404 if absent) → SoftDelete → Save.

### 7.7 GeometryVersion append-in-transaction pattern (GIS-3)

`GeometryVersionStore.AppendAsync` **stages only** (calls `dbContext.GeometryVersions.Add(...)`)
and does **not** call `SaveChanges`. The aggregate repository's `PersistWithOutboxAsync` (in
`AggregateRepositoryBase`) opens the outbox transaction and calls `SaveChanges` exactly once,
committing the aggregate row, the outbox entry, and the staged geometry version row atomically
on the same scoped `GisDbContext`.

Key details:
- `GetNextVersionAsync` = `MAX(version) + 1` per `asset_id` (returns 1 when no rows exist).
- The database unique constraint `ux_geometry_versions_asset_version (asset_id, version)` is the
  final concurrency guard; a race between two concurrent relocates surfaces as a Postgres 23505
  error on `SaveChanges`.
- The `geometry_versions` table has no `tenant_id` column; tenant isolation is inherited from
  globally-unique asset IDs (documented in `GeometryVersionReadDao`).
- Append on `RegisterNode` (v1) uses the same store; the handler injects both
  `IGeometryVersionStore` and `INetworkNodeRepository` sharing the same scoped DbContext.
- `IGeometryVersionStore` is registered as `AddScoped` — never `AddSingleton` or `AddTransient`,
  or the DbContext sharing breaks.

Pattern rule: store stages only; aggregate repo outbox transaction commits everything on one
scoped DbContext; unique constraint guards races.

## IdempotentEnvelopeConsumer (building-block, GIS-5)

Consumer của `IntegrationEventEnvelope` kế thừa `WaterPlatform.BuildingBlocks.EventBus.Integration.IdempotentEnvelopeConsumer`:
override `ConsumerName`, `Subscribes(eventType)` (lọc EventType), và `HandleAsync(envelope, ct)` (core broker-free).
Base lo: filter EventType → inbox dedup (`IInboxMessageStore`) → gọi `HandleAsync` → mark processed.
`HandleAsync` ném lỗi ⇒ KHÔNG mark ⇒ redelivery retry. Đăng ký: `AddScoped<TConsumer>()` +
`AddPlatformEventBus(cfg, bus => bus.AddConsumer<TConsumer>())`. Ví dụ: `GisAssetRegistrationConsumer` (asset-be),
`AssetLifecycleProjectionConsumer` (gis-be).

## 8. Quick checklist for a new service

- [ ] `services/<service>/<Service>.slnx` references all 8 building blocks.
- [ ] `Domain` project has zero external NuGet deps beyond the domain block.
- [ ] `Application` uses `ICommandBus` / `IQueryBus`, not MediatR.
- [ ] `Infrastructure` DbContext extends `PlatformDbContext`.
- [ ] `Api` exposes endpoints via `IEndpointModule`; ProblemDetails + correlation
      id flow through `AddPlatformWebApi`.
- [ ] First EF migration generated and committed.
- [ ] Dockerfile + docker-compose service block follow the gis-be pattern.
- [ ] `AddValidatorsFromAssembly` called for **both** the Application assembly and
      `typeof(Program).Assembly` (see §7.4).
- [ ] Test per-project (not `dotnet test <Service>.slnx` — see SDK 10.0.107 footgun);
      `dotnet build <Service>.slnx --nologo` reports 0 warnings
      (`TreatWarningsAsErrors=true` is on at the repo root).
- [ ] All DB ids generated with `Guid.CreateVersion7()` (see §7.5) — never
      `Guid.NewGuid()`.
- [ ] This document is updated if the service introduces a new pattern.

## 9. Rust service convention (topology-rs, Phase 3)

Rust services live under `src/services/<name>-rs/` as a self-contained Cargo workspace (a deliberate divergence from the .NET `.slnx` recipe above; recorded here per §2's rule that new scaffolds update this doc). The workspace has two crates: a pure `*-core` library (no I/O, unit tests + proptest property tests) and a `*-service` binary (all async runtime, RabbitMQ consumer via `lapin`, HTTP via `axum`). A multi-stage Rust Dockerfile (`rust:stable` build → minimal runtime image) and a `docker-compose` service block follow the same shape as the .NET services. These services integrate with the rest of the platform exclusively via the shared integration event envelope (RabbitMQ topic) and, later, gRPC protobuf contracts — they never touch another service's database or import another service's crate.

**Consuming MassTransit events from a non-.NET (raw-AMQP) service** (TOP-1): the .NET publisher (`MassTransitIntegrationEventPublisher`) publishes the CLR type `IntegrationEventEnvelope` to a single durable **fanout** exchange. With the default entity-name formatter (no custom `IEntityNameFormatter` in `MassTransitConfiguration.cs`), the exchange name is the message-type URN form `WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope` (NOT a kebab-cased name — `SetKebabCaseEndpointNameFormatter` only renames consumer *queues*, not message exchanges). A raw-AMQP consumer (e.g. `lapin`) must: declare a durable queue (e.g. `water-network-topology-rs`), declare that fanout exchange, bind the queue to it with an empty routing key, and filter by the envelope's `EventType` in code (there is no broker-side routing). Wire shape: the envelope is **PascalCase**; its `Payload` field is a **JSON string** (double-encoded) whose decoded form is `{ EventType, EventVersion, …, Data: {…} }` — so the consumer parses the envelope, then parses `Payload`, then reads `.Data`. Tenant is taken from `Data.TenantId` (the envelope `TenantId` is null for outbox-published events — see decision 0013). Idempotency is by `EventId`. This default exchange name was confirmed end-to-end against a live RabbitMQ in TOP-1 (the Rust consumer declared/bound it and consumed a published envelope); re-confirm the gis-be publisher uses the identical name when the full compose stack can run on free ports (local dev currently shares ports 5432/5672 with the `platform-core` stack).

**Exposing gRPC from a Rust service** (TOP-2): the topology service serves gRPC (tonic) on `TOPOLOGY_GRPC_BIND` (default `0.0.0.0:50051`, compose-mapped) alongside its RabbitMQ consumer and HTTP `/health`. The contract is `proto/topology.proto` (package `waternetwork.topology.v1`), compiled by `tonic-build` in `build.rs`; `protoc` is supplied by the `protoc-bin-vendored` crate (a build-dependency) so neither local dev nor the Docker build needs a system `protoc` — `build.rs` sets the `PROTOC` env from `protoc_bin_vendored::protoc_bin_path()`. The standard `grpc.health.v1.Health` service is registered via `tonic-health`. Generated code lives in `src/proto.rs` (`tonic::include_proto!`) with a module-level `#![allow(clippy::all)]` so the `-D warnings` gate ignores generated code. The `.proto` is the cross-language contract: a future .NET caller (INC-2) references the same file for its client + contract test; tenant is an explicit `tenant_id` request field (not metadata). As of TOP-3 the service exposes 4 RPCs: `ValidateTopology`, `TraceNetwork`, `FindNearestValves`, and `ComputeIsolationZone` (valve-segment isolation — BFS over valveless pipes, close boundary valves).

## 10. .NET gRPC client to a Rust service (INC-2)

`water-network-incident-be` is the platform's first .NET→Rust gRPC caller: `RequestIsolationAnalysis`
invokes topology-rs `ComputeIsolationZone`. The pattern (decision 0023):

- **Reference the owning service's committed `.proto`**, never copy it. The incident `Infrastructure`
  csproj points `Grpc.Tools` at `src/services/water-network-topology-rs/proto/topology.proto` with
  `<Protobuf GrpcServices="Client" />` (client stubs only — the Rust side owns the server). The `.proto`
  is the single cross-language contract (see §9).
- **Generated C# namespace = PascalCase of the proto package**: `package waternetwork.topology.v1;`
  → C# namespace `Waternetwork.Topology.V1`. No `csharp_namespace` option is set, so this mapping is
  automatic — expect that exact casing in the adapter's `using`.
- **Adapter wiring**: register via `AddGrpcClient<...>` against `Topology:BaseUrl`
  (`http://water-network-topology-rs:50051`), attach a `ServiceConfig` with a gRPC **retry policy**, and
  apply a **per-call deadline** (`Topology:DeadlineSeconds`) inside the adapter. Transport/deadline
  failure surfaces as an `AnalysisFailed` plan (retryable), not an unhandled exception.
- **Provider swap**: `Topology:Provider` selects `Grpc` (`GrpcTopologyAnalysisAdapter`) vs `Stub` in DI,
  mirroring the `GisLookup:Provider` Stub/real seam (§6) — tests and offline dev run on the stub, compose
  runs on `Grpc`.
- **Contract test = Testcontainers building the real Rust image**: the contract test builds the topology
  image (build context = git root, so the multi-stage Dockerfile resolves the workspace) and asserts gRPC
  **wire compatibility** — an empty-graph / unknown-tenant call returns a well-formed empty result. This
  closes the .NET-client-contract-test deferral recorded in decision 0019. First cold build is slow
  (~5 min); CI needs Docker.
- **Serialize the container contract test**: put it in the **same xUnit collection** as the service's
  other Testcontainers tests (shared collection = no parallel run) to avoid a concurrent docker-tar /
  image-build race when two tests build images at once.
