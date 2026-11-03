# GIS Core — Viewer Expansion (slice 2.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the GIS viewer with a `map-shell` layout, a live coordinate bar, a layer/basemap control, and feature search — all behind the existing `MapEnginePort`, keeping `ol` in its lazy chunk.

**Architecture:** Lift port ownership from `map-canvas` to a route-scoped `MapRuntimeProvider` (Solid context in `shared/lib/map-runtime`). `map-canvas` slims to a feature-pusher; three new features (`coordinate-readout`, `layer-control`, `feature-search`) consume the same port via context. The port grows by exactly four methods (`onPointerMove`, `setLayerVisible`, `setBasemap`, `fitToBbox`). Search is a mock endpoint with a Zod-parsed `FeatureSearchResults` contract; selecting a hit calls `fitToBbox` and emits `onSelect(id)` upward, which the page wires to the selection store. Layout uses floating overlays over the map; properties-palette stays the right sidebar.

**Tech Stack:** SolidJS, OpenLayers (behind port), TanStack Solid Query, Zod (`@wn/contracts`), MSW (mocks), Vitest + `@solidjs/testing-library`, ESLint boundaries + size-limit gates.

**Spec:** `docs/superpowers/specs/2026-06-15-gis-core-viewer-expansion-design.md`

---

## Conventions for every task

- **Test-first (TDD):** write the failing test, run it red, implement, run it green, commit.
- **Commit trailer:** every commit ends with a second `-m` trailer:
  `-m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`.
- **`file:` dep rebuilds:** `@wn/map-runtime` and `@wn/contracts` are consumed from `dist/`. After editing either package's `src`, rebuild it before gis-core can see the change (build steps are explicit below).
- **Commands** (run from repo root unless noted):
  - contracts: `npm run contracts:test`, `npm run contracts:build`
  - map-runtime: `npm --prefix packages/map-runtime run test`, `npm --prefix packages/map-runtime run build`
  - gis-core all tests: `npm --prefix apps/gis-core run test:run`
  - gis-core one file: `npm --prefix apps/gis-core run test:run -- <path>`
  - gis-core gates: `npm --prefix apps/gis-core run typecheck` · `run lint` · `run build` · `run size`

---

## File Structure

**`packages/map-runtime/src/`**
- `port/types.ts` — MODIFY: add `Extent`, `FitOptions`.
- `port/map-engine-port.ts` — MODIFY: add 4 method signatures.
- `basemaps.ts` — CREATE: plain `BasemapId`, `BasemapInfo`, `BASEMAPS` (no `ol`).
- `openlayers/basemaps.ts` — CREATE: `createBasemapSource(id)` (imports `ol` sources; lives in the lazy chunk).
- `openlayers/ol-map-adapter.ts` — MODIFY: implement 4 methods; hold base-layer ref.
- `index.ts` — MODIFY: re-export `Extent`, `FitOptions`, `BasemapId`, `BasemapInfo`, `BASEMAPS`.

**`packages/contracts/src/`**
- `map-features/index.ts` — MODIFY: add `FeatureSearchResult`, `FeatureSearchResults`.
- `testing/index.ts` — MODIFY: add `aFeatureSearchResults`.

**`apps/gis-core/src/`**
- `shared/api/query-keys.ts` — MODIFY: add `mapFeatures.search`.
- `shared/api/mocks/handlers.ts` — MODIFY: shared fixture + `GET /snapshot/:id/search`.
- `entities/map-feature/{model/types.ts,api/queries.ts,index.ts}` — MODIFY: search query + types.
- `shared/lib/map-runtime/{map-runtime-context.tsx,index.ts}` — CREATE: provider + context.
- `features/map-canvas/ui/map-canvas.tsx` — MODIFY: consume context, drop `mapFactory`.
- `features/coordinate-readout/{ui/coordinate-readout.tsx,index.ts}` — CREATE.
- `features/layer-control/{ui/layer-control.tsx,index.ts}` — CREATE.
- `features/feature-search/{ui/feature-search.tsx,index.ts}` — CREATE.
- `widgets/map-shell/{ui/map-shell.tsx,index.ts}` — CREATE.
- `pages/gis/index.tsx` — MODIFY: wrap in provider, compose shell.

---

## Task 1: Port surface — `Extent`, `FitOptions`, 4 new methods

**Files:**
- Modify: `packages/map-runtime/src/port/types.ts`
- Modify: `packages/map-runtime/src/port/map-engine-port.ts`
- Test: `packages/map-runtime/src/port/map-engine-port.test.ts`

- [ ] **Step 1: Extend the contract test (red).** Add a fake implementation of the new methods and assertions. Append inside the existing `describe('MapEnginePort contract', ...)` block and extend `makeFake`:

Replace the `makeFake` return object and add tests so the file reads:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { MapEnginePort } from './map-engine-port.js';
import type { Coordinate, Viewport } from './types.js';

type FakePort = MapEnginePort & {
  emitClick: (id: string) => void;
  emitPointer: (c: Coordinate | null) => void;
  visible: Map<string, boolean>;
  basemap: string;
  lastFit: [number, number, number, number] | null;
};

function makeFake(): FakePort {
  let view: Viewport = { center: { lon: 0, lat: 0 }, zoom: 1 };
  let selected: string | null = null;
  const subs = new Set<(id: string) => void>();
  const pointerSubs = new Set<(c: Coordinate | null) => void>();
  const fake: FakePort = {
    mount: vi.fn(),
    setView: (v) => { view = v; },
    getView: () => view,
    setFeatures: vi.fn(),
    setSelection: (id) => { selected = id; },
    getSelection: () => selected,
    onFeatureClick: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    onPointerMove: (cb) => { pointerSubs.add(cb); return () => pointerSubs.delete(cb); },
    setLayerVisible: (id, v) => { fake.visible.set(id, v); },
    setBasemap: (id) => { fake.basemap = id; },
    fitToBbox: (extent) => { fake.lastFit = extent; },
    destroy: vi.fn(),
    emitClick: (id) => subs.forEach((c) => c(id)),
    emitPointer: (c) => pointerSubs.forEach((cb) => cb(c)),
    visible: new Map<string, boolean>(),
    basemap: 'osm',
    lastFit: null,
  };
  return fake;
}

describe('MapEnginePort contract', () => {
  it('round-trips the viewport', () => {
    const p = makeFake();
    p.setView({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(p.getView().zoom).toBe(12);
  });

  it('reflects selection', () => {
    const p = makeFake();
    p.setSelection('x');
    expect(p.getSelection()).toBe('x');
  });

  it('notifies + unsubscribes feature clicks', () => {
    const p = makeFake();
    const seen: string[] = [];
    const off = p.onFeatureClick((id) => seen.push(id));
    p.emitClick('a'); off(); p.emitClick('b');
    expect(seen).toEqual(['a']);
  });

  it('notifies + unsubscribes pointer moves (null on leave)', () => {
    const p = makeFake();
    const seen: (Coordinate | null)[] = [];
    const off = p.onPointerMove((c) => seen.push(c));
    p.emitPointer({ lon: 105.8, lat: 21 });
    p.emitPointer(null);
    off();
    p.emitPointer({ lon: 0, lat: 0 });
    expect(seen).toEqual([{ lon: 105.8, lat: 21 }, null]);
  });

  it('records layer visibility, basemap, and fit', () => {
    const p = makeFake();
    p.setLayerVisible('published', false);
    p.setBasemap('carto-light');
    p.fitToBbox([105.7, 20.9, 106.0, 21.1]);
    expect(p.visible.get('published')).toBe(false);
    expect(p.basemap).toBe('carto-light');
    expect(p.lastFit).toEqual([105.7, 20.9, 106.0, 21.1]);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/port/map-engine-port.test.ts`
Expected: FAIL — `onPointerMove`/`setLayerVisible`/`setBasemap`/`fitToBbox` not on `MapEnginePort`.

- [ ] **Step 3: Add types to `port/types.ts`.**

```ts
export interface Coordinate { lon: number; lat: number }
export interface Viewport { center: Coordinate; zoom: number }

export interface MapViewOptions {
  center: Coordinate;
  zoom: number;
  /** View projection EPSG code; defaults to EPSG:3857. */
  projection?: string;
  minZoom?: number;
  maxZoom?: number;
}

/** Geographic extent [minLon, minLat, maxLon, maxLat] in EPSG:4326. */
export type Extent = [number, number, number, number];

export interface FitOptions {
  /** Uniform pixel padding around the fitted extent. */
  padding?: number;
  /** Cap the zoom level the fit may reach. */
  maxZoom?: number;
}
```

- [ ] **Step 4: Add the 4 methods to `port/map-engine-port.ts`.**

```ts
import type { FeatureCollection } from 'geojson';
import type { Coordinate, Extent, FitOptions, Viewport } from './types.js';

/**
 * Anti-corruption boundary for the map engine. ZERO `ol` types cross this
 * interface — only `packages/map-runtime/src/openlayers/*` imports `ol`. Each MFE
 * creates its own instance via the factory; a live map is never shared across apps.
 */
export interface MapEnginePort {
  mount(target: HTMLElement): void;
  setView(view: Viewport): void;
  getView(): Viewport;
  /** Render a vector layer (e.g. 'published') from a GeoJSON FeatureCollection (EPSG:4326). */
  setFeatures(layerId: string, features: FeatureCollection): void;
  /** Highlight a feature by id (null clears). */
  setSelection(featureId: string | null): void;
  getSelection(): string | null;
  /** Subscribe to feature clicks; returns an unsubscribe fn. */
  onFeatureClick(cb: (featureId: string) => void): () => void;
  /** Subscribe to pointer moves (lon/lat); cb receives null when the pointer leaves the map. Returns unsubscribe. */
  onPointerMove(cb: (coordinate: Coordinate | null) => void): () => void;
  /** Toggle a vector layer's visibility. */
  setLayerVisible(layerId: string, visible: boolean): void;
  /** Switch the basemap by id (see BASEMAPS catalog). */
  setBasemap(basemapId: string): void;
  /** Fit the view to a geographic extent (EPSG:4326). */
  fitToBbox(extent: Extent, opts?: FitOptions): void;
  destroy(): void;
}
```

- [ ] **Step 5: Run green.** `npm --prefix packages/map-runtime run test -- src/port/map-engine-port.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit.**

```bash
git add packages/map-runtime/src/port
git commit -m "feat(map-runtime): grow MapEnginePort by onPointerMove/setLayerVisible/setBasemap/fitToBbox" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Basemap catalog (plain, no `ol`)

**Files:**
- Create: `packages/map-runtime/src/basemaps.ts`
- Modify: `packages/map-runtime/src/index.ts`
- Test: `packages/map-runtime/src/basemaps.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { BASEMAPS } from './basemaps.js';

describe('BASEMAPS catalog', () => {
  it('lists osm, carto-light, and none with labels', () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(['osm', 'carto-light', 'none']);
    expect(BASEMAPS.every((b) => b.label.length > 0)).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/basemaps.test.ts`
Expected: FAIL — cannot find `./basemaps.js`.

- [ ] **Step 3: Create `src/basemaps.ts`.**

```ts
/** Basemap catalog — PLAIN data, no `ol`. Consumed by layer-control for labels
 * without pulling the engine chunk. The `ol` source factory lives in
 * `openlayers/basemaps.ts` behind the lazy adapter chunk. */
export type BasemapId = 'osm' | 'carto-light' | 'none';

export interface BasemapInfo {
  id: BasemapId;
  label: string;
}

export const BASEMAPS: readonly BasemapInfo[] = [
  { id: 'osm', label: 'OSM Standard' },
  { id: 'carto-light', label: 'Carto Light' },
  { id: 'none', label: 'None' },
];
```

- [ ] **Step 4: Re-export from `src/index.ts`.**

```ts
export type { MapEnginePort } from './port/map-engine-port.js';
export type { Coordinate, Viewport, MapViewOptions, Extent, FitOptions } from './port/types.js';
export type { BasemapId, BasemapInfo } from './basemaps.js';
export { BASEMAPS } from './basemaps.js';
export { createMapInstance } from './factory.js';
```

- [ ] **Step 5: Run green.** `npm --prefix packages/map-runtime run test -- src/basemaps.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

```bash
git add packages/map-runtime/src/basemaps.ts packages/map-runtime/src/basemaps.test.ts packages/map-runtime/src/index.ts
git commit -m "feat(map-runtime): plain BASEMAPS catalog (osm/carto-light/none) exported ol-free" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: OpenLayers basemap source factory (in the lazy chunk)

**Files:**
- Create: `packages/map-runtime/src/openlayers/basemaps.ts`
- Test: `packages/map-runtime/src/openlayers/basemaps.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { createBasemapSource } from './basemaps.js';

describe('createBasemapSource', () => {
  it('builds an OSM source for "osm"', () => {
    expect(createBasemapSource('osm')).toBeInstanceOf(OSM);
  });
  it('builds an XYZ source for "carto-light"', () => {
    expect(createBasemapSource('carto-light')).toBeInstanceOf(XYZ);
  });
  it('returns null for "none"', () => {
    expect(createBasemapSource('none')).toBeNull();
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/openlayers/basemaps.test.ts`
Expected: FAIL — cannot find `./basemaps.js`.

- [ ] **Step 3: Create `src/openlayers/basemaps.ts`.** This is the only new `ol`-importing file; it is reachable only from the lazily-imported adapter, so it stays in the `ol-map-adapter-*` chunk.

```ts
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import type TileSource from 'ol/source/Tile';
import type { BasemapId } from '../basemaps.js';

/** Build the `ol` tile source for a basemap id. `none` → null (blank background). */
export function createBasemapSource(id: BasemapId): TileSource | null {
  switch (id) {
    case 'osm':
      return new OSM();
    case 'carto-light':
      return new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors, © CARTO',
      });
    case 'none':
      return null;
  }
}
```

- [ ] **Step 4: Run green.** `npm --prefix packages/map-runtime run test -- src/openlayers/basemaps.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/map-runtime/src/openlayers/basemaps.ts packages/map-runtime/src/openlayers/basemaps.test.ts
git commit -m "feat(map-runtime): ol basemap source factory (osm/carto-light/none)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Implement the 4 methods in `OlMapAdapter` + build the package

**Files:**
- Modify: `packages/map-runtime/src/openlayers/ol-map-adapter.ts`
- Test: `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

- [ ] **Step 1: Extend the adapter test (red).** Append these cases inside `describe('OlMapAdapter (smoke, jsdom)', ...)` (the `beforeAll` canvas/ResizeObserver stubs and `fc` already exist):

```ts
  it('fitToBbox moves the view toward the extent centre', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 100, lat: 10 }, zoom: 4 });
    adapter.mount(el);
    adapter.fitToBbox([105.7, 20.9, 106.0, 21.1], { maxZoom: 16 });
    expect(adapter.getView().center.lon).toBeCloseTo(105.85, 1);
    expect(adapter.getView().center.lat).toBeCloseTo(21.0, 1);
    adapter.destroy();
    el.remove();
  });

  it('toggles layer visibility, switches basemap, and subscribes to pointer moves without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setLayerVisible('published', false);
      adapter.setLayerVisible('published', true);
      adapter.setBasemap('carto-light');
      adapter.setBasemap('none');
      adapter.setBasemap('osm');
      const off = adapter.onPointerMove(() => {});
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/openlayers/ol-map-adapter.test.ts`
Expected: FAIL — methods missing.

- [ ] **Step 3: Implement in `ol-map-adapter.ts`.** Full file:

```ts
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import type { FeatureCollection } from 'geojson';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { Coordinate, Extent, FitOptions, MapViewOptions, Viewport } from '../port/types.js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';
import type { BasemapId } from '../basemaps.js';
import { styleForKind } from './style-adapter.js';
import { createBasemapSource } from './basemaps.js';
import { registerVietnamCrs } from './crs.js';

const DATA_PROJECTION = 'EPSG:4326';
const VIEW_PROJECTION = 'EPSG:3857';

export class OlMapAdapter implements MapEnginePort {
  #map: OLMap | null = null;
  #view: View;
  #base = new TileLayer({ source: createBasemapSource('osm') });
  #layers = new Map<string, VectorLayer<VectorSource>>();
  #selected: string | null = null;
  #clickSubs = new Set<(id: string) => void>();
  #pointerSubs = new Set<(c: Coordinate | null) => void>();
  #format = new GeoJSON({ dataProjection: DATA_PROJECTION, featureProjection: VIEW_PROJECTION });

  constructor(opts: MapViewOptions) {
    registerVietnamCrs();
    const projection = opts.projection ?? VIEW_PROJECTION;
    this.#view = new View({
      center: fromLonLat([opts.center.lon, opts.center.lat], projection),
      zoom: opts.zoom,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      projection,
    });
  }

  mount(target: HTMLElement): void {
    this.#map = new OLMap({ target, view: this.#view, layers: [this.#base] });
    this.#map.on('singleclick', (evt) => {
      const hit = this.#map?.forEachFeatureAtPixel(evt.pixel, (f) => f.getId());
      if (hit != null) this.#clickSubs.forEach((cb) => cb(String(hit)));
    });
    this.#map.on('pointermove', (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate, this.#view.getProjection());
      this.#pointerSubs.forEach((cb) => cb({ lon: lon ?? 0, lat: lat ?? 0 }));
    });
    this.#map.getViewport().addEventListener('mouseout', () => {
      this.#pointerSubs.forEach((cb) => cb(null));
    });
  }

  setFeatures(layerId: string, features: FeatureCollection): void {
    if (!this.#map) return;
    let layer = this.#layers.get(layerId);
    if (!layer) {
      layer = new VectorLayer({ source: new VectorSource() });
      this.#layers.set(layerId, layer);
      this.#map.addLayer(layer);
    }
    const src = layer.getSource();
    if (!src) return;
    src.clear();
    src.addFeatures(this.#format.readFeatures(features));
    layer.setStyle((feat) => {
      const kind = (feat.get('kind') ?? 'component') as NetworkFeatureKind;
      return styleForKind(kind, feat.getId() === this.#selected);
    });
  }

  setView(v: Viewport): void {
    this.#view.setCenter(fromLonLat([v.center.lon, v.center.lat], this.#view.getProjection()));
    this.#view.setZoom(v.zoom);
  }

  getView(): Viewport {
    const center = toLonLat(this.#view.getCenter() ?? [0, 0], this.#view.getProjection());
    return { center: { lon: center[0] ?? 0, lat: center[1] ?? 0 }, zoom: this.#view.getZoom() ?? 0 };
  }

  setSelection(featureId: string | null): void {
    this.#selected = featureId;
    this.#layers.forEach((l) => l.changed());
  }

  getSelection(): string | null {
    return this.#selected;
  }

  onFeatureClick(cb: (id: string) => void): () => void {
    this.#clickSubs.add(cb);
    return () => this.#clickSubs.delete(cb);
  }

  onPointerMove(cb: (c: Coordinate | null) => void): () => void {
    this.#pointerSubs.add(cb);
    return () => this.#pointerSubs.delete(cb);
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.#layers.get(layerId)?.setVisible(visible);
  }

  setBasemap(basemapId: string): void {
    const source = createBasemapSource(basemapId as BasemapId);
    if (source) {
      this.#base.setSource(source);
      this.#base.setVisible(true);
    } else {
      this.#base.setVisible(false);
    }
  }

  fitToBbox(extent: Extent, opts: FitOptions = {}): void {
    if (!this.#map) return;
    const viewExtent = transformExtent(extent, DATA_PROJECTION, this.#view.getProjection());
    const pad = opts.padding ?? 32;
    this.#view.fit(viewExtent, {
      size: this.#map.getSize() ?? undefined,
      padding: [pad, pad, pad, pad],
      maxZoom: opts.maxZoom,
    });
  }

  destroy(): void {
    this.#map?.setTarget(undefined);
    this.#map = null;
    this.#layers.clear();
    this.#clickSubs.clear();
    this.#pointerSubs.clear();
  }
}
```

- [ ] **Step 4: Run green.** `npm --prefix packages/map-runtime run test`
Expected: PASS (all map-runtime tests, including the 2 new adapter cases).

- [ ] **Step 5: Build the package so gis-core can consume the new surface.**

Run: `npm --prefix packages/map-runtime run build`
Expected: exits 0; `dist/index.js`, `dist/basemaps.js`, `dist/openlayers/*` regenerated.

- [ ] **Step 6: Commit.**

```bash
git add packages/map-runtime/src/openlayers/ol-map-adapter.ts packages/map-runtime/src/openlayers/ol-map-adapter.test.ts packages/map-runtime/dist
git commit -m "feat(map-runtime): OlMapAdapter implements pointer-move/layer-visible/basemap/fit; rebuild dist" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `@wn/contracts` — search-result schema + builder + build

**Files:**
- Modify: `packages/contracts/src/map-features/index.ts`
- Modify: `packages/contracts/src/testing/index.ts`
- Test: `packages/contracts/src/map-features/map-features.test.ts`
- Test: `packages/contracts/src/testing/map-features.builder.test.ts`

- [ ] **Step 1: Add contract tests (red).** Append to `map-features.test.ts`:

```ts
import { FeatureSearchResult, FeatureSearchResults } from './index.js';

describe('feature-search contract', () => {
  const hit = {
    id: 'feat-1',
    name: 'Valve 1',
    kind: 'node',
    bbox: [105.8, 21.0, 105.81, 21.01],
  };

  it('parses a search result', () => {
    expect(FeatureSearchResult.parse(hit).kind).toBe('node');
  });

  it('parses a results envelope', () => {
    expect(FeatureSearchResults.parse({ results: [hit] }).results).toHaveLength(1);
  });

  it('rejects a bbox that is not a 4-tuple', () => {
    expect(() => FeatureSearchResult.parse({ ...hit, bbox: [1, 2, 3] })).toThrow();
  });
});
```

And add to `map-features.builder.test.ts` (create the import if the file only tests `aMapFeatureCollection`):

```ts
import { aFeatureSearchResults } from './index.js';
import { FeatureSearchResults } from '../map-features/index.js';

describe('aFeatureSearchResults builder', () => {
  it('produces parseable results carrying the query term in names', () => {
    const built = aFeatureSearchResults({ q: 'valve', count: 2 });
    expect(FeatureSearchResults.parse(built).results).toHaveLength(2);
    expect(built.results[0]!.name.toLowerCase()).toContain('valve');
  });
});
```

- [ ] **Step 2: Run red.** `npm run contracts:test`
Expected: FAIL — `FeatureSearchResult(s)` / `aFeatureSearchResults` not exported.

- [ ] **Step 3: Add schemas to `map-features/index.ts`** (append after `MapFeatureCollection`):

```ts
// A search hit: enough to list and to fit the map (bbox in EPSG:4326).
export const FeatureSearchResult = z.object({
  id: z.string(),
  name: z.string(),
  kind: NetworkFeatureKind,
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type FeatureSearchResult = z.infer<typeof FeatureSearchResult>;

export const FeatureSearchResults = z.object({
  results: z.array(FeatureSearchResult),
});
export type FeatureSearchResults = z.infer<typeof FeatureSearchResults>;
```

- [ ] **Step 4: Add the builder to `testing/index.ts`** (append; keep existing imports, add the types import):

```ts
import type {
  MapFeatureCollection,
  NetworkFeature,
  FeatureSearchResults,
  FeatureSearchResult,
} from '../map-features/index.js';

export function aFeatureSearchResults(
  opts: { q?: string; count?: number } = {},
): FeatureSearchResults {
  const count = opts.count ?? 3;
  const kinds = ['node', 'pipe', 'facility'] as const;
  const results: FeatureSearchResult[] = Array.from({ length: count }, (_, i) => ({
    id: `feat-${i + 1}`,
    name: `${opts.q ?? 'Feature'} ${i + 1}`,
    kind: kinds[i % kinds.length] as FeatureSearchResult['kind'],
    bbox: [105.8 + i * 0.01, 21.0, 105.81 + i * 0.01, 21.01],
  }));
  return { results };
}
```

> Note: the existing `import type { MapFeatureCollection, NetworkFeature } from '../map-features/index.js';` line in `testing/index.ts` is replaced by the combined import above — do not leave a duplicate import.

- [ ] **Step 5: Run green.** `npm run contracts:test`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 6: Build contracts so gis-core sees the new exports.**

Run: `npm run contracts:build`
Expected: exits 0; `packages/contracts/dist/map-features/*` and `dist/testing/*` regenerated.

- [ ] **Step 7: Commit.**

```bash
git add packages/contracts/src packages/contracts/dist
git commit -m "feat(contracts): FeatureSearchResult(s) schema + aFeatureSearchResults builder; rebuild dist" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: MSW search handler + shared fixture

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`
- Test: `apps/gis-core/src/shared/api/mocks/search.handler.test.ts`

> `apps/gis-core/src/test/setup.ts` starts the MSW server with these default handlers, so tests that call the entity query need no per-test server wiring (mirrors `map-features.handler.test.ts`).

- [ ] **Step 1: Write the failing handler test.**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}));
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}));

const { fetchSearchFeatures } = await import('@/entities/map-feature');

describe('default MSW handler: feature search', () => {
  it('returns parseable hits filtered by query, each with a 4-tuple bbox', async () => {
    const res = await fetchSearchFeatures('snap-1', 'feature');
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0]!.bbox).toHaveLength(4);
  });

  it('returns no hits for a non-matching query', async () => {
    const res = await fetchSearchFeatures('snap-1', 'zzz-no-match');
    expect(res.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/search.handler.test.ts`
Expected: FAIL — `fetchSearchFeatures` not exported (added in Task 7) AND no search handler. (This test goes green at the end of Task 7; for now it proves the handler + fixture compile. If you are running strictly task-by-task, expect the import error here and revisit after Task 7.)

- [ ] **Step 3: Edit `handlers.ts`** — introduce a shared fixture and the search handler. Replace the features handler and add the search handler + bbox helper:

```ts
import { http, HttpResponse } from 'msw'
import { aSnapshot, aMapFeatureCollection } from '@wn/contracts/testing'

// Shared fixture so /features and /search never diverge. Coordinates stay within
// DEFAULT_BBOX ([105.7,20.9,106.0,21.1]) so search hits are already loaded & highlightable.
const mockFeatures = aMapFeatureCollection({ count: 6 })

/** Axis-aligned bbox [minLon,minLat,maxLon,maxLat] from a GeoJSON geometry. */
function featureBbox(coordinates: unknown): [number, number, number, number] {
  const pts: number[][] = []
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[])
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk(coordinates)
  const lons = pts.map((p) => p[0]!)
  const lats = pts.map((p) => p[1]!)
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}
```

Then change the features handler to serve the shared fixture, and add the search handler (place both near the existing snapshot handlers):

```ts
  http.get('*/snapshot/:id/features', () => HttpResponse.json(mockFeatures)),

  http.get('*/snapshot/:id/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase()
    const results = mockFeatures.features
      .filter(
        (f) =>
          q !== '' &&
          (f.id.toLowerCase().includes(q) ||
            (f.properties.name ?? '').toLowerCase().includes(q) ||
            f.properties.kind.toLowerCase().includes(q)),
      )
      .map((f) => ({
        id: f.id,
        name: f.properties.name ?? f.id,
        kind: f.properties.kind,
        bbox: featureBbox(f.geometry.coordinates),
      }))
    return HttpResponse.json({ results })
  }),
```

> Remove the old `aMapFeatureCollection({ count: 6 })` inline call from the previous features handler — it is now the shared `mockFeatures` const.

- [ ] **Step 4:** Leave green until Task 7 wires `fetchSearchFeatures`. Proceed to Task 7, then run Step 2's command to confirm green.

- [ ] **Step 5: Commit** (after Task 7 confirms green — or commit handler now and the query next; recommended: commit together with Task 7).

```bash
git add apps/gis-core/src/shared/api/mocks/handlers.ts apps/gis-core/src/shared/api/mocks/search.handler.test.ts
git commit -m "feat(gis-core): MSW search handler over shared in-bbox fixture" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Entity — `searchFeatures` query + key + exports

**Files:**
- Modify: `apps/gis-core/src/shared/api/query-keys.ts`
- Modify: `apps/gis-core/src/entities/map-feature/model/types.ts`
- Modify: `apps/gis-core/src/entities/map-feature/api/queries.ts`
- Modify: `apps/gis-core/src/entities/map-feature/index.ts`
- Test: `apps/gis-core/src/entities/map-feature/api/queries.test.ts`

- [ ] **Step 1: Add a query test (red).** Append to `queries.test.ts` (match the file's existing env/mocks header; if absent, prepend the node-env + auth mocks as in `search.handler.test.ts`):

```ts
describe('searchFeaturesQueryOptions', () => {
  it('builds a disabled query for short terms and an enabled one otherwise', () => {
    const off = searchFeaturesQueryOptions('snap-1', 'a');
    const on = searchFeaturesQueryOptions('snap-1', 'valve');
    expect(off.enabled).toBe(false);
    expect(on.enabled).toBe(true);
    expect(on.queryKey).toEqual(['map-features', 'snap-1', 'search', 'valve']);
  });
});
```

Ensure the import line includes the new symbol:

```ts
import { fetchMapFeatures, searchFeaturesQueryOptions } from '@/entities/map-feature';
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/entities/map-feature/api/queries.test.ts`
Expected: FAIL — `searchFeaturesQueryOptions` not exported.

- [ ] **Step 3: Add the search key to `query-keys.ts`** (extend the `mapFeatures` group):

```ts
  mapFeatures: {
    byBbox: (snapshotId: string, bbox: readonly number[]) =>
      ['map-features', snapshotId, bbox.join(',')] as const,
    search: (snapshotId: string, q: string) =>
      ['map-features', snapshotId, 'search', q] as const,
  },
```

- [ ] **Step 4: Re-export the contract types in `model/types.ts`** (append):

```ts
export { FeatureSearchResult, FeatureSearchResults } from '@wn/contracts/map-features';
export type {
  FeatureSearchResult as FeatureSearchResultT,
  FeatureSearchResults as FeatureSearchResultsT,
} from '@wn/contracts/map-features';
```

- [ ] **Step 5: Add the query to `api/queries.ts`** (append; extend the existing imports):

```ts
import { MapFeatureCollection, FeatureSearchResults, type Bbox, type MapFeatures } from '../model/types';

export async function fetchSearchFeatures(snapshotId: string, q: string) {
  const raw = await httpClient.get<unknown>(
    `/snapshot/${snapshotId}/search?q=${encodeURIComponent(q)}`,
  );
  return FeatureSearchResults.parse(raw);
}

export const searchFeaturesQueryOptions = (snapshotId: string, q: string) =>
  queryOptions({
    queryKey: queryKeys.mapFeatures.search(snapshotId, q),
    queryFn: () => fetchSearchFeatures(snapshotId, q),
    enabled: q.trim().length >= 2,
    staleTime: 1000 * 30,
  });
```

- [ ] **Step 6: Export from `entities/map-feature/index.ts`** (append):

```ts
export { fetchSearchFeatures, searchFeaturesQueryOptions } from './api/queries';
export { FeatureSearchResult, FeatureSearchResults } from './model/types';
```

- [ ] **Step 7: Run green** (this also turns Task 6's handler test green):
`npm --prefix apps/gis-core run test:run -- src/entities/map-feature/api/queries.test.ts src/shared/api/mocks/search.handler.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/gis-core/src/shared/api/query-keys.ts apps/gis-core/src/entities/map-feature
git commit -m "feat(gis-core): searchFeatures query options + search query-key + type re-exports" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `MapRuntimeProvider` + context (shared/lib/map-runtime)

**Files:**
- Create: `apps/gis-core/src/shared/lib/map-runtime/map-runtime-context.tsx`
- Create: `apps/gis-core/src/shared/lib/map-runtime/index.ts`
- Test: `apps/gis-core/src/shared/lib/map-runtime/map-runtime-context.test.tsx`

- [ ] **Step 1: Write the failing test.** Uses the shared test prelude (Appendix A) because it renders the runtime.

```tsx
// --- Appendix A prelude START ---
import { createSignal, onCleanup, onMount } from 'solid-js';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}));
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}));
vi.mock('@wn/map-runtime/solid', () => ({
  createMapRuntime: (opts: { view: unknown; factory?: (v: unknown) => Promise<unknown> }) => {
    const [port, setPort] = createSignal<unknown>(null);
    let container: HTMLDivElement | undefined;
    const containerRef = (el: HTMLDivElement) => { container = el; };
    onMount(async () => {
      const create = opts.factory!;
      const instance = await create(opts.view);
      if (container) (instance as { mount: (el: HTMLDivElement) => void }).mount(container);
      setPort(instance);
    });
    onCleanup(() => { (port() as { destroy?: () => void })?.destroy?.(); });
    return { containerRef, port };
  },
}));

let _origFetch: typeof globalThis.fetch;
beforeAll(() => {
  _origFetch = globalThis.fetch;
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return _origFetch(url, rest);
  };
});
afterAll(() => { globalThis.fetch = _origFetch; });
// --- Appendix A prelude END ---

import { render, waitFor } from '@solidjs/testing-library';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider, useMapRuntimeContext } from './map-runtime-context';

const fakePort: MapEnginePort = {
  mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
  setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
  onFeatureClick: () => () => {}, onPointerMove: () => () => {},
  setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(), destroy: vi.fn(),
};

function Consumer() {
  const { containerRef, port } = useMapRuntimeContext();
  return <div ref={containerRef} data-testid="consumer">{port() ? 'ready' : 'pending'}</div>;
}

describe('MapRuntimeProvider', () => {
  it('creates one port via the factory and exposes it through context', async () => {
    const factory = vi.fn(async () => fakePort);
    const { getByTestId } = render(() => (
      <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={factory}>
        <Consumer />
      </MapRuntimeProvider>
    ));
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('consumer')).toHaveTextContent('ready'));
    expect(fakePort.mount).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/shared/lib/map-runtime/map-runtime-context.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `map-runtime-context.tsx`.**

```tsx
import { createContext, useContext, type JSX } from 'solid-js';
import { createMapRuntime } from '@wn/map-runtime/solid';
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';

export interface MapRuntimeContextValue {
  /** Attach to the map container <div>. */
  containerRef: (el: HTMLDivElement) => void;
  /** The live port once created (null until mounted). */
  port: () => MapEnginePort | null;
}

const MapRuntimeContext = createContext<MapRuntimeContextValue>();

/** Owns the single live map engine for the route. The `factory` prop is the one
 * test seam — inject a mock port here instead of threading it through features. */
export function MapRuntimeProvider(props: {
  view: MapViewOptions;
  factory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
  children: JSX.Element;
}) {
  const { containerRef, port } = createMapRuntime({ view: props.view, factory: props.factory });
  return (
    <MapRuntimeContext.Provider value={{ containerRef, port }}>
      {props.children}
    </MapRuntimeContext.Provider>
  );
}

export function useMapRuntimeContext(): MapRuntimeContextValue {
  const ctx = useContext(MapRuntimeContext);
  if (!ctx) throw new Error('useMapRuntimeContext must be used within a MapRuntimeProvider');
  return ctx;
}
```

- [ ] **Step 4: Create `index.ts`.**

```ts
export { MapRuntimeProvider, useMapRuntimeContext } from './map-runtime-context';
export type { MapRuntimeContextValue } from './map-runtime-context';
```

- [ ] **Step 5: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/shared/lib/map-runtime
git commit -m "feat(gis-core): MapRuntimeProvider context owns the single map port" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Refactor `map-canvas` to consume the context

**Files:**
- Modify: `apps/gis-core/src/features/map-canvas/ui/map-canvas.tsx`
- Test: `apps/gis-core/src/features/map-canvas/ui/map-canvas.test.tsx`

- [ ] **Step 1: Update the test (red).** The canvas no longer takes `mapFactory`; it renders inside `MapRuntimeProvider`. Replace the render block and the mock-port object so the file body (after the Appendix A prelude already present in this file) reads:

```tsx
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { MapCanvas } from './map-canvas';

const port: MapEnginePort = {
  mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
  setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
  onFeatureClick: vi.fn(() => () => {}), onPointerMove: vi.fn(() => () => {}),
  setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(), destroy: vi.fn(),
};

describe('MapCanvas', () => {
  it('pushes fetched features into the context port and wires clicks', async () => {
    const qc = new QueryClient();
    render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <MapCanvas snapshotId="snap-1" onSelect={() => {}} selectedId={null} />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    await waitFor(() => expect(port.setFeatures).toHaveBeenCalledWith('published', expect.anything()));
    expect(port.onFeatureClick).toHaveBeenCalled();
  });
});
```

> Keep the Appendix A prelude block (auth mocks + `@wn/map-runtime/solid` mock + AbortSignal strip) that already heads this file.

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/map-canvas/ui/map-canvas.test.tsx`
Expected: FAIL — `MapCanvas` still expects `mapFactory` / creates its own runtime.

- [ ] **Step 3: Rewrite `map-canvas.tsx`.**

```tsx
import { createEffect, onCleanup } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { FeatureCollection } from 'geojson';
import { mapFeaturesQueryOptions, DEFAULT_BBOX } from '@/entities/map-feature';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';

export function MapCanvas(props: {
  snapshotId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { containerRef, port } = useMapRuntimeContext();
  const features = useQuery(() => mapFeaturesQueryOptions(props.snapshotId, DEFAULT_BBOX));

  // Wire click subscription once the port exists.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onFeatureClick((id) => props.onSelect(id));
    onCleanup(off);
  });

  // Push features when both the port and the data are ready.
  createEffect(() => {
    const p = port();
    const data = features.data;
    if (p && data) p.setFeatures('published', data as unknown as FeatureCollection);
  });

  // Reflect external selection into the map.
  createEffect(() => {
    port()?.setSelection(props.selectedId);
  });

  return <div ref={containerRef} data-testid="map-canvas" class="h-full w-full" />;
}
```

- [ ] **Step 4: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/gis-core/src/features/map-canvas/ui/map-canvas.tsx apps/gis-core/src/features/map-canvas/ui/map-canvas.test.tsx
git commit -m "refactor(gis-core): map-canvas consumes MapRuntime context (drops own factory)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `coordinate-readout` feature

**Files:**
- Create: `apps/gis-core/src/features/coordinate-readout/ui/coordinate-readout.tsx`
- Create: `apps/gis-core/src/features/coordinate-readout/index.ts`
- Test: `apps/gis-core/src/features/coordinate-readout/ui/coordinate-readout.test.tsx`

- [ ] **Step 1: Write the failing test.** Begins with the Appendix A prelude (full block from Task 8 Step 1), then:

```tsx
import { render, waitFor } from '@solidjs/testing-library';
import type { MapEnginePort, Coordinate } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { CoordinateReadout } from './coordinate-readout';

function pointerPort(): MapEnginePort & { emit: (c: Coordinate | null) => void } {
  const subs = new Set<(c: Coordinate | null) => void>();
  return {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {},
    onPointerMove: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(), destroy: vi.fn(),
    emit: (c) => subs.forEach((cb) => cb(c)),
  };
}

describe('CoordinateReadout', () => {
  it('shows lon/lat on pointer move and a placeholder when the pointer leaves', async () => {
    const port = pointerPort();
    const { getByTestId } = render(() => (
      <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
        <CoordinateReadout />
      </MapRuntimeProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    port.emit({ lon: 105.84321, lat: 21.01987 });
    await waitFor(() => expect(getByTestId('coordinate-readout')).toHaveTextContent('105.84321, 21.01987'));
    port.emit(null);
    await waitFor(() => expect(getByTestId('coordinate-readout')).toHaveTextContent('—'));
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/coordinate-readout/ui/coordinate-readout.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `coordinate-readout.tsx`.**

```tsx
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Coordinate } from '@wn/map-runtime';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createThrottledCallback } from '@/shared/lib/hooks/use-throttle';

/** Live lon/lat under the cursor. Throttles display updates; clears on pointer-out. */
export function CoordinateReadout() {
  const { port } = useMapRuntimeContext();
  const [coord, setCoord] = createSignal<Coordinate | null>(null);
  const push = createThrottledCallback((c: Coordinate | null) => setCoord(c), 100);

  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onPointerMove((c) => push(c));
    onCleanup(off);
  });

  return (
    <div
      data-testid="coordinate-readout"
      class="rounded bg-background/80 px-2 py-1 font-mono text-xs text-muted-foreground shadow"
    >
      <Show when={coord()} fallback={<span>—, —</span>}>
        {(c) => <span>{c().lon.toFixed(5)}, {c().lat.toFixed(5)}</span>}
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts`.**

```ts
export { CoordinateReadout } from './ui/coordinate-readout';
```

- [ ] **Step 5: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/features/coordinate-readout
git commit -m "feat(gis-core): coordinate-readout feature (live lon/lat from port pointer-move)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `layer-control` feature

**Files:**
- Create: `apps/gis-core/src/features/layer-control/ui/layer-control.tsx`
- Create: `apps/gis-core/src/features/layer-control/index.ts`
- Test: `apps/gis-core/src/features/layer-control/ui/layer-control.test.tsx`

- [ ] **Step 1: Write the failing test.** Appendix A prelude, then:

```tsx
import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { LayerControl } from './layer-control';

function spyPort() {
  const calls = { setLayerVisible: [] as [string, boolean][], setBasemap: [] as string[] };
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: (id, v) => calls.setLayerVisible.push([id, v]),
    setBasemap: (id) => calls.setBasemap.push(id),
    fitToBbox: vi.fn(), destroy: vi.fn(),
  };
  return { port, calls };
}

describe('LayerControl', () => {
  it('toggles the published vector layer and switches basemap via the port', async () => {
    const { port, calls } = spyPort();
    const { getByTestId, getByText } = render(() => (
      <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
        <LayerControl />
      </MapRuntimeProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByText('Layers ▾'));
    fireEvent.click(getByTestId('toggle-published'));
    expect(calls.setLayerVisible).toContainEqual(['published', false]);
    fireEvent.click(getByTestId('basemap-carto-light'));
    expect(calls.setBasemap).toContain('carto-light');
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/layer-control/ui/layer-control.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `layer-control.tsx`.**

```tsx
import { createSignal, For, Show } from 'solid-js';
import { BASEMAPS, type BasemapId } from '@wn/map-runtime';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';

/** Toggle the published vector layer and switch basemaps. Local UI state mirrors
 * the port; the port is the source of truth for the engine. */
export function LayerControl() {
  const { port } = useMapRuntimeContext();
  const [open, setOpen] = createSignal(false);
  const [vectorVisible, setVectorVisible] = createSignal(true);
  const [basemap, setBasemap] = createSignal<BasemapId>('osm');

  const toggleVector = () => {
    const next = !vectorVisible();
    setVectorVisible(next);
    port()?.setLayerVisible('published', next);
  };
  const chooseBasemap = (id: BasemapId) => {
    setBasemap(id);
    port()?.setBasemap(id);
  };

  return (
    <div data-testid="layer-control" class="text-sm">
      <button
        type="button"
        class="rounded bg-background/90 px-3 py-1.5 shadow"
        onClick={() => setOpen((o) => !o)}
      >
        Layers ▾
      </button>
      <Show when={open()}>
        <div class="mt-1 w-48 space-y-2 rounded bg-background p-3 shadow-lg">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={vectorVisible()}
              onChange={toggleVector}
              data-testid="toggle-published"
            />
            Published features
          </label>
          <fieldset class="space-y-1">
            <legend class="text-xs text-muted-foreground">Basemap</legend>
            <For each={BASEMAPS}>
              {(b) => (
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="basemap"
                    value={b.id}
                    checked={basemap() === b.id}
                    onChange={() => chooseBasemap(b.id)}
                    data-testid={`basemap-${b.id}`}
                  />
                  {b.label}
                </label>
              )}
            </For>
          </fieldset>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts`.**

```ts
export { LayerControl } from './ui/layer-control';
```

- [ ] **Step 5: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/features/layer-control
git commit -m "feat(gis-core): layer-control feature (vector toggle + basemap switch)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `feature-search` feature

**Files:**
- Create: `apps/gis-core/src/features/feature-search/ui/feature-search.tsx`
- Create: `apps/gis-core/src/features/feature-search/index.ts`
- Test: `apps/gis-core/src/features/feature-search/ui/feature-search.test.tsx`

- [ ] **Step 1: Write the failing integration test.** Appendix A prelude, then (relies on the MSW search handler + the default server from `src/test/setup.ts`):

```tsx
import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { FeatureSearch } from './feature-search';

function fitPort() {
  const fits: [number, number, number, number][] = [];
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(),
    fitToBbox: (extent) => fits.push(extent), destroy: vi.fn(),
  };
  return { port, fits };
}

describe('FeatureSearch', () => {
  it('queries, lists hits, and on pick fits the map + emits onSelect', async () => {
    const qc = new QueryClient();
    const { port, fits } = fitPort();
    const selected: string[] = [];
    const { getByTestId, findByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <FeatureSearch snapshotId="snap-1" onSelect={(id) => selected.push(id)} />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.input(getByTestId('search-input'), { target: { value: 'feature' } });
    const first = await findByTestId('result-feat-1');
    fireEvent.click(first);
    expect(selected).toContain('feat-1');
    expect(fits).toHaveLength(1);
    expect(fits[0]).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/feature-search/ui/feature-search.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `feature-search.tsx`.**

```tsx
import { createSignal, For, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { searchFeaturesQueryOptions } from '@/entities/map-feature';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createDebouncedAccessor } from '@/shared/lib/hooks/use-debounce';

interface Hit {
  id: string;
  name: string;
  kind: string;
  bbox: [number, number, number, number];
}

/** Search features by name/id/kind. On pick: fit the map to the hit and emit
 * selection upward (the page wires it to the selection store). */
export function FeatureSearch(props: { snapshotId: string; onSelect: (id: string) => void }) {
  const { port } = useMapRuntimeContext();
  const [term, setTerm] = createSignal('');
  const debounced = createDebouncedAccessor(term, 200);
  const results = useQuery(() => searchFeaturesQueryOptions(props.snapshotId, debounced()));

  const pick = (hit: Hit) => {
    port()?.fitToBbox(hit.bbox, { maxZoom: 17, padding: 48 });
    props.onSelect(hit.id);
    setTerm('');
  };

  return (
    <div data-testid="feature-search" class="w-64">
      <input
        type="search"
        placeholder="Search features…"
        value={term()}
        onInput={(e) => setTerm(e.currentTarget.value)}
        data-testid="search-input"
        class="w-full rounded bg-background/95 px-3 py-1.5 text-sm shadow"
      />
      <Show when={(results.data?.results.length ?? 0) > 0}>
        <ul class="mt-1 max-h-64 overflow-auto rounded bg-background shadow-lg">
          <For each={results.data!.results}>
            {(r) => (
              <li>
                <button
                  type="button"
                  data-testid={`result-${r.id}`}
                  class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => pick(r as Hit)}
                >
                  <span>{r.name}</span>
                  <span class="text-xs text-muted-foreground">{r.kind}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts`.**

```ts
export { FeatureSearch } from './ui/feature-search';
```

- [ ] **Step 5: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/features/feature-search
git commit -m "feat(gis-core): feature-search feature (mock endpoint + fitToBbox on pick)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `map-shell` widget

**Files:**
- Create: `apps/gis-core/src/widgets/map-shell/ui/map-shell.tsx`
- Create: `apps/gis-core/src/widgets/map-shell/index.ts`
- Test: `apps/gis-core/src/widgets/map-shell/ui/map-shell.test.tsx`

- [ ] **Step 1: Write the failing test.** Pure layout — no runtime mock needed.

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@solidjs/testing-library';
import { MapShell } from './map-shell';

describe('MapShell', () => {
  it('renders the map plus the four control/palette slots', () => {
    const { getByTestId } = render(() => (
      <MapShell
        map={<div data-testid="slot-map" />}
        topLeft={<div data-testid="slot-search" />}
        topRight={<div data-testid="slot-layers" />}
        bottom={<div data-testid="slot-coord" />}
        aside={<div data-testid="slot-palette" />}
      />
    ));
    expect(getByTestId('map-shell')).toBeInTheDocument();
    ['slot-map', 'slot-search', 'slot-layers', 'slot-coord', 'slot-palette'].forEach((id) =>
      expect(getByTestId(id)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/widgets/map-shell/ui/map-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `map-shell.tsx`.**

```tsx
import type { JSX } from 'solid-js';

/** Viewer layout: map fills the main area with floating overlay slots; the
 * properties palette is the right sidebar. */
export function MapShell(props: {
  map: JSX.Element;
  topLeft?: JSX.Element;
  topRight?: JSX.Element;
  bottom?: JSX.Element;
  aside?: JSX.Element;
}) {
  return (
    <div class="flex h-screen" data-testid="map-shell">
      <main class="relative flex-1">
        {props.map}
        <div class="absolute left-3 top-3 z-10">{props.topLeft}</div>
        <div class="absolute right-3 top-3 z-10">{props.topRight}</div>
        <div class="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">{props.bottom}</div>
      </main>
      {props.aside}
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts`.**

```ts
export { MapShell } from './ui/map-shell';
```

- [ ] **Step 5: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/widgets/map-shell
git commit -m "feat(gis-core): map-shell widget (map area + overlay slots + palette aside)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Compose the page

**Files:**
- Modify: `apps/gis-core/src/pages/gis/index.tsx`
- Test: `apps/gis-core/src/pages/gis/gis-page.test.tsx`

- [ ] **Step 1: Update the page test (red).** The page now owns the provider; tests pass the mock via `mapFactory`. Keep the Appendix A prelude that already heads this file. Replace the body so it reads:

```tsx
import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { MapEnginePort } from '@wn/map-runtime';
import { GisViewerPage } from './index';

function fakePort(): MapEnginePort & { fireClick: (id: string) => void } {
  const subs = new Set<(id: string) => void>();
  let selected: string | null = null;
  return {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: (id) => { selected = id; }, getSelection: () => selected,
    onFeatureClick: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    onPointerMove: () => () => {}, setLayerVisible: vi.fn(), setBasemap: vi.fn(),
    fitToBbox: vi.fn(), destroy: vi.fn(),
    fireClick: (id) => subs.forEach((c) => c(id)),
  };
}

describe('GisViewerPage', () => {
  it('renders the shell and shows a clicked feature in the palette', async () => {
    const qc = new QueryClient();
    const port = fakePort();
    const { getByTestId, findByText } = render(() => (
      <QueryClientProvider client={qc}>
        <GisViewerPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-shell')).toBeInTheDocument());
    await waitFor(() => expect(getByTestId('map-canvas')).toBeInTheDocument());
    expect(getByTestId('feature-search')).toBeInTheDocument();
    expect(getByTestId('layer-control')).toBeInTheDocument();
    expect(getByTestId('coordinate-readout')).toBeInTheDocument();
    port.fireClick('feat-1');
    expect(await findByText('feat-1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/pages/gis/gis-page.test.tsx`
Expected: FAIL — page does not yet render the shell/provider/new features.

- [ ] **Step 3: Rewrite `pages/gis/index.tsx`.**

```tsx
import { createMemo } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { MapShell } from '@/widgets/map-shell';
import { MapCanvas, createViewportStore } from '@/features/map-canvas';
import { CoordinateReadout } from '@/features/coordinate-readout';
import { LayerControl } from '@/features/layer-control';
import { FeatureSearch } from '@/features/feature-search';
import { PropertiesPalette } from '@/widgets/properties-palette';
import { createSelectionStore } from '@/features/feature-selection/model/selection-store';
import { mapFeaturesQueryOptions, DEFAULT_BBOX } from '@/entities/map-feature';

export function GisViewerPage(props: {
  snapshotId?: string;
  mapFactory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}) {
  const snapshotId = () => props.snapshotId ?? 'snap-1';
  const selection = createSelectionStore();
  const vp = createViewportStore();
  const features = useQuery(() => mapFeaturesQueryOptions(snapshotId(), DEFAULT_BBOX));

  const selectedFeature = createMemo(() =>
    features.data?.features.find((f) => f.id === selection.selectedId()),
  );

  return (
    <MapRuntimeProvider view={vp.viewport()} factory={props.mapFactory}>
      <MapShell
        map={
          <MapCanvas
            snapshotId={snapshotId()}
            selectedId={selection.selectedId()}
            onSelect={selection.select}
          />
        }
        topLeft={<FeatureSearch snapshotId={snapshotId()} onSelect={selection.select} />}
        topRight={<LayerControl />}
        bottom={<CoordinateReadout />}
        aside={<PropertiesPalette feature={selectedFeature()} />}
      />
    </MapRuntimeProvider>
  );
}
```

- [ ] **Step 4: Run green.** Same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/gis-core/src/pages/gis/index.tsx apps/gis-core/src/pages/gis/gis-page.test.tsx
git commit -m "feat(gis-core): compose /gis from map-shell + provider + search/layers/coords" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Full gate sweep (boundaries, types, tests, size)

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the app.** `npm --prefix apps/gis-core run typecheck`
Expected: exits 0.

- [ ] **Step 2: Lint (FSD boundaries + a11y).** `npm --prefix apps/gis-core run lint`
Expected: exits 0. If boundaries complain that a feature imports another feature, re-check: features may import only `shared/*`, `entities/*`, and `@wn/*` — search/coords/layers must reach the port via `@/shared/lib/map-runtime`, never via each other.

- [ ] **Step 3: Run the whole app suite.** `npm --prefix apps/gis-core run test:run`
Expected: PASS (all suites, including the refactored canvas/page and the 3 new features).

- [ ] **Step 4: Run package suites.** `npm --prefix packages/map-runtime run test && npm run contracts:test`
Expected: PASS.

- [ ] **Step 5: Build + size gate.** `npm --prefix apps/gis-core run build && npm --prefix apps/gis-core run size`
Expected: build succeeds; `ol-map-adapter-*.js` ≤ 200 kB gz (the carto/XYZ source rides this chunk, not `index-*.js`); `index-*.js` ≤ 120 kB gz. If the main `index` chunk grew, an `ol`-importing module leaked outside `openlayers/*` — verify `layer-control` imports only `BASEMAPS`/`BasemapId` from `@wn/map-runtime` (the plain catalog), never `openlayers/basemaps`.

- [ ] **Step 6: Confirm no file exceeds the size budget.** Spot-check new/edited files are < 400 lines (DoD: none > 600).
Run: `find apps/gis-core/src/features apps/gis-core/src/widgets/map-shell apps/gis-core/src/shared/lib/map-runtime packages/map-runtime/src -name '*.ts*' -not -name '*.test.*' | xargs wc -l | sort -rn | head`
Expected: all comfortably under 400.

- [ ] **Step 7: Final commit (if gates produced formatting/lockfile changes).**

```bash
git add -A
git commit -m "chore(gis-core): slice 2.2 gate sweep (typecheck/lint/test/size green)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Appendix A — shared gis-core test prelude

Tests that render anything using the map runtime must start with this block (auth isolation + the `@wn/map-runtime/solid` re-implementation on gis-core's Solid instance + the AbortSignal strip). It is reproduced in full in Task 8 Step 1; paste the identical block at the top of:
`map-runtime-context.test.tsx`, `map-canvas.test.tsx` (already present), `coordinate-readout.test.tsx`, `layer-control.test.tsx`, `feature-search.test.tsx`, `gis-page.test.tsx` (already present).

Why it's required: in tests, `@wn/map-runtime` resolves to its own `node_modules/solid-js` (a different instance), so signals created inside the package's real `createMapRuntime` would not share gis-core's reactive graph. The mock re-creates `createMapRuntime` with gis-core's Solid so effects track correctly. In production, Solid is deduped to one instance (commit `12dde17`), so the real hook works unchanged.

---

## Self-Review

**Spec coverage:**
- §2 shared context → Task 8 (provider) + Task 9 (canvas refactor). ✓
- §3 port +4 methods + `Extent`/catalog → Tasks 1–4. ✓
- §4 `FeatureSearchResults` contract + builder → Task 5. ✓
- §5 FSD slices (map-runtime context, coordinate-readout, layer-control, feature-search, map-shell, page, entity, mocks) → Tasks 6–14. ✓
- §6 data flow (search → fitToBbox + onSelect → selection) → Tasks 12, 14. ✓
- §7 loading/empty/`none` basemap fallback → Task 3 (`none`→null), Task 12 (results gated on data), Task 10 (placeholder). ✓
- §8 testing layers (unit/contract/component/integration/smoke/size) → Tasks 1,3,4,5 (unit+contract), 9–14 (component), 6+12 (integration), 14 (smoke), 15 (size). ✓
- §9 non-goals respected: no related/lineage, no URL-sync, no viewport-driven reload, demo data in `DEFAULT_BBOX`. ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; every command states expected output. ✓

**Type consistency:** `Extent = [number,number,number,number]` used identically in port, adapter, contract `bbox` tuple, search `Hit`, and tests; `FitOptions{padding,maxZoom}` consistent (Task 1 def ↔ Task 4 impl ↔ Task 12 call); `BasemapId` used in catalog, ol factory, adapter cast, layer-control; method names `onPointerMove`/`setLayerVisible`/`setBasemap`/`fitToBbox` identical across port, fakes, adapter, callers; `useMapRuntimeContext`/`MapRuntimeProvider` names stable across Tasks 8–14. ✓
