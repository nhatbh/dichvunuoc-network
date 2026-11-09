# 0028 — Component catalog as the network asset model

Date: 2026-11-08. Status: Accepted (implemented on feat/integration-p0, plan CMP).

## Context

GIS stores three asset kinds with closed type lists: `NodeType` (Junction, Reservoir, Tank,
Hydrant, Other) and `DeviceType` (Valve, FlowMeter, PressureSensor, Pump, Hydrant), plus a
host matrix hard-coded in three places (gis-be `DeviceHost`, design-be
`DraftValidationService`, the import worker). Everything else a utility draws — tees,
reducers, bends, air valves, washouts, PRVs, check valves, bulk meters, customer meters,
booster stations — either cannot be stored or collapses into `Other`, and any attribute
outside the fixed columns (DN of a fitting, valve state, install year, elevation) is dropped
at publication.

The frontend already owns a 45-entry component catalog (`@wn/component-models`, decision 7 of
the integration plan: the frontend package is the authority for component codes). The CAD
import worker and the editor can name those codes; the backend cannot keep them.

The platform has no production data yet, so the model can change without a data migration.

## Decision

1. **Every GIS asset has a component code.** `componentCode` replaces `NodeType` and
   `DeviceType` in gis-be's domain, API, events and storage. The asset kind (Node, Pipe,
   Device) follows from the code. Pipes use `Pipe`.
2. **One catalog, generated, embedded.** The code list (`component-codes.json`, generated
   by `@wn/component-models`) is embedded in a new building block
   `WaterPlatform.BuildingBlocks.Components`. It answers, per code: kind, host rule,
   DN range, which properties apply, and functional flags. gis-be, design-be and the
   import worker validate against their copy; a test in the frontend fails when any copy
   differs from the source.
3. **Kinds by role.** Fittings and facilities are **Nodes** (a facility is a node of the
   hydraulic graph). In-line components (valves, meters, pumps, strainers) are **Devices on a
   pipe**; point devices (hydrants, air valves, washouts, sensors, customer meters) are
   **Devices on a node**. The host rule comes from the catalog, not from code in each
   service. Pumps move from node-hosted to pipe-hosted, matching how EPANET models them.
4. **Functional flags instead of type checks.** Consumers ask what a component does, not
   what it is called: `isolates` (operable to close a pipe: gate, butterfly, ball, service
   valves), `controls` (PRV, PSV, FCV, altitude, check), `meters`, `senses`, `pumps`,
   `fireFlow`, `stores`, `supplies`. Topology isolation uses `isolates`.
5. **Typed properties per asset.** Nodes, pipes and devices get a `properties` JSON column
   for catalog-declared properties (DN, second DN, material, angle, valve state, year,
   condition, elevation, DMA). Keys and value types are validated against the catalog;
   unknown keys are rejected, not silently stored.
6. **Versioned contracts.** Events keep their types (`network.node.registered`, …) with
   `EventVersion` 2 and v2 payloads (`NetworkNodeRegisteredV2`, …) carrying `componentCode`, the
   functional flags and `properties`. Requests take `componentCode` + `properties`. v1 is
   removed, not dual-published: there are no external consumers yet.
7. **Fresh schema.** gis-be's migrations are squashed into one initial migration with the
   new columns; development databases are recreated (`run-gis-3d-local-stack.cmd -Reset`).

8. **Attribute bags.** Drafts (CAD import, editor, design) carry the code as attribute
   `componentCode` and catalog properties as further attributes. Attributes no component
   declares (provenance, pipe columns) are ignored; a property of another component (a setpoint on
   a gate valve) is rejected (`IComponentCatalog.ValidateAttributes`, mirrored in
   `@wn/contracts/catalog`).

## Consequences

- Adding a component is a catalog change (frontend package + regenerated copies), not a
  backend release, unless it needs a new functional flag.
- Topology, design validation, the import worker and the editor all read the same host and
  property rules.
- asset-be keeps `AssetType` Node/Pipe/Device and gains `componentCode` on registration so
  asset profiles can be filtered by component.
- Existing development data is discarded.
- Point devices drawn on a pipe (CAD import, editor) attach to the nearest pipe-end node.
- The legacy `apps/gis` frontend still sends `nodeType`/`deviceType`; it is retired, not ported.
