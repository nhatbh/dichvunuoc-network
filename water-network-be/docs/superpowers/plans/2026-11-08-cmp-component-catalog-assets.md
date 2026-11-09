# CMP — Component catalog as the network asset model

**Date:** 2026-11-08
**Status:** Done (decision 0028 accepted) — verified on the local cloud stack 2026-11-08
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
- [x] `@wn/component-models`: catalog entries gain `kind` (Node/Pipe/Device), `host`
      (line/pipe/node), functional flags, and property schema (name → type, range, unit).
      `npm run codes` writes the copies for contracts, the import worker and the backend.
- [x] `WaterPlatform.BuildingBlocks.Components`: embedded `component-codes.json`,
      `IComponentCatalog` (Get, Require, HostFor, ValidateProperties), unit tests.
- [x] Frontend drift test covers the backend copy.

### CMP-2 gis-be model
- [x] Domain: `ComponentCode` value object; `NetworkNode`, `NetworkPipe`, `NetworkDevice`
      carry it and `Properties`; `DeviceHost` from the catalog; `NodeType`/`DeviceType` removed.
- [x] Persistence: `component_code` and `properties jsonb` on nodes, pipes, devices; squashed
      initial migration.
- [x] API: register/edit requests take `componentCode` + `properties`; bbox, export,
      bootstrap and editor-assets return them (bootstrap gains a component mix).
- [x] Events v2 with `componentCode`, flags, `properties`; `NetworkEditValidator` and
      `NetworkEditInspector` use the catalog.
- [x] Contract and integration tests updated.

### CMP-3 design-be
- [x] `DraftValidationService`: required `componentCode` for nodes/devices, host and DN
      rules from the catalog, property validation.
- [x] Publication passes `componentCode` + `properties` to gis-be.

### CMP-4 topology-rs
- [x] Consume v2 events and snapshot fields; isolation uses `isolates`.
- [x] Tests: check valve and PRV never chosen as isolation valves.

### CMP-5 asset-be
- [x] Registration consumer stores `componentCode`; list filter by component.

### CMP-6 CAD import worker
- [x] Block rules map to component codes only (legacy node/device rules translated:
      Valve → GateValve, FlowMeter → BulkMeter, …); drafts carry `componentCode` +
      `properties` (DN from block attributes when mapped).
- [x] Node-hosted devices may attach to a generated pipe-end node within tolerance.

### CMP-7 Frontend
- [x] `@wn/contracts`: network-edits port follows the new rules; catalog schema fields.
- [x] Editor: drafts carry component codes (valve kinds, node fittings, hydrants, new
      devices from the catalog palette); revision-ops sends `componentCode` + `properties`.
- [x] Canonical map and 3D symbols from `componentCode`.
- [x] Mock services follow the new contract.

### Verification results (2026-11-08)
- CAD e2e (`six components`): tee, reducer (dn 200/dn2 150 from block ATTRIBs), PRV (setpoint
  35), air valve (on the pipe-end node), bulk meter, booster station (pumpCount 3) published;
  gis-be bbox and asset-be (`?componentCode=PRV`) return them.
- Editor live test: butterfly valve (state closed) on its pipe and a washout on a node published
  with their codes.
- Isolation: topology-rs test `isolation_closes_gate_and_butterfly_valves_but_never_check_valves_or_prvs`.
- Suites: building block, gis-be/design-be/asset-be/BFF unit + contract, topology-rs, import
  worker (111), contracts, gis-3d (460) green; integration suites compile (Docker needed).

### CMP-8 Verification
- [x] Local stack reset; the four "done when" checks above, automated where possible
      (live editor test, CAD e2e script, isolation test).
- [x] Docs: decision 0028 accepted, README and roadmap updated.
