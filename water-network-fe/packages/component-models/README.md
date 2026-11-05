# @wn/component-models

The water network component catalog, with a flat map symbol and a procedural 3D model for every
component. It feeds `@wn/map-runtime-3d` (deck.gl `IconLayer` far away, `SimpleMeshLayer` up close)
and the 2D map. Decision: [ADR 0016](../../docs/decisions/0016-component-models.md).

| Entry | Contents | Pulls in three.js |
| --- | --- | --- |
| `@wn/component-models/catalog` | 45 codes, EN/VI names, network role, ports, DN ranges, shared types | no |
| `@wn/component-models/symbols` | Symbol definitions, `symbolSVG`, `drawSymbol`, `symbolImageData` | no |
| `@wn/component-models/deck` | Mesh data for `SimpleMeshLayer`, placement matrices, icon-atlas drawing | yes |
| `@wn/component-models` | three.js models, `ComponentView` / `PipeView` (flat/3D switching for plain three.js scenes) | yes |
| `@wn/component-models/icons/<Code>.svg` | 81 SVG icons incl. status variants, `_sheet.svg` legend | no |

three.js is used only to generate geometry. `map-runtime-3d` should load `/deck` lazily (dynamic
`import()` when solids are first shown) so the default bundle only carries `/catalog` and
`/symbols` (about 12 kB minified).

## Install

Same pattern as the other packages:

```jsonc
// packages/map-runtime-3d/package.json (or apps/gis-3d)
"dependencies": { "@wn/component-models": "file:../component-models" }
```

```bash
npm --prefix packages/component-models install
npm --prefix packages/component-models run build
```

## Use with deck.gl (map-runtime-3d)

```ts
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { IconLayer } from '@deck.gl/layers';
import { getCatalogItem } from '@wn/component-models/catalog';

const deck = await import('@wn/component-models/deck');      // lazy: three.js stays out of the main chunk

// 3D, up close: one SimpleMeshLayer per (code, DN, LOD); instances carry position + matrix
const m = deck.componentMesh('GateValve', { dn: 200, segments: 14 });   // cached
new SimpleMeshLayer({
  id: 'valves-200', data: valves, mesh: m.body,
  getPosition: (d) => d.position,                                     // metre offsets from the anchor
  getTransformMatrix: (d) => deck.alongMatrix(d.pipeDir),             // +x of the model follows the pipe
  getColor: [255, 255, 255],                                          // keep the baked part colours
  material: MESH_MATERIAL, parameters: SOLID,
});
// status part (sensor ring, hydrant band, meter LED): same instances, coloured by live status
if (m.status) new SimpleMeshLayer({ id: 'valves-200:status', data: valves, mesh: m.status, getColor: (d) => STATUS_RGB[d.status], /* same position/matrix */ });

// flat, far away or top-down: draw symbols into the existing icon atlas
deck.drawSymbolCell(ctx, 'GateValve', cell.x, cell.y, 28, status);   // SCALE = 2 like icon-atlas.ts
new IconLayer({ /* … */ billboard: !deck.symbolFollowsPipe(code), getAngle: (d) => deck.symbolAngle(d.pipeDir) });
```

Choosing the mode: `deck.screenSizePx(mesh, metresPerPixel)` gives the model's size on screen.
Show the 3D mesh above about 24 px and the symbol below it, with some hysteresis. This fits the
existing `solids` switch in `buildDeckLayers`, which already hides icons while solids are shown.

Mesh frame: deck metre offsets (x east, y north, z up). Port A faces west (-x), B east (+x), a tee
branch C faces south (-y, the right of A→B), node devices stand on +z with their base port facing
down. `mesh.ports` are in that frame, for snapping in the editor and CAD import.

## Use on the 2D map

```ts
import { symbolImageData, getSymbol } from '@wn/component-models/symbols';
import { CATALOG_ITEMS, STATUSES } from '@wn/component-models/catalog';
// OpenLayers / MapLibre: register one image per code (and per status for hasStatus items)
```

Line-aligned symbols (`getSymbol(code).align === 'pipe'`) rotate with the pipe; point symbols stay upright.

## Plain three.js scenes

`createComponentView(code, opts)` and `PipeView` switch between symbol, low-poly and full model
by on-screen size (`updateViews(scene, camera, heightPx)` each frame; `setDisplayMode(scene, 'flat' | '3d' | 'auto')`).
The demo viewer uses these.

## Conventions

- Units are metres; DN in mm. Outside diameters follow ISO 2531; flanges approximate EN 1092 PN10.
  Facilities (reservoir, tank, pump station, plant) are fixed-size site models; DN sets their connections.
- Material codes match the backend: `HDPE`, `PVC`, `DuctileIron`, `Steel`, `CastIron`, `Concrete`.
- Every catalog code has a 3D builder, a symbol and the ports the catalog lists; tests enforce this.

## Scripts

| Script | Does |
| --- | --- |
| `build` | `tsc` to `dist/`, then `dist/icons/` |
| `typecheck` | `tsc --noEmit` (same strict settings as map-runtime-3d) |
| `test` | Vitest: catalog integrity, geometry at min/default/max DN, ports, DN2 ports, status parts, instancing, deck mesh conversion and frame, placement matrices, symbols |
| `demo` | Builds the catalog viewer to `demo/dist/component-models.html` (not published) |

## Open items

- Move the catalog codes and port rules to `@wn/contracts` once agreed with the backend, and re-export them here.
- Map gis-be features (device type, node kind, material, DN) to catalog codes in `prepare-layer.ts`.
- Wire `/deck` into `buildDeckLayers` behind the existing `solids` flag.
