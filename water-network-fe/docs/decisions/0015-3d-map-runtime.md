# 3D map runtime (MapLibre + deck.gl) as a sibling app

Status: accepted. Reference sample: `water-network-fe/examples/gis-3d-test`.

## Decision

Ship a 3D version of the GIS as a **separate app** (`apps/gis-3d`) backed by a new
workspace package (`packages/map-runtime-3d`, `@wn/map-runtime-3d`). The 2D app
(`apps/gis`) and `@wn/map-runtime` (OpenLayers) are not modified and keep working.

- **Engine split.** MapLibre GL owns basemap, camera, terrain and extruded
  buildings. deck.gl (non-interleaved `MapboxOverlay`) draws every network feature
  (PathLayer, IconLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer).
- **Same port.** `Map3DPort extends MapEnginePort` with camera (pitch/bearing),
  buildings, terrain and `getVisibleBbox()`. Every 2D method keeps its meaning, so
  all screens (viewer, editor, digitize, CAD import/georeference, search, layer
  control) are the 2D screens with imports pointed at the 3D package.
- **Testable core.** `MapEngine3D` (store, styles, selection, draw, modify,
  scoped geometry edit per ADR 0014, box select, OSNAP) talks to a `MapHost`
  interface. `MapLibreHost` is the real implementation; `FakeHost` makes the engine
  unit-testable without WebGL. Picking and snapping are screen-space.
- **Zoom convention.** The port keeps OpenLayers 256px-tile zoom; the host adds +1
  for MapLibre's 512px tiles, so persisted views and bbox math are unchanged.
- **Pitched viewport.** The viewer queries the real visible ground bbox
  (`getVisibleBbox`) instead of the top-down estimate, because a tilted camera
  sees more ground than `viewportToBbox` assumes.
- **Defaults.** Viewer opens tilted (pitch 55); editor and import stay top-down so
  digitizing and georeferencing keep their 2D precision. Controls let the user
  switch 2D/3D, tilt, rotate, reset north, and toggle buildings and terrain.

## Consequences

- Two apps and two runtimes to maintain; shared logic stays in `packages/*` and the
  `MapEnginePort` contract (extend the fake in both packages when it grows).
- The 3D bundle is heavy (MapLibre + deck.gl ≈ 330 kB gzip lazy chunk). It is
  loaded on demand and budgeted in `size-limit`.
- Third-party tiles: OpenFreeMap (vector/buildings) and AWS terrarium (terrain) in
  addition to the 2D basemaps; the nginx CSP allows them.
- MapLibre 6 needs its worker URL supplied at bootstrap
  (`configureMapRuntime3D({ workerUrl })`).

## Known follow-ups

- Invisible layers are excluded from snap and box select (OpenLayers included them).
- OL's `square`/`diamond` marker mapping looks inverted; the 3D engine follows the
  documented meaning (`diamond` = rotated square).
- Terrain draping of pipes is approximate (densified, z-draped); no occlusion
  against buildings.
