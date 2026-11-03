# GIS Core — Viewer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trong `apps/gis-core`, render features Published của một snapshot (lấy từ MSW mock) trên bản đồ OpenLayers, pan/zoom, click feature → highlight + detail panel — qua package `@wn/map-runtime` mới và contract `@wn/contracts/map-features`.

**Architecture:** Lát cắt dọc mỏng xuyên kiến trúc thật (cách A của spec). `@wn/map-runtime` bọc OpenLayers sau `MapEnginePort` (chỉ thư mục `openlayers/` được import `ol`/`proj4`, lazy-load vào chunk riêng). `@wn/contracts` thêm context `map-features` (GeoJSON + Zod). `apps/gis-core` ráp theo FSD: entities/map-feature → features/map-canvas + feature-selection → widgets → route `/gis`. Dữ liệu qua TanStack Query + MSW; auth mock; KHÔNG đụng BE thật.

**Tech Stack:** SolidJS, Vite, TanStack Solid Router/Query, OpenLayers 10 + proj4, Zod, MSW, Vitest + @solidjs/testing-library, size-limit. pnpm/npm per-package.

**Spec:** `docs/superpowers/specs/2026-06-15-gis-core-viewer-foundation-design.md`

**Quy ước chung khi chạy lệnh:**
- `CONTRACTS=packages/contracts`, `MR=packages/map-runtime`, `GC=apps/gis-core` (đường dẫn tương đối từ root `water-network-fe`).
- gis-core/map-runtime cài deps bằng `HUSKY=0 npm install` (tránh husky trong subdir).
- Commit nhỏ theo từng task; branch đề xuất: `feature/US-002-viewer-foundation`.

---

## Task 0: Branch + intake US-002

**Files:** none (git + harness durable layer)

- [ ] **Step 1: Tạo branch**

Run:
```bash
cd water-network-fe
git checkout -b feature/US-002-viewer-foundation
```

- [ ] **Step 2: Ghi intake + story durable**

Run:
```bash
./scripts/bin/harness-cli intake --type spec-slice \
  --summary "US-002 slice 2.1 GIS Core Viewer foundation: @wn/map-runtime (OL) + @wn/contracts/map-features + gis-core viewer (map render features from MSW, select->detail)" \
  --lane high-risk --story US-002 \
  --docs "docs/superpowers/specs/2026-06-15-gis-core-viewer-foundation-design.md"
./scripts/bin/harness-cli story update --id US-002 --status in_progress
```
Expected: `Intake #N recorded.` + `Story US-002 updated.`

---

## Task 1: `@wn/contracts/map-features` schema

**Files:**
- Create: `packages/contracts/src/map-features/index.ts`
- Test: `packages/contracts/src/map-features/map-features.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/package.json` (exports), `packages/contracts/src/testing/index.ts`

- [ ] **Step 1: Viết test thất bại**

Create `packages/contracts/src/map-features/map-features.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MapFeatureCollection, NetworkFeature } from './index.js';

const point: unknown = {
  type: 'Feature',
  id: 'node-1',
  geometry: { type: 'Point', coordinates: [105.8, 21.02] },
  properties: { kind: 'node', name: 'N1', status: 'active' },
};

describe('map-features contract', () => {
  it('parses a valid network feature', () => {
    const parsed = NetworkFeature.parse(point);
    expect(parsed.properties.kind).toBe('node');
  });

  it('parses a feature collection', () => {
    const fc = { type: 'FeatureCollection', features: [point] };
    expect(MapFeatureCollection.parse(fc).features).toHaveLength(1);
  });

  it('rejects an unknown kind', () => {
    const bad = { ...point, properties: { kind: 'spaceship' } };
    expect(() => NetworkFeature.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/contracts && npx vitest run src/map-features`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Viết schema tối thiểu**

Create `packages/contracts/src/map-features/index.ts`:
```ts
import { z } from 'zod';

export const NetworkFeatureKind = z.enum(['pipe', 'node', 'facility', 'component']);
export type NetworkFeatureKind = z.infer<typeof NetworkFeatureKind>;

export const NetworkFeatureProps = z.object({
  kind: NetworkFeatureKind,
  name: z.string().optional(),
  status: z.string().optional(),
});
export type NetworkFeatureProps = z.infer<typeof NetworkFeatureProps>;

// GeoJSON geometry, coordinates in EPSG:4326 (lon/lat).
export const NetworkGeometry = z.object({
  type: z.enum(['Point', 'LineString', 'Polygon']),
  coordinates: z.unknown(),
});

export const NetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,
});
export type NetworkFeature = z.infer<typeof NetworkFeature>;

export const MapFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(NetworkFeature),
});
export type MapFeatureCollection = z.infer<typeof MapFeatureCollection>;
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd packages/contracts && npx vitest run src/map-features`
Expected: PASS (3 tests).

- [ ] **Step 5: Export public + subpath**

Modify `packages/contracts/src/index.ts` — thêm dòng cuối:
```ts
export * from './map-features/index.js';
```

Modify `packages/contracts/package.json` `exports` — thêm key:
```json
    "./map-features": {
      "types": "./dist/map-features/index.d.ts",
      "import": "./dist/map-features/index.js"
    }
```

- [ ] **Step 6: Build lại + verify dist**

Run: `cd packages/contracts && npm run build && ls dist/map-features`
Expected: `index.d.ts index.js` (+ maps).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add map-features bounded context"
```

---

## Task 2: builder `aMapFeatureCollection()` trong `@wn/contracts/testing`

**Files:**
- Modify: `packages/contracts/src/testing/index.ts`
- Test: `packages/contracts/src/testing/map-features.builder.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `packages/contracts/src/testing/map-features.builder.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MapFeatureCollection } from '../map-features/index.js';
import { aMapFeatureCollection } from './index.js';

describe('aMapFeatureCollection builder', () => {
  it('produces a valid, parseable collection by default', () => {
    const fc = aMapFeatureCollection();
    expect(() => MapFeatureCollection.parse(fc)).not.toThrow();
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('honours a requested feature count', () => {
    expect(aMapFeatureCollection({ count: 5 }).features).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/contracts && npx vitest run src/testing/map-features.builder.test.ts`
Expected: FAIL — `aMapFeatureCollection is not exported`.

- [ ] **Step 3: Thêm builder**

Append to `packages/contracts/src/testing/index.ts`:
```ts
import type { MapFeatureCollection, NetworkFeature } from '../map-features/index.js';

export function aMapFeatureCollection(
  opts: { count?: number } = {},
): MapFeatureCollection {
  const count = opts.count ?? 3;
  const kinds = ['node', 'pipe', 'facility'] as const;
  const features: NetworkFeature[] = Array.from({ length: count }, (_, i) => ({
    type: 'Feature',
    id: `feat-${i + 1}`,
    geometry:
      kinds[i % kinds.length] === 'pipe'
        ? { type: 'LineString', coordinates: [[105.8 + i * 0.01, 21.0], [105.81 + i * 0.01, 21.01]] }
        : { type: 'Point', coordinates: [105.8 + i * 0.01, 21.0 + i * 0.01] },
    properties: { kind: kinds[i % kinds.length], name: `Feature ${i + 1}`, status: 'active' },
  }));
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd packages/contracts && npx vitest run src/testing && npm run build`
Expected: PASS; build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "test(contracts): add aMapFeatureCollection builder"
```

---

## Task 3: scaffold package `@wn/map-runtime`

**Files:**
- Create: `packages/map-runtime/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `README.md`

- [ ] **Step 1: package.json**

Create `packages/map-runtime/package.json`:
```json
{
  "name": "@wn/map-runtime",
  "version": "0.1.0",
  "description": "Map engine (OpenLayers) behind MapEnginePort for the water-network fleet.",
  "private": false,
  "type": "module",
  "license": "UNLICENSED",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./solid": { "types": "./dist/solid/use-map-runtime.d.ts", "import": "./dist/solid/use-map-runtime.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "peerDependencies": { "solid-js": "^1.9.0" },
  "dependencies": { "ol": "^10.3.1", "proj4": "^2.15.0" },
  "devDependencies": {
    "@solidjs/testing-library": "^0.8.10",
    "@testing-library/jest-dom": "^6.6.3",
    "@types/geojson": "^7946.0.14",
    "@types/proj4": "^2.5.5",
    "jsdom": "^25.0.1",
    "solid-js": "^1.9.3",
    "typescript": "^5.6.3",
    "vite-plugin-solid": "^2.11.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: tsconfig.json + tsconfig.build.json**

Create `packages/map-runtime/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "preserve", "jsxImportSource": "solid-js",
    "strict": true, "noUncheckedIndexedAccess": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true, "declaration": true, "declarationMap": true, "sourceMap": true, "noEmit": true
  },
  "include": ["src"]
}
```

Create `packages/map-runtime/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts"]
}
```

- [ ] **Step 3: vitest.config.ts**

Create `packages/map-runtime/vitest.config.ts`:
```ts
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solid()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
  },
});
```

- [ ] **Step 4: README + install**

Create `packages/map-runtime/README.md`:
```md
# @wn/map-runtime

OpenLayers map engine behind `MapEnginePort` for the water-network fleet. Only
`src/openlayers/*` may import `ol`/`proj4`; everything else depends on the port.
Published package (registry decision deferred — consumed via `file:` in Phase 0).
```

Run: `cd packages/map-runtime && HUSKY=0 npm install`
Expected: deps installed (ol, proj4, vitest…).

- [ ] **Step 5: Commit**

```bash
git add packages/map-runtime
git commit -m "chore(map-runtime): scaffold package"
```

---

## Task 4: port types + `MapEnginePort`

**Files:**
- Create: `packages/map-runtime/src/port/types.ts`, `packages/map-runtime/src/port/map-engine-port.ts`
- Test: `packages/map-runtime/src/port/map-engine-port.test.ts`

- [ ] **Step 1: Viết test thất bại (port hợp đồng qua mock impl)**

Create `packages/map-runtime/src/port/map-engine-port.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { MapEnginePort } from './map-engine-port.js';
import type { Viewport } from './types.js';

function makeFake(): MapEnginePort {
  let view: Viewport = { center: { lon: 0, lat: 0 }, zoom: 1 };
  let selected: string | null = null;
  const subs = new Set<(id: string) => void>();
  return {
    mount: vi.fn(),
    setView: (v) => { view = v; },
    getView: () => view,
    setFeatures: vi.fn(),
    setSelection: (id) => { selected = id; },
    getSelection: () => selected,
    onFeatureClick: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    emitClick: (id: string) => subs.forEach((c) => c(id)),
    destroy: vi.fn(),
  } as MapEnginePort & { emitClick: (id: string) => void; getSelection: () => string | null };
}

describe('MapEnginePort contract', () => {
  it('round-trips the viewport', () => {
    const p = makeFake();
    p.setView({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(p.getView().zoom).toBe(12);
  });

  it('notifies + unsubscribes feature clicks', () => {
    const p = makeFake() as MapEnginePort & { emitClick: (id: string) => void };
    const seen: string[] = [];
    const off = p.onFeatureClick((id) => seen.push(id));
    p.emitClick('a'); off(); p.emitClick('b');
    expect(seen).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/map-runtime && npx vitest run src/port`
Expected: FAIL — không tìm thấy `./types.js` / `./map-engine-port.js`.

- [ ] **Step 3: types.ts**

Create `packages/map-runtime/src/port/types.ts`:
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
```

- [ ] **Step 4: map-engine-port.ts**

Create `packages/map-runtime/src/port/map-engine-port.ts`:
```ts
import type { FeatureCollection } from 'geojson';
import type { Viewport } from './types.js';

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
  destroy(): void;
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `cd packages/map-runtime && npx vitest run src/port`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime/src/port
git commit -m "feat(map-runtime): MapEnginePort + port types"
```

---

## Task 5: CRS — `registerVietnamCrs()`

**Files:**
- Create: `packages/map-runtime/src/openlayers/crs.ts`
- Test: `packages/map-runtime/src/openlayers/crs.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `packages/map-runtime/src/openlayers/crs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { registerVietnamCrs } from './crs.js';

describe('registerVietnamCrs', () => {
  it('registers VN-2000 UTM 48N definitions (idempotent)', () => {
    registerVietnamCrs();
    registerVietnamCrs(); // second call is a no-op
    expect(proj4.defs('EPSG:3405')).toBeTruthy();
    expect(proj4.defs('EPSG:9210')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/crs`
Expected: FAIL — `./crs.js` not found.

- [ ] **Step 3: crs.ts**

Create `packages/map-runtime/src/openlayers/crs.ts`:
```ts
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';

let registered = false;

/**
 * VN-2000 / UTM zone 48N (EPSG:3405 & EPSG:9210). Ported from the proven
 * gis-fe adapter so real Vietnamese data projects correctly in a later slice.
 */
export function registerVietnamCrs(): void {
  if (registered) return;
  const utm48n =
    '+proj=utm +zone=48 +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  proj4.defs('EPSG:3405', utm48n);
  proj4.defs('EPSG:9210', utm48n);
  register(proj4);
  registered = true;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/crs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/map-runtime/src/openlayers/crs.ts packages/map-runtime/src/openlayers/crs.test.ts
git commit -m "feat(map-runtime): register VN-2000 CRS"
```

---

## Task 6: style-adapter (kind → style)

**Files:**
- Create: `packages/map-runtime/src/openlayers/style-adapter.ts`
- Test: `packages/map-runtime/src/openlayers/style-adapter.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `packages/map-runtime/src/openlayers/style-adapter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { styleForKind, KIND_COLORS } from './style-adapter.js';

describe('style-adapter', () => {
  it('returns a distinct base style per kind', () => {
    expect(styleForKind('node', false)).toBeTruthy();
    expect(KIND_COLORS.pipe).not.toBe(KIND_COLORS.node);
  });
  it('returns a highlighted style when selected', () => {
    const normal = styleForKind('node', false);
    const selected = styleForKind('node', true);
    expect(selected).not.toBe(normal);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/style-adapter`
Expected: FAIL — module not found.

- [ ] **Step 3: style-adapter.ts**

Create `packages/map-runtime/src/openlayers/style-adapter.ts`:
```ts
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';

export const KIND_COLORS: Record<NetworkFeatureKind, string> = {
  pipe: '#0284c7',
  node: '#16a34a',
  facility: '#d97706',
  component: '#7c3aed',
};

const HIGHLIGHT = '#ef4444';

export function styleForKind(kind: NetworkFeatureKind, selected: boolean): Style {
  const color = selected ? HIGHLIGHT : (KIND_COLORS[kind] ?? '#64748b');
  const width = selected ? 5 : 3;
  return new Style({
    stroke: new Stroke({ color, width }),
    fill: new Fill({ color: `${color}33` }),
    image: new CircleStyle({
      radius: selected ? 7 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#ffffff', width: 1 }),
    }),
  });
}
```

> Note: `@wn/contracts/map-features` is a dependency of `@wn/map-runtime` for the
> `NetworkFeatureKind` type only. Add it in Step 4.

- [ ] **Step 4: Thêm dep contracts + cài**

Modify `packages/map-runtime/package.json` `dependencies` — thêm:
```json
    "@wn/contracts": "file:../contracts",
```
Run: `cd packages/map-runtime && HUSKY=0 npm install`

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/style-adapter`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime
git commit -m "feat(map-runtime): style-adapter (kind->style + highlight)"
```

---

## Task 7: OpenLayers adapter (lifecycle + layer + picker) + factory

**Files:**
- Create: `packages/map-runtime/src/openlayers/ol-map-adapter.ts` (gộp lifecycle/layer/picker, giữ <400 dòng)
- Create: `packages/map-runtime/src/factory.ts`
- Test: `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

- [ ] **Step 1: Viết test smoke (jsdom)**

Create `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { OlMapAdapter } from './ol-map-adapter.js';

const fc: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [105.8, 21] }, properties: { kind: 'node' } },
  ],
};

describe('OlMapAdapter (smoke, jsdom)', () => {
  it('mounts, sets features, sets view, selects, and destroys without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);

    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setView({ center: { lon: 105.81, lat: 21.01 }, zoom: 13 });
      adapter.setSelection('n1');
      expect(adapter.getSelection()).toBe('n1');
      expect(adapter.getView().zoom).toBeGreaterThan(12);
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/ol-map-adapter`
Expected: FAIL — `OlMapAdapter` not found.

- [ ] **Step 3: ol-map-adapter.ts**

Create `packages/map-runtime/src/openlayers/ol-map-adapter.ts`:
```ts
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat, toLonLat } from 'ol/proj';
import type { FeatureCollection } from 'geojson';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { MapViewOptions, Viewport } from '../port/types.js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';
import { styleForKind } from './style-adapter.js';
import { registerVietnamCrs } from './crs.js';

const DATA_PROJECTION = 'EPSG:4326';
const VIEW_PROJECTION = 'EPSG:3857';

export class OlMapAdapter implements MapEnginePort {
  #map: Map | null = null;
  #view: View;
  #layers = new Map<string, VectorLayer<VectorSource>>() as globalThis.Map<
    string,
    VectorLayer<VectorSource>
  >;
  #selected: string | null = null;
  #clickSubs = new Set<(id: string) => void>();
  #format = new GeoJSON({ dataProjection: DATA_PROJECTION, featureProjection: VIEW_PROJECTION });

  constructor(opts: MapViewOptions) {
    registerVietnamCrs();
    this.#view = new View({
      center: fromLonLat([opts.center.lon, opts.center.lat], opts.projection ?? VIEW_PROJECTION),
      zoom: opts.zoom,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      projection: opts.projection ?? VIEW_PROJECTION,
    });
  }

  mount(target: HTMLElement): void {
    this.#map = new Map({
      target,
      view: this.#view,
      layers: [new TileLayer({ source: new OSM() })],
    });
    this.#map.on('singleclick', (evt) => {
      const hit = this.#map!.forEachFeatureAtPixel(evt.pixel, (f) => f.getId());
      if (hit != null) this.#clickSubs.forEach((cb) => cb(String(hit)));
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
    const src = layer.getSource()!;
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
    return { center: { lon: center[0]!, lat: center[1]! }, zoom: this.#view.getZoom() ?? 0 };
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

  destroy(): void {
    this.#map?.setTarget(undefined);
    this.#map = null;
    this.#layers.clear();
    this.#clickSubs.clear();
  }
}
```

- [ ] **Step 4: factory.ts (lazy import OL)**

Create `packages/map-runtime/src/factory.ts`:
```ts
import type { MapEnginePort } from './port/map-engine-port.js';
import type { MapViewOptions } from './port/types.js';

/**
 * Each MFE calls this to get its own map. The `./openlayers` module is
 * dynamically imported so `ol` + `proj4` land in a separate lazy chunk.
 */
export async function createMapInstance(opts: MapViewOptions): Promise<MapEnginePort> {
  const { OlMapAdapter } = await import('./openlayers/ol-map-adapter.js');
  return new OlMapAdapter(opts);
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `cd packages/map-runtime && npx vitest run src/openlayers/ol-map-adapter`
Expected: PASS (smoke test). Nếu jsdom báo lỗi thiếu `getContext`, thêm vào đầu test file: `HTMLCanvasElement.prototype.getContext = () => null as never;` (OL chỉ cần khi render thực; smoke test không assert pixel).

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime/src/openlayers/ol-map-adapter.ts packages/map-runtime/src/factory.ts packages/map-runtime/src/openlayers/ol-map-adapter.test.ts
git commit -m "feat(map-runtime): OpenLayers adapter + lazy factory"
```

---

## Task 8: Solid integration `useMapRuntime`

**Files:**
- Create: `packages/map-runtime/src/solid/use-map-runtime.ts`
- Create: `packages/map-runtime/src/index.ts`
- Test: `packages/map-runtime/src/solid/use-map-runtime.test.tsx`

- [ ] **Step 1: Viết test thất bại**

Create `packages/map-runtime/src/solid/use-map-runtime.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { createMapRuntime } from './use-map-runtime.js';
import type { MapEnginePort } from '../port/map-engine-port.js';

const fakePort = (): MapEnginePort => ({
  mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
  setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
  onFeatureClick: () => () => {}, destroy: vi.fn(),
});

describe('createMapRuntime', () => {
  it('creates an instance via the injected factory and mounts on the ref', async () => {
    const port = fakePort();
    const factory = vi.fn(async () => port);
    function Comp() {
      const { containerRef } = createMapRuntime({
        view: { center: { lon: 105.8, lat: 21 }, zoom: 12 },
        factory,
      });
      return <div ref={containerRef} style={{ width: '400px', height: '300px' }} />;
    }
    render(() => <Comp />);
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(port.mount).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd packages/map-runtime && npx vitest run src/solid`
Expected: FAIL — module not found.

- [ ] **Step 3: use-map-runtime.ts**

Create `packages/map-runtime/src/solid/use-map-runtime.ts`:
```ts
import { createSignal, onCleanup, onMount } from 'solid-js';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { MapViewOptions } from '../port/types.js';
import { createMapInstance } from '../factory.js';

export interface UseMapRuntimeOptions {
  view: MapViewOptions;
  /** Override for tests; defaults to the lazy OpenLayers factory. */
  factory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}

export function createMapRuntime(opts: UseMapRuntimeOptions) {
  const [port, setPort] = createSignal<MapEnginePort | null>(null);
  let container: HTMLDivElement | undefined;
  const create = opts.factory ?? createMapInstance;

  const containerRef = (el: HTMLDivElement) => { container = el; };

  onMount(async () => {
    const instance = await create(opts.view);
    if (container) instance.mount(container);
    setPort(instance);
  });

  onCleanup(() => { port()?.destroy(); });

  return { containerRef, port };
}
```

- [ ] **Step 4: index.ts**

Create `packages/map-runtime/src/index.ts`:
```ts
export type { MapEnginePort } from './port/map-engine-port.js';
export type { Coordinate, Viewport, MapViewOptions } from './port/types.js';
export { createMapInstance } from './factory.js';
```

- [ ] **Step 5: Chạy test + typecheck + build**

Run: `cd packages/map-runtime && npx vitest run && npm run typecheck && npm run build && ls dist/solid`
Expected: tests PASS; typecheck clean; `dist/solid/use-map-runtime.js` tồn tại.

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime
git commit -m "feat(map-runtime): Solid createMapRuntime + package index/build"
```

---

## Task 9: gis-core nạp `@wn/map-runtime` + `entities/map-feature`

**Files:**
- Modify: `apps/gis-core/package.json` (dep), `apps/gis-core/src/shared/api/query-keys.ts`
- Create: `apps/gis-core/src/entities/map-feature/{model/types.ts,api/queries.ts,index.ts}`
- Test: `apps/gis-core/src/entities/map-feature/api/queries.test.ts`

- [ ] **Step 1: Thêm deps + cài**

Modify `apps/gis-core/package.json` `dependencies` — thêm:
```json
    "@wn/map-runtime": "file:../../packages/map-runtime",
    "geojson": "^0.5.0",
```
(và đảm bảo `@types/geojson` ở devDependencies: `"@types/geojson": "^7946.0.14"`).
Run: `cd packages/map-runtime && npm run build && cd ../../apps/gis-core && HUSKY=0 npm install`

- [ ] **Step 2: Viết test thất bại cho queries**

Create `apps/gis-core/src/entities/map-feature/api/queries.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/shared/api/mocks/server';
import { aMapFeatureCollection } from '@wn/contracts/testing';
import { fetchMapFeatures } from './queries';

describe('fetchMapFeatures', () => {
  it('fetches + parses a feature collection for a snapshot bbox', async () => {
    server.use(
      http.get('*/snapshot/:id/features', () => HttpResponse.json(aMapFeatureCollection({ count: 2 }))),
    );
    const fc = await fetchMapFeatures('snap-1', [105, 20, 106, 22]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.properties.kind).toBeTruthy();
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/entities/map-feature`
Expected: FAIL — `./queries` not found.

- [ ] **Step 4: model + api**

Create `apps/gis-core/src/entities/map-feature/model/types.ts`:
```ts
export { MapFeatureCollection, NetworkFeatureKind } from '@wn/contracts/map-features';
export type { MapFeatureCollection as MapFeatures, NetworkFeature, NetworkFeatureProps } from '@wn/contracts/map-features';
export type Bbox = [number, number, number, number];
```

Create `apps/gis-core/src/entities/map-feature/api/queries.ts`:
```ts
import { queryOptions } from '@tanstack/solid-query';
import { httpClient } from '@/shared/api/http-client';
import { queryKeys } from '@/shared/api/query-keys';
import { MapFeatureCollection, type Bbox, type MapFeatures } from '../model/types';

export async function fetchMapFeatures(snapshotId: string, bbox: Bbox): Promise<MapFeatures> {
  const raw = await httpClient.get<unknown>(
    `/snapshot/${snapshotId}/features?bbox=${bbox.join(',')}`,
  );
  return MapFeatureCollection.parse(raw);
}

export const mapFeaturesQueryOptions = (snapshotId: string, bbox: Bbox) =>
  queryOptions({
    queryKey: queryKeys.mapFeatures.byBbox(snapshotId, bbox),
    queryFn: () => fetchMapFeatures(snapshotId, bbox),
    staleTime: 1000 * 30,
  });
```

Create `apps/gis-core/src/entities/map-feature/index.ts`:
```ts
export { MapFeatureCollection, NetworkFeatureKind } from './model/types';
export type { MapFeatures, NetworkFeature, NetworkFeatureProps, Bbox } from './model/types';
export { fetchMapFeatures, mapFeaturesQueryOptions } from './api/queries';
```

- [ ] **Step 5: Thêm query key**

Modify `apps/gis-core/src/shared/api/query-keys.ts` — thêm vào object `queryKeys`:
```ts
  mapFeatures: {
    byBbox: (snapshotId: string, bbox: readonly number[]) =>
      ['map-features', snapshotId, bbox.join(',')] as const,
  },
```

- [ ] **Step 6: Chạy test để xác nhận pass**

Run: `cd apps/gis-core && npx vitest run src/entities/map-feature`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-core/package.json apps/gis-core/package-lock.json apps/gis-core/src/entities/map-feature apps/gis-core/src/shared/api/query-keys.ts
git commit -m "feat(gis-core): map-feature entity consuming @wn/map-runtime + contracts"
```

---

## Task 10: MSW handlers cho snapshot + map-features

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`

- [ ] **Step 1: Viết test thất bại (integration qua default handlers)**

Create `apps/gis-core/src/shared/api/mocks/map-features.handler.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fetchMapFeatures } from '@/entities/map-feature';

describe('default MSW handler: map-features', () => {
  it('serves a parseable collection without per-test overrides', async () => {
    const fc = await fetchMapFeatures('snap-1', [105, 20, 106, 22]);
    expect(fc.features.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/shared/api/mocks/map-features.handler.test.ts`
Expected: FAIL — request bị bypass (không có handler) → parse lỗi / network error.

- [ ] **Step 3: Thêm handlers**

Modify `apps/gis-core/src/shared/api/mocks/handlers.ts` — thêm import đầu file:
```ts
import { aMapFeatureCollection } from '@wn/contracts/testing'
import { aSnapshot } from '@wn/contracts/testing'
```
và thêm 2 handler vào mảng `handlers` (giữ pattern wildcard host `*`):
```ts
  http.get('*/snapshot/:id', ({ params }) =>
    HttpResponse.json(aSnapshot({ snapshotId: String(params.id) })),
  ),
  http.get('*/snapshot/:id/features', () =>
    HttpResponse.json(aMapFeatureCollection({ count: 6 })),
  ),
```
(Nếu file dùng biến `export const handlers = [ ... ]`, chèn vào trong mảng đó.)

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd apps/gis-core && npx vitest run src/shared/api/mocks/map-features.handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/shared/api/mocks
git commit -m "test(gis-core): MSW handlers for snapshot + map-features"
```

---

## Task 11: stores (viewport + selection)

**Files:**
- Create: `apps/gis-core/src/features/feature-selection/model/selection-store.ts`
- Create: `apps/gis-core/src/features/map-canvas/model/viewport-store.ts`
- Test: `apps/gis-core/src/features/feature-selection/model/selection-store.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `apps/gis-core/src/features/feature-selection/model/selection-store.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { createSelectionStore } from './selection-store';

describe('selection-store', () => {
  it('selects and clears a feature id', () => {
    createRoot((dispose) => {
      const s = createSelectionStore();
      expect(s.selectedId()).toBeNull();
      s.select('f1');
      expect(s.selectedId()).toBe('f1');
      s.clear();
      expect(s.selectedId()).toBeNull();
      dispose();
    });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/features/feature-selection/model`
Expected: FAIL — module not found.

- [ ] **Step 3: selection-store + viewport-store**

Create `apps/gis-core/src/features/feature-selection/model/selection-store.ts`:
```ts
import { createSignal } from 'solid-js';

/** One concern: which feature is currently selected. */
export function createSelectionStore() {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  return {
    selectedId,
    select: (id: string) => setSelectedId(id),
    clear: () => setSelectedId(null),
  };
}
```

Create `apps/gis-core/src/features/map-canvas/model/viewport-store.ts`:
```ts
import { createSignal } from 'solid-js';
import type { Viewport } from '@wn/map-runtime';

const HANOI: Viewport = { center: { lon: 105.83, lat: 21.02 }, zoom: 12 };

/** One concern: the current map viewport. */
export function createViewportStore(initial: Viewport = HANOI) {
  const [viewport, setViewport] = createSignal<Viewport>(initial);
  return { viewport, setViewport };
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd apps/gis-core && npx vitest run src/features/feature-selection/model`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/features/feature-selection/model apps/gis-core/src/features/map-canvas/model
git commit -m "feat(gis-core): viewport + selection stores (one concern each)"
```

---

## Task 12: widget `properties-palette`

**Files:**
- Create: `apps/gis-core/src/widgets/properties-palette/ui/properties-palette.tsx`
- Create: `apps/gis-core/src/widgets/properties-palette/index.ts`
- Test: `apps/gis-core/src/widgets/properties-palette/ui/properties-palette.test.tsx`

- [ ] **Step 1: Viết test thất bại**

Create `apps/gis-core/src/widgets/properties-palette/ui/properties-palette.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@solidjs/testing-library';
import { PropertiesPalette } from './properties-palette';

describe('PropertiesPalette', () => {
  it('shows an empty hint when nothing is selected', () => {
    const { getByTestId } = render(() => <PropertiesPalette feature={undefined} />);
    expect(getByTestId('palette-empty')).toBeInTheDocument();
  });

  it('renders feature properties when selected', () => {
    const { getByText } = render(() => (
      <PropertiesPalette
        feature={{ type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'node', name: 'Valve 1' } }}
      />
    ));
    expect(getByText('Valve 1')).toBeInTheDocument();
    expect(getByText('node')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/widgets/properties-palette`
Expected: FAIL — module not found.

- [ ] **Step 3: Component + barrel**

Create `apps/gis-core/src/widgets/properties-palette/ui/properties-palette.tsx`:
```tsx
import { Show } from 'solid-js';
import type { NetworkFeature } from '@/entities/map-feature';

export function PropertiesPalette(props: { feature: NetworkFeature | undefined }) {
  return (
    <aside class="w-72 shrink-0 border-l border-border bg-background p-4">
      <h2 class="mb-3 text-sm font-semibold">Properties</h2>
      <Show
        when={props.feature}
        fallback={<p data-testid="palette-empty" class="text-sm text-muted-foreground">Select a feature on the map.</p>}
      >
        {(f) => (
          <dl class="space-y-2 text-sm">
            <div><dt class="text-muted-foreground">Name</dt><dd>{f().properties.name ?? '—'}</dd></div>
            <div><dt class="text-muted-foreground">Kind</dt><dd>{f().properties.kind}</dd></div>
            <div><dt class="text-muted-foreground">Status</dt><dd>{f().properties.status ?? '—'}</dd></div>
            <div><dt class="text-muted-foreground">ID</dt><dd>{f().id}</dd></div>
          </dl>
        )}
      </Show>
    </aside>
  );
}
```

Create `apps/gis-core/src/widgets/properties-palette/index.ts`:
```ts
export { PropertiesPalette } from './ui/properties-palette';
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd apps/gis-core && npx vitest run src/widgets/properties-palette`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/widgets/properties-palette
git commit -m "feat(gis-core): properties-palette widget"
```

---

## Task 13: feature `map-canvas` (compose map-runtime + query + selection)

**Files:**
- Create: `apps/gis-core/src/features/map-canvas/ui/map-canvas.tsx`
- Create: `apps/gis-core/src/features/map-canvas/index.ts`
- Test: `apps/gis-core/src/features/map-canvas/ui/map-canvas.test.tsx`

- [ ] **Step 1: Viết test thất bại (mock @wn/map-runtime)**

Create `apps/gis-core/src/features/map-canvas/ui/map-canvas.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapCanvas } from './map-canvas';

const port: MapEnginePort = {
  mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
  setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
  onFeatureClick: vi.fn(() => () => {}), destroy: vi.fn(),
};

describe('MapCanvas', () => {
  it('creates the map and pushes fetched features into the port', async () => {
    const qc = new QueryClient();
    render(() => (
      <QueryClientProvider client={qc}>
        <MapCanvas snapshotId="snap-1" onSelect={() => {}} selectedId={null}
          mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    await waitFor(() => expect(port.setFeatures).toHaveBeenCalledWith('published', expect.anything()));
    expect(port.onFeatureClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/features/map-canvas/ui`
Expected: FAIL — module not found.

- [ ] **Step 3: map-canvas.tsx + barrel**

Create `apps/gis-core/src/features/map-canvas/ui/map-canvas.tsx`:
```tsx
import { createEffect, onCleanup } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { createMapRuntime } from '@wn/map-runtime/solid';
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';
import { mapFeaturesQueryOptions, type Bbox } from '@/entities/map-feature';
import { createViewportStore } from '../model/viewport-store';

const DEFAULT_BBOX: Bbox = [105.7, 20.9, 106.0, 21.1];

export function MapCanvas(props: {
  snapshotId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Test seam; defaults to the real lazy OpenLayers factory. */
  mapFactory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}) {
  const vp = createViewportStore();
  const { containerRef, port } = createMapRuntime({
    view: { ...vp.viewport() },
    factory: props.mapFactory,
  });

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
    if (p && data) p.setFeatures('published', data);
  });

  // Reflect external selection into the map.
  createEffect(() => {
    port()?.setSelection(props.selectedId);
  });

  return <div ref={containerRef} data-testid="map-canvas" class="h-full w-full" />;
}
```

Create `apps/gis-core/src/features/map-canvas/index.ts`:
```ts
export { MapCanvas } from './ui/map-canvas';
export { createViewportStore } from './model/viewport-store';
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `cd apps/gis-core && npx vitest run src/features/map-canvas/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/features/map-canvas
git commit -m "feat(gis-core): map-canvas feature (owns map instance + feature load)"
```

---

## Task 14: route `/gis` — compose viewer

**Files:**
- Create: `apps/gis-core/src/pages/gis/index.tsx`
- Create: `apps/gis-core/src/routes/gis.tsx`
- Test: `apps/gis-core/src/pages/gis/gis-page.test.tsx`

- [ ] **Step 1: Viết test thất bại**

Create `apps/gis-core/src/pages/gis/gis-page.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
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
    onFeatureClick: (cb) => { subs.add(cb); return () => subs.delete(cb); }, destroy: vi.fn(),
    fireClick: (id) => subs.forEach((c) => c(id)),
  };
}

describe('GisViewerPage', () => {
  it('selecting a feature on the map shows it in the palette', async () => {
    const qc = new QueryClient();
    const port = fakePort();
    const { getByTestId, findByText } = render(() => (
      <QueryClientProvider client={qc}>
        <GisViewerPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-canvas')).toBeInTheDocument());
    port.fireClick('feat-1');
    expect(await findByText('feat-1')).toBeInTheDocument(); // id shown in palette
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `cd apps/gis-core && npx vitest run src/pages/gis`
Expected: FAIL — module not found.

- [ ] **Step 3: page + route**

Create `apps/gis-core/src/pages/gis/index.tsx`:
```tsx
import { createMemo, createSignal } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';
import { MapCanvas } from '@/features/map-canvas';
import { PropertiesPalette } from '@/widgets/properties-palette';
import { createSelectionStore } from '@/features/feature-selection/model/selection-store';
import { mapFeaturesQueryOptions, type Bbox } from '@/entities/map-feature';

const DEFAULT_BBOX: Bbox = [105.7, 20.9, 106.0, 21.1];

export function GisViewerPage(props: {
  snapshotId?: string;
  mapFactory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}) {
  const snapshotId = () => props.snapshotId ?? 'snap-1';
  const selection = createSelectionStore();
  const features = useQuery(() => mapFeaturesQueryOptions(snapshotId(), DEFAULT_BBOX));

  const selectedFeature = createMemo(() =>
    features.data?.features.find((f) => f.id === selection.selectedId()),
  );

  return (
    <div class="flex h-screen">
      <main class="relative flex-1">
        <MapCanvas
          snapshotId={snapshotId()}
          selectedId={selection.selectedId()}
          onSelect={selection.select}
          mapFactory={props.mapFactory}
        />
      </main>
      <PropertiesPalette feature={selectedFeature()} />
    </div>
  );
}
```

Create `apps/gis-core/src/routes/gis.tsx`:
```tsx
import { createFileRoute, lazyRouteComponent } from '@tanstack/solid-router';
import { authGuard } from '@/shared/lib/route-guards';

export const Route = createFileRoute('/gis')({
  beforeLoad: async () => { await authGuard(); },
  component: lazyRouteComponent(() => import('@/pages/gis'), 'GisViewerPage'),
});
```

- [ ] **Step 4: Regenerate routes + chạy test**

Run: `cd apps/gis-core && npm run routes:generate && npx vitest run src/pages/gis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/pages/gis apps/gis-core/src/routes/gis.tsx apps/gis-core/src/routeTree.gen.ts
git commit -m "feat(gis-core): /gis viewer route composing canvas + palette"
```

---

## Task 15: Gates xanh + harness update

**Files:** none (verification) + harness durable layer

- [ ] **Step 1: map-runtime gates**

Run: `cd packages/map-runtime && npm run typecheck && npm test && npm run build`
Expected: typecheck clean; tests PASS; dist emitted.

- [ ] **Step 2: contracts gates**

Run: `cd packages/contracts && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: gis-core gates**

Run: `cd apps/gis-core && npm run typecheck && npm run lint && npm run test:run && npm run build && npm run size`
Expected: typecheck clean; lint 0 errors; tests PASS; build OK; size — entry ≤120KB gz, và chunk OpenLayers (lazy) ≤200KB gz. Nếu `size-limit` chưa có rule cho chunk map-engine, thêm vào `apps/gis-core/package.json` `size-limit`:
```json
    { "path": "dist/assets/*ol*.js", "limit": "200 kB", "gzip": true }
```

- [ ] **Step 4: Cập nhật matrix + trace + story**

Run:
```bash
cd water-network-fe
./scripts/bin/harness-cli story update --id US-002 --unit 1 --integration 1 --platform 1 --e2e 0 \
  --evidence "Viewer foundation: map-runtime+contracts tests green; gis-core map-canvas/feature-selection/properties-palette + /gis route; MSW-driven; build+size OK. e2e (real map render) pending."
./scripts/bin/harness-cli trace --summary "US-002 slice 2.1 Viewer foundation implemented (map-runtime OL package + map-features contract + gis-core viewer; MSW mock; auth mock)" \
  --story US-002 --agent "<agent>" --outcome success \
  --actions "contracts map-features; map-runtime port+OL adapter+factory+solid; gis-core entity/stores/canvas/selection/palette/route; gates green" \
  --read "spec; gis-fe openlayers-adapter (reference)" \
  --changed "packages/contracts/*, packages/map-runtime/*, apps/gis-core/*" \
  --errors "none" --duration 0 --tokens 0 --notes "FE independent of BE; e2e map-render deferred"
```

- [ ] **Step 5: Commit cuối**

```bash
git add -A
git commit -m "chore(US-002): viewer foundation gates green + harness update"
```

---

## Phụ lục — Self-review (đã chạy khi viết plan)

- **Spec coverage:** map-runtime port/adapter/CRS/lazy ✓ (T3–T8); map-features contract ✓ (T1–T2); FSD entity/stores/canvas/selection/palette/route ✓ (T9–T14); MSW ✓ (T10); testing layers ✓ (mỗi task); size/boundaries ✓ (T15); non-goals tôn trọng (không editor/search/layer-control).
- **Type consistency:** `MapEnginePort` method names (`mount/setView/getView/setFeatures/setSelection/getSelection/onFeatureClick/destroy`) dùng nhất quán giữa port (T4), adapter (T7), mock test (T13/T14), và Solid hook (T8). `MapFeatureCollection`/`NetworkFeature`/`NetworkFeatureKind`/`Bbox` nhất quán contracts↔gis-core. `createMapRuntime({view,factory})` ↔ `createMapInstance(opts)` khớp signature.
- **Placeholder scan:** không còn TBD/TODO; mọi step có code/lệnh cụ thể.
- **Lưu ý jsdom/OL:** T7 step 5 nêu cách xử lý nếu canvas getContext thiếu; component tests dùng mock port nên không phụ thuộc canvas.
