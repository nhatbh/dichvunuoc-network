# GIS Core — Editor Digitize (slice 2.3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editor route `/gis/editor` (behind the `NEW_EDITOR` flag) where the user draws a pipe (LineString) or node (Point); the geometry is persisted to a draft via a mocked CQRS command and re-rendered on a distinct Draft plane.

**Architecture:** The map port grows by exactly two ol-free methods (`setDrawMode` + `onDrawComplete`); `ol/interaction/Draw` stays inside the lazy adapter. A new `@wn/contracts/draft` module carries the first write model. Draft features are **server state** (TanStack Query over MSW); the only client edit-state is a `drawKind` signal. The editor page reuses `MapCanvas` (published context) + `MapShell`, adds a `DigitizeToolbar` and a `DraftPlane`.

**Tech Stack:** Solid.js, TanStack Solid Query, OpenLayers (lazy), Zod (`@wn/contracts`), MSW, Vitest, TanStack Router (file-based).

---

## Conventions for every task

- TDD: write the failing test first, run it red, implement minimally, run green, commit.
- Exact commands:
  - contracts test: `npm run contracts:test`
  - map-runtime test: `npm --prefix packages/map-runtime run test`
  - one app test file: `npm --prefix apps/gis-core run test:run -- <path>`
  - whole app suite: `npm --prefix apps/gis-core run test:run`
- Commit message footer (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Build order:** Task 1 rebuilds `@wn/contracts`; Task 3 rebuilds `@wn/map-runtime`. The app tasks (5–9) consume those built `dist/`s, so do not start them before Tasks 1 + 3 are committed.
- Component/integration tests that render the runtime begin with the **Appendix A prelude** (verbatim block at the end of this plan).

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/contracts/src/draft/index.ts` | draft write contracts (request + draft feature + collection) | 1 |
| `packages/contracts/src/testing/index.ts` | `aDraftFeature` / `aDraftFeatureCollection` builders | 1 |
| `packages/contracts/src/index.ts`, `package.json` | export the `draft` subpath | 1 |
| `packages/map-runtime/src/port/types.ts` | `DrawGeometry` type | 2 |
| `packages/map-runtime/src/port/map-engine-port.ts` | `setDrawMode` + `onDrawComplete` | 2 |
| `packages/map-runtime/src/index.ts` | export `DrawGeometry` | 2 |
| `packages/map-runtime/src/openlayers/style-adapter.ts` | draft style variant | 3 |
| `packages/map-runtime/src/openlayers/ol-map-adapter.ts` | draw interaction + draft-layer style | 3 |
| 7 existing `*.test.*` fake ports | satisfy the grown interface | 4 |
| `apps/gis-core/src/shared/api/mocks/handlers.ts` | draft working-set + POST/GET | 5 |
| `apps/gis-core/src/test/setup.ts` | reset working-set per test | 5 |
| `apps/gis-core/src/shared/api/query-keys.ts` | `draftFeatures` key group | 6 |
| `apps/gis-core/src/entities/draft-feature/*` | query + command + types | 6 |
| `apps/gis-core/src/features/digitize/*` | draw-mode store + toolbar | 7 |
| `apps/gis-core/src/features/draft-plane/*` | render draft plane | 8 |
| `apps/gis-core/src/pages/gis/editor/index.tsx` | `GisEditorPage` | 9 |
| `apps/gis-core/src/routes/gis.editor.tsx` | `/gis/editor` behind `NEW_EDITOR` | 9 |

---

## Task 1: `@wn/contracts` — `draft` module + builders + build

**Files:**
- Create: `packages/contracts/src/draft/index.ts`
- Create: `packages/contracts/src/draft/draft.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/testing/index.ts`
- Modify: `packages/contracts/package.json` (exports map)

- [ ] **Step 1: Write the failing test.** Create `packages/contracts/src/draft/draft.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CreateDraftFeatureRequest,
  DraftNetworkFeature,
  DraftFeatureCollection,
} from './index.js';
import { aDraftFeature, aDraftFeatureCollection } from '../testing/index.js';

describe('draft contracts', () => {
  it('accepts a valid create request (pipe + LineString)', () => {
    const req = {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
      correlationId: 'c-1',
    };
    expect(CreateDraftFeatureRequest.parse(req).kind).toBe('pipe');
  });

  it('rejects a request missing correlationId', () => {
    const bad = { kind: 'node', geometry: { type: 'Point', coordinates: [105.8, 21] } };
    expect(CreateDraftFeatureRequest.safeParse(bad).success).toBe(false);
  });

  it('builds a draft feature with status draft', () => {
    const f = aDraftFeature({ id: 'draft-1' });
    expect(DraftNetworkFeature.parse(f).id).toBe('draft-1');
    expect(f.properties.status).toBe('draft');
  });

  it('builds a parseable draft collection', () => {
    const c = aDraftFeatureCollection({ count: 2 });
    expect(DraftFeatureCollection.parse(c).features).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run red.** `npm run contracts:test`
Expected: FAIL — `./index.js` has no such exports / `aDraftFeature` undefined.

- [ ] **Step 3: Create `packages/contracts/src/draft/index.ts`.**

```typescript
import { z } from 'zod';
import { NetworkFeatureKind, NetworkGeometry, NetworkFeatureProps } from '../map-features/index.js';

/** Command request: create one feature in the active draft (CQRS, §6.3). */
export const CreateDraftFeatureRequest = z.object({
  kind: NetworkFeatureKind,
  geometry: NetworkGeometry,
  correlationId: z.string(),
});
export type CreateDraftFeatureRequest = z.infer<typeof CreateDraftFeatureRequest>;

/** A feature living in the draft plane (server-assigned id, status 'draft'). */
export const DraftNetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,
});
export type DraftNetworkFeature = z.infer<typeof DraftNetworkFeature>;

export const DraftFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(DraftNetworkFeature),
});
export type DraftFeatureCollection = z.infer<typeof DraftFeatureCollection>;
```

- [ ] **Step 4: Add builders to `packages/contracts/src/testing/index.ts`.** Extend the `import type` line and append the two builders:

```typescript
// extend the existing `import type { ... } from '../map-features/index.js';` line to also import:
//   NetworkFeatureProps
import type { DraftFeatureCollection, DraftNetworkFeature } from '../draft/index.js';

export function aDraftFeature(
  overrides: Partial<DraftNetworkFeature> = {},
): DraftNetworkFeature {
  return {
    type: 'Feature',
    id: 'draft-1',
    geometry: { type: 'LineString', coordinates: [[105.8, 21.0], [105.81, 21.01]] },
    properties: { kind: 'pipe', name: 'Draft pipe', status: 'draft' },
    ...overrides,
  };
}

export function aDraftFeatureCollection(
  opts: { count?: number } = {},
): DraftFeatureCollection {
  const count = opts.count ?? 2;
  const features: DraftNetworkFeature[] = Array.from({ length: count }, (_, i) => ({
    type: 'Feature' as const,
    id: `draft-${i + 1}`,
    geometry: { type: 'Point' as const, coordinates: [105.8 + i * 0.01, 21.0 + i * 0.01] },
    properties: { kind: 'node' as const, name: `Draft ${i + 1}`, status: 'draft' },
  }));
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 5: Re-export from `packages/contracts/src/index.ts`.** Append:

```typescript
export * from './draft/index.js';
```

(No collision: `draft/index.ts` only `import`s the shared map-features symbols, it does not re-export them.)

- [ ] **Step 6: Add the `./draft` subpath to `packages/contracts/package.json`.** Inside `"exports"`, after the `"./map-features"` entry, add:

```json
    ,"./draft": {
      "types": "./dist/draft/index.d.ts",
      "import": "./dist/draft/index.js"
    }
```

(Match the existing formatting — the comma placement above is illustrative; ensure valid JSON.)

- [ ] **Step 7: Run green.** `npm run contracts:test`
Expected: PASS.

- [ ] **Step 8: Build contracts so consumers see the new exports.**
Run: `npm --prefix packages/contracts run build`
Expected: exits 0; `packages/contracts/dist/draft/index.js` exists.

- [ ] **Step 9: Commit.**

```bash
git add packages/contracts/src/draft packages/contracts/src/testing/index.ts \
  packages/contracts/src/index.ts packages/contracts/package.json packages/contracts/dist
git commit -m "feat(contracts): draft write module (CreateDraftFeatureRequest + DraftNetworkFeature) + builders"
```

---

## Task 2: `@wn/map-runtime` — port `setDrawMode` + `onDrawComplete`

**Files:**
- Modify: `packages/map-runtime/src/port/types.ts`
- Modify: `packages/map-runtime/src/port/map-engine-port.ts`
- Modify: `packages/map-runtime/src/index.ts`
- Modify (test): `packages/map-runtime/src/port/map-engine-port.test.ts`

- [ ] **Step 1: Extend the contract test (red).** In `map-engine-port.test.ts`: extend the imports, the `FakePort` type, `makeFake`, and add one test.

Change the import lines at the top:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Geometry } from 'geojson';
import type { MapEnginePort } from './map-engine-port.js';
import type { Coordinate, DrawGeometry, Viewport } from './types.js';
```

Extend the `FakePort` type (add two members):

```typescript
type FakePort = MapEnginePort & {
  emitClick: (id: string) => void;
  emitPointer: (c: Coordinate | null) => void;
  emitDraw: (g: Geometry) => void;
  drawMode: DrawGeometry | null;
  visible: Map<string, boolean>;
  basemap: string;
  lastFit: [number, number, number, number] | null;
};
```

In `makeFake`, add a draw-subscriber set near the other `const subs`/`pointerSubs`:

```typescript
  const drawSubs = new Set<(g: Geometry) => void>();
```

Add these two members to the `fake` object literal (next to `onPointerMove`):

```typescript
    setDrawMode: (g) => { fake.drawMode = g; },
    onDrawComplete: (cb) => { drawSubs.add(cb); return () => drawSubs.delete(cb); },
```

Add these two members to the trailing fields of the literal (next to `lastFit: null`):

```typescript
    drawMode: null,
    emitDraw: (g) => drawSubs.forEach((cb) => cb(g)),
```

Append this test inside `describe('MapEnginePort contract', ...)`:

```typescript
  it('records draw mode and notifies + unsubscribes draw complete', () => {
    const p = makeFake();
    p.setDrawMode('LineString');
    expect(p.drawMode).toBe('LineString');
    const seen: Geometry[] = [];
    const off = p.onDrawComplete((g) => seen.push(g));
    const line: Geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] };
    p.emitDraw(line);
    off();
    p.emitDraw({ type: 'Point', coordinates: [0, 0] });
    expect(seen).toEqual([line]);
    p.setDrawMode(null);
    expect(p.drawMode).toBeNull();
  });
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/port/map-engine-port.test.ts`
Expected: FAIL — `DrawGeometry` not exported / `setDrawMode` not on `MapEnginePort`.

- [ ] **Step 3: Add `DrawGeometry` to `port/types.ts`.** Append:

```typescript
/** Geometry kinds the draw interaction can produce. */
export type DrawGeometry = 'LineString' | 'Point';
```

- [ ] **Step 4: Add the two methods to `port/map-engine-port.ts`.** Extend the type imports and the interface:

```typescript
import type { FeatureCollection, Geometry } from 'geojson';
import type { Coordinate, DrawGeometry, Extent, FitOptions, Viewport } from './types.js';
```

Add inside the `MapEnginePort` interface, just before `destroy()`:

```typescript
  /** Enter draw mode for a geometry kind (null exits). The ol Draw interaction lives only in the adapter. */
  setDrawMode(geometry: DrawGeometry | null): void;
  /** Subscribe to completed draws; cb receives the geometry as GeoJSON (EPSG:4326). Returns unsubscribe. */
  onDrawComplete(cb: (geometry: Geometry) => void): () => void;
```

- [ ] **Step 5: Export `DrawGeometry` from `packages/map-runtime/src/index.ts`.** Extend the types line:

```typescript
export type { Coordinate, Viewport, MapViewOptions, Extent, FitOptions, DrawGeometry } from './port/types.js';
```

- [ ] **Step 6: Run green.** `npm --prefix packages/map-runtime run test -- src/port/map-engine-port.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/map-runtime/src/port packages/map-runtime/src/index.ts
git commit -m "feat(map-runtime): grow MapEnginePort by setDrawMode/onDrawComplete (ol-free draw seam)"
```

---

## Task 3: OL adapter — draw interaction + draft style + build

**Files:**
- Modify: `packages/map-runtime/src/openlayers/style-adapter.ts`
- Modify (test): `packages/map-runtime/src/openlayers/style-adapter.test.ts`
- Modify: `packages/map-runtime/src/openlayers/ol-map-adapter.ts`
- Modify (test): `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

- [ ] **Step 1: Style test (red).** Append to `style-adapter.test.ts` inside `describe('style-adapter', ...)`:

```typescript
  it('renders draft features with a dashed stroke', () => {
    const draft = styleForKind('pipe', false, true);
    expect(draft.getStroke()?.getLineDash()).toEqual([6, 6]);
    const published = styleForKind('pipe', false, false);
    expect(published.getStroke()?.getLineDash() ?? null).toBeNull();
  });
```

- [ ] **Step 2: Run red.** `npm --prefix packages/map-runtime run test -- src/openlayers/style-adapter.test.ts`
Expected: FAIL — `styleForKind` takes 2 args / no line dash.

- [ ] **Step 3: Add the `draft` param to `styleForKind` in `style-adapter.ts`.** Replace the function body:

```typescript
export function styleForKind(kind: NetworkFeatureKind, selected: boolean, draft = false): Style {
  const color = selected ? HIGHLIGHT : (KIND_COLORS[kind] ?? '#64748b');
  const width = selected ? 5 : 3;
  return new Style({
    stroke: new Stroke({ color, width, lineDash: draft ? [6, 6] : undefined }),
    fill: new Fill({ color: `${color}${draft ? '22' : '33'}` }),
    image: new CircleStyle({
      radius: selected ? 7 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: draft ? '#f59e0b' : '#ffffff', width: draft ? 2 : 1 }),
    }),
  });
}
```

- [ ] **Step 4: Run green.** `npm --prefix packages/map-runtime run test -- src/openlayers/style-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Adapter test (red).** Append to `ol-map-adapter.test.ts` inside `describe('OlMapAdapter (smoke, jsdom)', ...)`:

```typescript
  it('enters and exits draw mode and subscribes to draw completion without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      const off = adapter.onDrawComplete(() => {});
      adapter.setDrawMode('LineString');
      adapter.setDrawMode('Point');
      adapter.setDrawMode(null);
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
```

- [ ] **Step 6: Run red.** `npm --prefix packages/map-runtime run test -- src/openlayers/ol-map-adapter.test.ts`
Expected: FAIL — `setDrawMode`/`onDrawComplete` not on `OlMapAdapter`.

- [ ] **Step 7: Implement in `ol-map-adapter.ts`.** Add imports near the top:

```typescript
import Draw from 'ol/interaction/Draw';
import type { Geometry } from 'geojson';
import type { Coordinate, DrawGeometry, Extent, FitOptions, MapViewOptions, Viewport } from '../port/types.js';
```

(Replace the existing `import type { Coordinate, Extent, ... }` line with the one above — it just adds `DrawGeometry`.)

Add these private fields next to the other `#` fields:

```typescript
  #drawSource = new VectorSource();
  #draw: Draw | null = null;
  #drawSubs = new Set<(g: Geometry) => void>();
```

In `setFeatures`, replace the `layer.setStyle(...)` call so the `draft` layer styles dashed:

```typescript
    const isDraft = layerId === 'draft';
    layer.setStyle((feat) => {
      const kind = (feat.get('kind') ?? 'component') as NetworkFeatureKind;
      return styleForKind(kind, feat.getId() === this.#selected, isDraft);
    });
```

Add the two methods (place them after `onPointerMove`):

```typescript
  setDrawMode(geometry: DrawGeometry | null): void {
    if (this.#draw) {
      this.#map?.removeInteraction(this.#draw);
      this.#draw = null;
    }
    if (!geometry || !this.#map) return;
    this.#drawSource.clear();
    const draw = new Draw({ source: this.#drawSource, type: geometry });
    draw.on('drawend', (evt) => {
      const g = evt.feature.getGeometry();
      if (!g) return;
      const geojson = this.#format.writeGeometryObject(g, {
        featureProjection: VIEW_PROJECTION,
        dataProjection: DATA_PROJECTION,
      }) as Geometry;
      this.#drawSubs.forEach((cb) => cb(geojson));
    });
    this.#map.addInteraction(draw);
    this.#draw = draw;
  }

  onDrawComplete(cb: (g: Geometry) => void): () => void {
    this.#drawSubs.add(cb);
    return () => this.#drawSubs.delete(cb);
  }
```

In `destroy()`, remove the interaction before nulling the map and clear the draw state. Replace the body:

```typescript
  destroy(): void {
    if (this.#draw) {
      this.#map?.removeInteraction(this.#draw);
      this.#draw = null;
    }
    this.#map?.setTarget(undefined);
    this.#map = null;
    this.#layers.clear();
    this.#clickSubs.clear();
    this.#pointerSubs.clear();
    this.#drawSubs.clear();
    this.#drawSource.clear();
  }
```

- [ ] **Step 8: Run green (whole package).** `npm --prefix packages/map-runtime run test`
Expected: PASS (all suites).

- [ ] **Step 9: Build the package so gis-core consumes the new surface.**
Run: `npm --prefix packages/map-runtime run build`
Expected: exits 0; `packages/map-runtime/dist/openlayers/ol-map-adapter.js` updated.

- [ ] **Step 10: Commit.**

```bash
git add packages/map-runtime/src/openlayers packages/map-runtime/dist
git commit -m "feat(map-runtime): OlMapAdapter draw interaction (Draw->GeoJSON 4326) + dashed draft layer style"
```

---

## Task 4: Update existing fake ports for the grown interface

The 2 new interface methods break every object typed as `MapEnginePort` in tests at **typecheck** (vitest transpiles without types, so test runs stay green, but `tsc --noEmit` in the gate sweep would fail). Update all 7 remaining fakes now so typecheck stays green. (`map-engine-port.test.ts` was already done in Task 2; `ol-map-adapter.test.ts` uses the real class — skip it.)

**Files (each gets the same two members added next to its `destroy:` entry):**
- `apps/gis-core/src/features/feature-search/ui/feature-search.test.tsx:53`
- `apps/gis-core/src/features/layer-control/ui/layer-control.test.tsx:53`
- `apps/gis-core/src/features/coordinate-readout/ui/coordinate-readout.test.tsx:52`
- `apps/gis-core/src/features/map-canvas/ui/map-canvas.test.tsx:59`
- `apps/gis-core/src/shared/lib/map-runtime/map-runtime-context.test.tsx:47`
- `apps/gis-core/src/pages/gis/gis-page.test.tsx:63`
- `packages/map-runtime/src/solid/use-map-runtime.test.tsx:9`

- [ ] **Step 1: Add the two members to each fake.** In each file, find the fake port object literal (the one containing `fitToBbox`/`destroy: vi.fn()`) and add inside it:

```typescript
    setDrawMode: vi.fn(), onDrawComplete: () => () => {},
```

For `packages/map-runtime/src/solid/use-map-runtime.test.tsx` the fake omits several methods already; add the same two members alongside its existing ones. If that fake is typed loosely (e.g. `as MapEnginePort` over a partial), still add the two members for consistency.

- [ ] **Step 2: Verify app suite still green.** `npm --prefix apps/gis-core run test:run`
Expected: PASS (unchanged count).

- [ ] **Step 3: Verify app typecheck green.** `npm --prefix apps/gis-core run typecheck`
Expected: exits 0 (no "missing setDrawMode/onDrawComplete" errors).

- [ ] **Step 4: Verify package suite green.** `npm --prefix packages/map-runtime run test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/gis-core/src packages/map-runtime/src/solid/use-map-runtime.test.tsx
git commit -m "test: extend fake MapEnginePorts with setDrawMode/onDrawComplete"
```

---

## Task 5: MSW — draft working-set + POST/GET handlers

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`
- Modify: `apps/gis-core/src/test/setup.ts`
- Create (test): `apps/gis-core/src/shared/api/mocks/draft.handler.test.ts`

- [ ] **Step 1: Write the failing handler test.** Create `draft.handler.test.ts` (node env, direct httpClient):

```typescript
// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';

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

const { httpClient } = await import('@/shared/api/http-client');
const { resetDraftStore } = await import('@/shared/api/mocks/handlers');
const { DraftNetworkFeature, DraftFeatureCollection } = await import('@wn/contracts/draft');

beforeEach(() => resetDraftStore());

describe('default MSW handler: draft features', () => {
  it('POST creates a draft feature (server id + status draft)', async () => {
    const raw = await httpClient.post<unknown>('/snapshot/snap-1/draft/features', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
      correlationId: 'c-1',
    });
    const created = DraftNetworkFeature.parse(raw);
    expect(created.id).toBeTruthy();
    expect(created.properties.status).toBe('draft');
    expect(created.properties.kind).toBe('pipe');
  });

  it('GET returns the accumulated draft collection', async () => {
    await httpClient.post('/snapshot/snap-1/draft/features', {
      kind: 'node',
      geometry: { type: 'Point', coordinates: [105.8, 21] },
      correlationId: 'c-2',
    });
    const raw = await httpClient.get<unknown>('/snapshot/snap-1/draft/features');
    expect(DraftFeatureCollection.parse(raw).features).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: FAIL — `resetDraftStore` not exported / no draft handlers (404).

- [ ] **Step 3: Edit `handlers.ts`.** Add the import (extend the existing testing import line) and a working-set; register the two handlers **before** the generic `*/snapshot/:id` GET.

Extend the contracts import near the top:

```typescript
import { aSnapshot, aMapFeatureCollection } from '@wn/contracts/testing'
import { CreateDraftFeatureRequest, type DraftNetworkFeature } from '@wn/contracts/draft'
```

Add the working-set + reset above `export const handlers`:

```typescript
// In-memory draft working-set (single-user mock). Reset per test via resetDraftStore().
let draftFeatures: DraftNetworkFeature[] = []
let draftSeq = 0
export function resetDraftStore(): void {
  draftFeatures = []
  draftSeq = 0
}
```

Add these two handlers inside the `handlers` array, immediately after the `http.get('*/snapshot/:id/features', ...)` entry:

```typescript
  http.post('*/snapshot/:id/draft/features', async ({ request }) => {
    const parsed = CreateDraftFeatureRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid draft feature' }, { status: 422 })
    }
    const { kind, geometry } = parsed.data
    const created: DraftNetworkFeature = {
      type: 'Feature',
      id: `draft-${++draftSeq}`,
      geometry,
      properties: { kind, name: `Draft ${kind} ${draftSeq}`, status: 'draft' },
    }
    draftFeatures.push(created)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.get('*/snapshot/:id/draft/features', () =>
    HttpResponse.json({ type: 'FeatureCollection', features: draftFeatures }),
  ),
```

- [ ] **Step 4: Reset the working-set per test in `setup.ts`.** Add the import and the reset call in the existing `afterEach`:

```typescript
import { resetDraftStore } from '@/shared/api/mocks/handlers'
```

```typescript
afterEach(() => {
  server.resetHandlers()
  resetDraftStore()
  cleanup()
})
```

- [ ] **Step 5: Run green.** `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/shared/api/mocks/handlers.ts apps/gis-core/src/test/setup.ts \
  apps/gis-core/src/shared/api/mocks/draft.handler.test.ts
git commit -m "feat(gis-core): MSW draft working-set + POST/GET /snapshot/:id/draft/features"
```

---

## Task 6: Entity `draft-feature` — query + command

**Files:**
- Modify: `apps/gis-core/src/shared/api/query-keys.ts`
- Create: `apps/gis-core/src/entities/draft-feature/model/types.ts`
- Create: `apps/gis-core/src/entities/draft-feature/api/queries.ts`
- Create: `apps/gis-core/src/entities/draft-feature/api/commands.ts`
- Create: `apps/gis-core/src/entities/draft-feature/index.ts`
- Create (test): `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts`

- [ ] **Step 1: Add the key group to `query-keys.ts`.** Inside the `queryKeys` object, after the `mapFeatures` group:

```typescript
  draftFeatures: {
    all: (snapshotId: string) => ['draft-features', snapshotId] as const,
  },
```

- [ ] **Step 2: Write the failing test.** Create `draft-feature/api/draft-feature.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';

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

const { createDraftFeature, fetchDraftFeatures } = await import('@/entities/draft-feature');
const { resetDraftStore } = await import('@/shared/api/mocks/handlers');

beforeEach(() => resetDraftStore());

describe('draft-feature entity', () => {
  it('createDraftFeature posts and returns a parsed draft feature', async () => {
    const created = await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
    });
    expect(created.properties.status).toBe('draft');
    expect(created.id).toMatch(/^draft-/);
  });

  it('fetchDraftFeatures reads back what was created', async () => {
    await createDraftFeature('snap-1', {
      kind: 'node',
      geometry: { type: 'Point', coordinates: [105.8, 21] },
    });
    const collection = await fetchDraftFeatures('snap-1');
    expect(collection.features).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run red.** `npm --prefix apps/gis-core run test:run -- src/entities/draft-feature/api/draft-feature.test.ts`
Expected: FAIL — module `@/entities/draft-feature` not found.

- [ ] **Step 4: Create `model/types.ts`.**

```typescript
export {
  CreateDraftFeatureRequest,
  DraftNetworkFeature,
  DraftFeatureCollection,
} from '@wn/contracts/draft';
export type {
  CreateDraftFeatureRequest as CreateDraftFeatureInput,
  DraftNetworkFeature as DraftFeature,
  DraftFeatureCollection as DraftFeatures,
} from '@wn/contracts/draft';
```

- [ ] **Step 5: Create `api/queries.ts`.**

```typescript
import { queryOptions } from '@tanstack/solid-query';
import { httpClient } from '@/shared/api/http-client';
import { queryKeys } from '@/shared/api/query-keys';
import { DraftFeatureCollection, type DraftFeatures } from '../model/types';

export async function fetchDraftFeatures(snapshotId: string): Promise<DraftFeatures> {
  const raw = await httpClient.get<unknown>(`/snapshot/${snapshotId}/draft/features`);
  return DraftFeatureCollection.parse(raw);
}

export const draftFeaturesQueryOptions = (snapshotId: string) =>
  queryOptions({
    queryKey: queryKeys.draftFeatures.all(snapshotId),
    queryFn: () => fetchDraftFeatures(snapshotId),
    staleTime: 1000 * 30,
  });
```

- [ ] **Step 6: Create `api/commands.ts`.**

```typescript
import { httpClient } from '@/shared/api/http-client';
import { DraftNetworkFeature, type DraftFeature } from '../model/types';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';
import type { Geometry } from 'geojson';

export interface CreateDraftFeatureArgs {
  kind: NetworkFeatureKind;
  geometry: Geometry;
}

/** CQRS command: append a feature to the draft. Carries a correlationId envelope. */
export async function createDraftFeature(
  snapshotId: string,
  args: CreateDraftFeatureArgs,
): Promise<DraftFeature> {
  const raw = await httpClient.post<unknown>(`/snapshot/${snapshotId}/draft/features`, {
    kind: args.kind,
    geometry: args.geometry,
    correlationId: crypto.randomUUID(),
  });
  return DraftNetworkFeature.parse(raw);
}
```

- [ ] **Step 7: Create `index.ts`.**

```typescript
export { fetchDraftFeatures, draftFeaturesQueryOptions } from './api/queries';
export { createDraftFeature, type CreateDraftFeatureArgs } from './api/commands';
export { DraftNetworkFeature, DraftFeatureCollection } from './model/types';
export type { DraftFeature, DraftFeatures } from './model/types';
```

- [ ] **Step 8: Run green.** `npm --prefix apps/gis-core run test:run -- src/entities/draft-feature/api/draft-feature.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add apps/gis-core/src/entities/draft-feature apps/gis-core/src/shared/api/query-keys.ts
git commit -m "feat(gis-core): draft-feature entity (draftFeatures query + createDraftFeature command)"
```

---

## Task 7: Feature `digitize` — draw-mode store + toolbar

**Files:**
- Create: `apps/gis-core/src/features/digitize/model/digitize-store.ts`
- Create: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx`
- Create: `apps/gis-core/src/features/digitize/index.ts`
- Create (test): `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `digitize-toolbar.test.tsx`. Begin with the **Appendix A prelude** (copy the full block from Appendix A at the end of this plan), then:

```tsx
import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Geometry } from 'geojson';
import type { DrawGeometry, MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { DigitizeToolbar } from './digitize-toolbar';

function spyPort() {
  const calls = { draw: [] as (DrawGeometry | null)[] };
  let drawCb: ((g: Geometry) => void) | null = null;
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(),
    setDrawMode: (g) => calls.draw.push(g),
    onDrawComplete: (cb) => { drawCb = cb; return () => { drawCb = null; }; },
    destroy: vi.fn(),
  };
  return { port, calls, emitDraw: (g: Geometry) => drawCb?.(g) };
}

describe('DigitizeToolbar', () => {
  it('maps pipe -> LineString draw mode and toggles off on second click', async () => {
    const { port, calls } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('draw-pipe'));
    expect(calls.draw).toContain('LineString');
    fireEvent.click(getByTestId('draw-pipe'));
    expect(calls.draw[calls.draw.length - 1]).toBeNull();
  });

  it('fires the create command on draw completion and resets the mode', async () => {
    const { port, calls, emitDraw } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('draw-node'));
    emitDraw({ type: 'Point', coordinates: [105.8, 21] });
    // onSuccess clears the mode -> setDrawMode(null) is the last call
    await waitFor(() => expect(calls.draw[calls.draw.length - 1]).toBeNull());
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/digitize/ui/digitize-toolbar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `model/digitize-store.ts`.**

```typescript
import { createSignal } from 'solid-js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';

/** Slice 2.3a draws only these two kinds. */
export type DrawKind = Extract<NetworkFeatureKind, 'pipe' | 'node'>;

/** Client UI state for digitize: which kind is being drawn (null = idle). */
export function createDigitizeStore() {
  const [drawKind, setDrawKind] = createSignal<DrawKind | null>(null);
  const toggle = (k: DrawKind) => setDrawKind((cur) => (cur === k ? null : k));
  const clear = () => setDrawKind(null);
  return { drawKind, toggle, clear };
}
```

- [ ] **Step 4: Create `ui/digitize-toolbar.tsx`.**

```tsx
import { createEffect, onCleanup, Show } from 'solid-js';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import type { Geometry } from 'geojson';
import type { DrawGeometry } from '@wn/map-runtime';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createDraftFeature } from '@/entities/draft-feature';
import { queryKeys } from '@/shared/api/query-keys';
import { createDigitizeStore, type DrawKind } from '../model/digitize-store';

const GEOM: Record<DrawKind, DrawGeometry> = { pipe: 'LineString', node: 'Point' };

export function DigitizeToolbar(props: { snapshotId: string }) {
  const { port } = useMapRuntimeContext();
  const qc = useQueryClient();
  const store = createDigitizeStore();

  const create = useMutation(() => ({
    mutationFn: (input: { kind: DrawKind; geometry: Geometry }) =>
      createDraftFeature(props.snapshotId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) });
      store.clear();
    },
  }));

  // Drive the port's draw mode from the store.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const k = store.drawKind();
    p.setDrawMode(k ? GEOM[k] : null);
  });

  // Fire the create command when a geometry is drawn.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onDrawComplete((geometry: Geometry) => {
      const k = store.drawKind();
      if (k) create.mutate({ kind: k, geometry });
    });
    onCleanup(off);
  });

  return (
    <div data-testid="digitize-toolbar" class="flex gap-2 rounded bg-white/90 p-2 shadow">
      <button
        type="button"
        data-testid="draw-pipe"
        classList={{ 'font-bold': store.drawKind() === 'pipe' }}
        onClick={() => store.toggle('pipe')}
      >
        Pipe
      </button>
      <button
        type="button"
        data-testid="draw-node"
        classList={{ 'font-bold': store.drawKind() === 'node' }}
        onClick={() => store.toggle('node')}
      >
        Node
      </button>
      <Show when={store.drawKind()}>
        <button type="button" data-testid="draw-cancel" onClick={() => store.clear()}>
          Cancel
        </button>
      </Show>
    </div>
  );
}
```

- [ ] **Step 5: Create `index.ts`.**

```typescript
export { DigitizeToolbar } from './ui/digitize-toolbar';
export { createDigitizeStore, type DrawKind } from './model/digitize-store';
```

- [ ] **Step 6: Run green.** `npm --prefix apps/gis-core run test:run -- src/features/digitize/ui/digitize-toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/gis-core/src/features/digitize
git commit -m "feat(gis-core): digitize feature (draw pipe/node -> create-draft command)"
```

---

## Task 8: Feature `draft-plane` — render the draft layer

**Files:**
- Create: `apps/gis-core/src/features/draft-plane/ui/draft-plane.tsx`
- Create: `apps/gis-core/src/features/draft-plane/index.ts`
- Create (test): `apps/gis-core/src/features/draft-plane/ui/draft-plane.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `draft-plane.test.tsx`. Begin with the **Appendix A prelude**, then:

```tsx
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { FeatureCollection } from 'geojson';
import type { MapEnginePort } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { createDraftFeature } from '@/entities/draft-feature';
import { DraftPlane } from './draft-plane';

function spyPort() {
  const calls = { draftSet: [] as FeatureCollection[] };
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: (layerId, fc) => { if (layerId === 'draft') calls.draftSet.push(fc); },
    setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(),
    setDrawMode: vi.fn(), onDrawComplete: () => () => {}, destroy: vi.fn(),
  };
  return { port, calls };
}

describe('DraftPlane', () => {
  it('pushes the draft collection to the draft layer', async () => {
    await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
    });
    const { port, calls } = spyPort();
    const qc = new QueryClient();
    render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DraftPlane snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(calls.draftSet.length).toBeGreaterThan(0));
    expect(calls.draftSet.at(-1)!.features).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/features/draft-plane/ui/draft-plane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `ui/draft-plane.tsx`.**

```tsx
import { createEffect } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { FeatureCollection } from 'geojson';
import { draftFeaturesQueryOptions } from '@/entities/draft-feature';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';

/** Headless: pushes draft features (server state) onto the map's 'draft' layer. */
export function DraftPlane(props: { snapshotId: string }) {
  const { port } = useMapRuntimeContext();
  const draft = useQuery(() => draftFeaturesQueryOptions(props.snapshotId));

  createEffect(() => {
    const p = port();
    const data = draft.data;
    if (p && data) p.setFeatures('draft', data as unknown as FeatureCollection);
  });

  return null;
}
```

- [ ] **Step 4: Create `index.ts`.**

```typescript
export { DraftPlane } from './ui/draft-plane';
```

- [ ] **Step 5: Run green.** `npm --prefix apps/gis-core run test:run -- src/features/draft-plane/ui/draft-plane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/gis-core/src/features/draft-plane
git commit -m "feat(gis-core): draft-plane feature (render draft layer from query)"
```

---

## Task 9: Page `GisEditorPage` + route `/gis/editor`

**Files:**
- Create: `apps/gis-core/src/pages/gis/editor/index.tsx`
- Create: `apps/gis-core/src/routes/gis.editor.tsx`
- Create (test): `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx`

- [ ] **Step 1: Write the failing integration test.** Create `editor-page.test.tsx`. Begin with the **Appendix A prelude**, then:

```tsx
import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { FeatureCollection, Geometry } from 'geojson';
import type { DrawGeometry, MapEnginePort } from '@wn/map-runtime';
import { GisEditorPage } from './index';

function spyPort() {
  const calls = { draftSet: [] as FeatureCollection[], draw: [] as (DrawGeometry | null)[] };
  let drawCb: ((g: Geometry) => void) | null = null;
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: (layerId, fc) => { if (layerId === 'draft') calls.draftSet.push(fc); },
    setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(),
    setDrawMode: (g) => calls.draw.push(g),
    onDrawComplete: (cb) => { drawCb = cb; return () => { drawCb = null; }; },
    destroy: vi.fn(),
  };
  return { port, calls, emitDraw: (g: Geometry) => drawCb?.(g) };
}

describe('GisEditorPage', () => {
  it('draws a pipe -> creates a draft -> renders it on the draft plane', async () => {
    const { port, calls, emitDraw } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <GisEditorPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-shell')).toBeInTheDocument());
    expect(getByTestId('digitize-toolbar')).toBeInTheDocument();

    fireEvent.click(getByTestId('draw-pipe'));
    expect(calls.draw).toContain('LineString');

    emitDraw({ type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] });
    await waitFor(() => expect(calls.draftSet.length).toBeGreaterThan(0));
    expect(calls.draftSet.at(-1)!.features).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run red.** `npm --prefix apps/gis-core run test:run -- src/pages/gis/editor/editor-page.test.tsx`
Expected: FAIL — module `./index` not found.

- [ ] **Step 3: Create `pages/gis/editor/index.tsx`.**

```tsx
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { MapShell } from '@/widgets/map-shell';
import { MapCanvas } from '@/features/map-canvas';
import { DigitizeToolbar } from '@/features/digitize';
import { DraftPlane } from '@/features/draft-plane';
import { createSelectionStore } from '@/features/feature-selection/model/selection-store';

const INITIAL_VIEW: MapViewOptions = { center: { lon: 105.83, lat: 21.02 }, zoom: 12 };

export function GisEditorPage(props: {
  snapshotId?: string;
  mapFactory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}) {
  const snapshotId = () => props.snapshotId ?? 'snap-1';
  const selection = createSelectionStore();

  return (
    <MapRuntimeProvider view={INITIAL_VIEW} factory={props.mapFactory}>
      <MapShell
        map={
          <MapCanvas
            snapshotId={snapshotId()}
            selectedId={selection.selectedId()}
            onSelect={selection.select}
          />
        }
        topLeft={<DigitizeToolbar snapshotId={snapshotId()} />}
      />
      <DraftPlane snapshotId={snapshotId()} />
    </MapRuntimeProvider>
  );
}
```

- [ ] **Step 4: Run green.** `npm --prefix apps/gis-core run test:run -- src/pages/gis/editor/editor-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Create the route `routes/gis.editor.tsx`** (flat file-route → path `/gis/editor`), gated behind `NEW_EDITOR`:

```tsx
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/solid-router'
import { authGuard } from '@/shared/lib/route-guards'
import { getFeatureFlag, FEATURE_FLAGS } from '@/shared/lib/feature-flags'

export const Route = createFileRoute('/gis/editor')({
  beforeLoad: async () => {
    await authGuard()
    if (!getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)) {
      throw redirect({ to: '/gis' })
    }
  },
  component: lazyRouteComponent(() => import('@/pages/gis/editor'), 'GisEditorPage'),
})
```

- [ ] **Step 6: Regenerate the route tree + typecheck.**
Run: `npm --prefix apps/gis-core run typecheck`
Expected: exits 0 (the `pretypecheck` `routes:generate` picks up the new route; `/gis/editor` is added to `routeTree.gen.ts`). If `redirect`/route types complain, confirm `redirect` is imported from `@tanstack/solid-router` and the route id string is exactly `'/gis/editor'`.

- [ ] **Step 7: Commit.**

```bash
git add apps/gis-core/src/pages/gis/editor apps/gis-core/src/routes/gis.editor.tsx apps/gis-core/src/routeTree.gen.ts
git commit -m "feat(gis-core): /gis/editor route + GisEditorPage (digitize behind NEW_EDITOR flag)"
```

---

## Task 10: Full gate sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the app.** `npm --prefix apps/gis-core run typecheck`
Expected: exits 0.

- [ ] **Step 2: Lint (FSD boundaries + a11y).** `npm --prefix apps/gis-core run lint`
Expected: 0 errors. If boundaries complain: `digitize` and `draft-plane` may import only `shared/*`, `entities/*`, `@wn/*` — they reach the port via `@/shared/lib/map-runtime` and must not import each other or `map-canvas`.

- [ ] **Step 3: Run the whole app suite.** `npm --prefix apps/gis-core run test:run`
Expected: PASS (all suites, including the 4 new draft/digitize/editor suites).

- [ ] **Step 4: Run package suites.** `npm --prefix packages/map-runtime run test && npm run contracts:test`
Expected: PASS.

- [ ] **Step 5: Build + size gate.** `npm --prefix apps/gis-core run build && npm --prefix apps/gis-core run size`
Expected: build succeeds; `index-*.js` ≤ 120 kB gz; `ol-map-adapter-*.js` ≤ 200 kB gz. `ol/interaction/Draw` rides the lazy `ol-map-adapter` chunk — if `index` grew, an `ol` import leaked outside `openlayers/*` (the editor page/features must import only the port, never `ol`).

- [ ] **Step 6: Confirm no file exceeds the size budget.**
Run: `find apps/gis-core/src/features/digitize apps/gis-core/src/features/draft-plane apps/gis-core/src/entities/draft-feature apps/gis-core/src/pages/gis/editor packages/map-runtime/src/openlayers -name '*.ts*' -not -name '*.test.*' | xargs wc -l | sort -rn | head`
Expected: all comfortably under 400.

- [ ] **Step 7: Final commit (if gates produced formatting/lockfile/routeTree changes).**

```bash
git add -A
git commit -m "chore(gis-core): slice 2.3a gate sweep (typecheck/lint/test/size green)"
```

---

## Appendix A — shared gis-core test prelude

Paste this block verbatim at the **top** of `digitize-toolbar.test.tsx`, `draft-plane.test.tsx`, and `editor-page.test.tsx` (every test that renders the map runtime). It isolates the auth chain, re-implements `createMapRuntime` on gis-core's Solid instance (the package resolves its own `solid-js` in tests), and strips `AbortSignal` to avoid the jsdom/Node realm mismatch in `@mswjs/interceptors`.

```tsx
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
      const el = container ?? document.createElement('div');
      (instance as { mount: (el: HTMLDivElement) => void }).mount(el);
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
```

---

## Self-Review

**Spec coverage (against `2026-06-16-gis-core-editor-digitize-design.md`):**
- §3 contract `draft` (request + draft feature + collection + builders) → Task 1. ✓
- §4 port `setDrawMode` + `onDrawComplete` (generic geometry-type, ol-free) → Task 2; adapter impl + ol/Draw confined to lazy chunk → Task 3. ✓
- §5 MSW working-set + POST/GET → Task 5. ✓
- §6 entity `draft-feature` (query + command + keys) → Task 6; feature `digitize` (store + toolbar) → Task 7; feature `draft-plane` → Task 8; page + route behind `NEW_EDITOR` → Task 9. ✓
- §6 draft style variant (dashed) → Task 3 (style-adapter + setFeatures `isDraft`). ✓
- §7 data flow (toggle → setDrawMode → draw → onDrawComplete → mutate → invalidate → setFeatures('draft')) → Tasks 7–9 wiring; end-to-end asserted in Task 9 integration test. ✓
- §10 testing layers (contract / port / adapter smoke / MSW / entity / component / integration / size) → Tasks 1,2,3,5,6,7,8,9,10. ✓
- §9 non-goals respected: no modify/snap/topology, no attribute-edit, no lease/validation/submit, no continuity, no 409/422, no facility(Polygon). ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; every command states expected output. ✓

**Type consistency:** `DrawGeometry = 'LineString' | 'Point'` used in port `setDrawMode` ↔ adapter ↔ `GEOM` map (Task 7); `DrawKind = 'pipe' | 'node'` only app-side, mapped to `DrawGeometry` via `GEOM`; `onDrawComplete` carries `geojson.Geometry` across port ↔ adapter ↔ toolbar ↔ command `CreateDraftFeatureArgs.geometry`; `createDraftFeature(snapshotId, {kind, geometry})` signature identical in command def (Task 6), toolbar call (Task 7), and tests (Tasks 6–9); `queryKeys.draftFeatures.all(snapshotId)` identical in query (Task 6) and invalidate (Task 7); `setFeatures('draft', …)` layer id identical in adapter style branch (Task 3) and `DraftPlane` (Task 8). ✓

**Interface-growth fallout:** every `MapEnginePort` fake literal updated (Task 2 contract fake; Task 4 the 7 remaining) so `tsc --noEmit` stays green. ✓
