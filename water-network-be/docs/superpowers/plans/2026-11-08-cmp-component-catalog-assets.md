# CMP — Component catalog as the network asset model

**Date:** 2026-11-08
**Status:** Proposed — awaiting review (decision 0028)
**Services:** building blocks, gis-be, design-be, topology-rs, asset-be, BFF (passthrough),
water-network-import, water-network-fe (contracts, editor, map)

## Outcome

Any of the 45 catalog components (and future ones) can be drawn in the editor, mapped from
CAD, validated by Design, published to GIS, shown on the map and used by topology —
with its component code and properties kept end to end.

Done when, on the local stack:
1. A CAD import with a tee, reducer, PRV, air valve, bulk meter and booster station publishes
   all six with their codes and properties, and `/api/gis/map` returns them.
2. The editor adds a butterfly valve and a washout; both are published with their codes.
3. Isolation analysis closes a gate valve and a butterfly valve but never a check valve.
4. All service test suites pass; the frontend drift test covers every catalog copy.

## Slices (each: TDD, `dotnet test` green with 0 warnings, conventional commit)

### CMP-1 Catalog building block
- [ ] `@wn/component-models`: catalog entries gain `kind` (Node/Pipe/Device), `host`
      (line/pipe/node), functional flags, and property schema (name → type, range, unit).
      `npm run codes` writes the copies for contracts, the import worker and the backend.
- [ ] `WaterPlatform.BuildingBlocks.Components`: embedded `component-codes.json`,
      `IComponentCatalog` (Get, Require, HostFor, ValidateProperties), unit tests.
- [ ] Frontend drift test covers the backend copy.

### CMP-2 gis-be model
- [ ] Domain: `ComponentCode` value object; `NetworkNode`, `NetworkPipe`, `NetworkDevice`
      carry it and `Properties`; `DeviceHost` from the catalog; `NodeType`/`DeviceType` removed.
- [ ] Persistence: `component_code` and `properties jsonb` on nodes, pipes, devices; squashed
      initial migration.
- [ ] API: register/edit requests take `componentCode` + `properties`; bbox, export,
      bootstrap and editor-assets return them (bootstrap gains a component mix).
- [ ] Events v2 with `componentCode`, flags, `properties`; `NetworkEditValidator` and
      `NetworkEditInspector` use the catalog.
- [ ] Contract and integration tests updated.

### CMP-3 design-be
- [ ] `DraftValidationService`: required `componentCode` for nodes/devices, host and DN
      rules from the catalog, property validation.
- [ ] Publication passes `componentCode` + `properties` to gis-be.

### CMP-4 topology-rs
- [ ] Consume v2 events and snapshot fields; isolation uses `isolates`.
- [ ] Tests: check valve and PRV never chosen as isolation valves.

### CMP-5 asset-be
- [ ] Registration consumer stores `componentCode`; list filter by component.

### CMP-6 CAD import worker
- [ ] Block rules map to component codes only (legacy node/device rules translated:
      Valve → GateValve, FlowMeter → BulkMeter, …); drafts carry `componentCode` +
      `properties` (DN from block attributes when mapped).
- [ ] Node-hosted devices may attach to a generated pipe-end node within tolerance.

### CMP-7 Frontend
- [ ] `@wn/contracts`: network-edits port follows the new rules; catalog schema fields.
- [ ] Editor: drafts carry component codes (valve kinds, node fittings, hydrants, new
      devices from the catalog palette); revision-ops sends `componentCode` + `properties`.
- [ ] Canonical map and 3D symbols from `componentCode`.
- [ ] Mock services follow the new contract.

### CMP-8 Verification
- [ ] Local stack reset; the four "done when" checks above, automated where possible
      (live editor test, CAD e2e script, isolation test).
- [ ] Docs: decision 0028 accepted, README and roadmap updated.
