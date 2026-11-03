# water-network-be

Multi-service .NET 10 monorepo for the Water Network platform.

The platform's services own bounded contexts of the Vietnamese water-utility
domain (GIS, Asset, Customer, ...). They share a single set of building
blocks and ship as independently deployable containers.

## Source layout

All C# code lives under `src/`, kept separate from `docs/` and `scripts/`:

- `src/building-blocks/` — shared building blocks (Domain, Application,
  Infrastructure, MultiTenancy, EventBus, Security, Observability, WebApi,
  Testing) plus their test projects.
- `src/services/<service>/` — one folder per service. Production code lives
  in `src/services/<service>/src/` (its `Api`, `Application`, `Contracts`,
  `Domain`, `Infrastructure` projects). Tests live in
  `src/services/<service>/tests/` (`*Tests` projects). The slnx and
  Dockerfile sit at the service root.

## Quickstart

### Prerequisites

- Docker (Desktop or Engine) with the Compose plugin
- .NET 10 SDK `10.0.107` (see `global.json`)

### Bring up the full stack

```bash
docker compose up -d --build
```

This starts `postgres` (PostGIS), `redis`, `rabbitmq`, `jaeger`,
`water-network-gis-be` on port `8081`, and `water-network-asset-be` on port
`8082`. The GIS API is ready once
`curl -fsS http://localhost:8081/health` returns a healthy JSON body.

### Run the test suites

```bash
# Building blocks
dotnet test WaterPlatform.BuildingBlocks.slnx

# GIS service
dotnet test src/services/water-network-gis-be/WaterNetwork.Gis.slnx

# Asset service (run each project — dotnet test on .slnx silently runs 0 tests)
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.ContractTests/WaterNetwork.Asset.ContractTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj
```

All solutions must pass cleanly with `TreatWarningsAsErrors=true`.

## Documentation

- `docs/spec-init-01.md` — product spec (Vietnamese).
- `docs/superpowers/specs/2026-06-11-water-network-platform-design.md` —
  platform design (services, blocks, transports).
- `docs/superpowers/plans/2026-06-11-phase0-foundation-register-node.md` —
  the Phase 0 implementation plan and acceptance criteria.
- `docs/conventions/template-mapping.md` — building-blocks inventory, service
  scaffold recipe, layer rules, decisions vs the spec sample, JWT mode
  switch, mock external adapters.

## Roadmap

- **Phase 0 — Foundation (done):** monorepo, building blocks,
  `water-network-gis-be` with `POST /api/v1/gis/nodes` (register a network
  node) and `GET /api/v1/gis/nodes/{id}` (read detail). 138 tests pass.
- **Phase 1 — GIS + Asset Core (in progress):** complete `water-network-gis-be`
  (pipe, device, remove/relocate, bbox query, asset-state projection); add
  `water-network-asset-be` (asset profile + lifecycle) and `water-network-bff`
  (map overview). GIS-1–GIS-4, AST-1, AST-2 done; GIS-5, BFF-1 remaining.
  `water-network-asset-be` now exposes lifecycle endpoints under `/api/assets`
  (activate, maintenance, suspend, decommission, technical-profile, read/list).
- **Phase 2 — Design + Import:** `water-network-design-be` (project/document,
  draft assets, submit/approve, publish→GIS via event).
- **Phase 3+:** topology-rs (graph engine, Rust), incident-be, maintenance-be,
  zone-be, observation-be, hydraulic-be, customer-impact-be, reporting.
  See `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`.
