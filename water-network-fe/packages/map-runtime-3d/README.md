# @wn/map-runtime-3d

3D map engine for the water-network fleet: **MapLibre GL** (basemap, camera, terrain,
buildings) + **deck.gl** (all network features) behind `Map3DPort`, a strict superset of
`MapEnginePort` from `@wn/map-runtime`. See `docs/decisions/0015-3d-map-runtime.md`.

```ts
import { configureMapRuntime3D } from '@wn/map-runtime-3d'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
configureMapRuntime3D({ workerUrl }) // once, at bootstrap
import 'maplibre-gl/dist/maplibre-gl.css'
```

- `createMapRuntime` (`@wn/map-runtime-3d/solid`): Solid binding, same shape as 2D.
- `createFakePort` (`@wn/map-runtime-3d/testing`, source-aliased in vitest/tsconfig).
- `Map3DPort` adds `getCamera/setCamera/set3DMode/resetNorth/onCameraChange`,
  `setBuildings`, `setTerrain`, `getVisibleBbox`.
- `FeatureStyle3D` adds optional `elevation` / `extrude` per feature.

Layout: `src/core` (engine, store, snap, interactions — no WebGL), `src/host`
(MapLibre/deck host), `src/layers` (deck layer builders), `src/testing` (fakes).

```
npm ci && npm run build   # needs ../contracts and ../map-runtime built first
npm test                  # 55 unit tests, no GPU
```

## 3D tubes and solids

A style may add `tube: { diameterM }` (LineString) or `solid: { shape, size }` (Point). When the camera is
tilted and at least at zoom `solidsMinZoom` (default 17.5, 256px-tile convention) the engine draws
real-size cylinders with flange connectors at the ends and elbow joints at bends, plus box / cylinder /
sphere solids (meter blocks, valve bodies, hydrant posts); otherwise the flat stroke / icon is used.
