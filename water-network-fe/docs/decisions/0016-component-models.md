# 0016 Component models package

Date: 2026-11-06

## Status

Proposed

## Context

The platform is being re-scoped around pressure monitoring, demand-based production
planning and leak/maintenance markers. All three need a properly connected network:
every pipe ends on a node, devices sit on pipes or nodes, and DMA boundaries are
metered or closed. The 3D GIS today draws pipes as tubes and points as generic
boxes, cylinders and spheres (`map-runtime-3d/src/layers/meshes.ts`), and the editor,
CAD import and backend each spell component types differently.

## Decision

Add `packages/component-models` (`@wn/component-models`), a workspace package that
owns the component catalog and both display modes for every component:

- `/catalog`: 45 component codes with English and Vietnamese names, network role
  (line, node, in-line device, node device, facility), port ids, DN range and flags.
  No runtime dependency.
- `/symbols`: one flat symbol per code (SVG and canvas). Used by the 2D map and by
  `map-runtime-3d` icons when the camera is far away or top-down.
- `/deck`: procedural 3D mesh per code, sized from DN, as plain `SimpleMeshLayer`
  attribute data with baked part colours, a separate status part for live state,
  and ports in deck's metre-offset frame. three.js is used only to generate
  geometry; this entry is loaded lazily.
- Display rule: the flat symbol when the model is under about 24 px on screen, the
  3D mesh above that, matching the existing `solids` switch in `buildDeckLayers`.

## Alternatives Considered

1. glTF asset files per component: rejected; one file per size and LOD, and no ports.
2. Extend `meshes.ts` in map-runtime-3d: rejected; the 2D map, editor and import
   also need the catalog and symbols, without deck.gl.
3. Put the catalog in `@wn/contracts` now: deferred until the backend agrees on codes.

## Consequences

Positive:

- One list of component codes, ports and symbols across 2D, 3D, editor and import.
- Ports give the editor and CAD import something concrete to snap and validate against.
- No asset pipeline: any DN renders from code.

Tradeoffs:

- three.js (geometry only) becomes a dependency of the lazy 3D path.
- Mesh layers are per (code, DN, LOD); scenes with many distinct sizes create more layers.

## Follow-Up

- Move catalog codes and port rules into `@wn/contracts`; re-export from this package.
- Map gis-be feature types and DN to catalog codes in `prepare-layer.ts`.
- Wire `/deck` meshes and symbols into `buildDeckLayers` behind `solids`.
- Bind the status part to observation-be readings.
