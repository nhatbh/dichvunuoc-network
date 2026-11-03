# GIS Core — Editor Topology snap + geometry-modify (slice 2.3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editor "Modify" mode that lets the user drag vertices of existing **draft** features, with snapping (draft + published) during both digitize and modify, persisting each edit through a mocked CQRS PATCH command.

**Architecture:** Extend the generic map port with exactly two methods (`setModifyMode`/`onModifyComplete`); the OpenLayers adapter wires `ol/Modify` to the draft layer source and `ol/Snap` to all vector sources (snap is an internal adapter behavior, not a port concern). Draft stays server-state via TanStack Query: modifyend → PATCH command (MSW working-set) → invalidate → refetch → `setFeatures('draft', …)`. Only draft is editable; published is a read-only snap target.

**Tech Stack:** TypeScript, Zod (`@wn/contracts`), OpenLayers (`@wn/map-runtime`), SolidJS + TanStack Solid Query (`apps/gis-core`), MSW mocks, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-16-gis-core-editor-topology-modify-design.md`

**Key conventions discovered (follow exactly):**
- `ol` is imported ONLY under `packages/map-runtime/src/openlayers/*`. Never leak `ol` types past the port.
- `@wn/contracts` and `@wn/map-runtime` publish from `dist` (gitignored). After editing either package you MUST rebuild it before `apps/gis-core` can typecheck against the change.
- ol's `GeoJSON.readFeatures` already assigns feature ids from the GeoJSON `id` member, so featureId round-trips with no extra `setId` call.
- Build/test commands:
  - Contracts: `npm run contracts:build`, `npm run contracts:test`
  - map-runtime: `npm --prefix packages/map-runtime run build`, `npm --prefix packages/map-runtime run test`
  - gis-core: `npm --prefix apps/gis-core run test:run`, `npm --prefix apps/gis-core run typecheck`, `npm --prefix apps/gis-core run lint`, `npm --prefix apps/gis-core run size`

---

## File Structure

**Create:** none (all changes extend existing files).

**Modify:**
- `packages/contracts/src/draft/index.ts` — add `UpdateDraftFeatureGeometryRequest` schema/type.
- `packages/contracts/src/draft/draft.test.ts` — add request validation cases.
- `packages/map-runtime/src/port/map-engine-port.ts` — add `setModifyMode` + `onModifyComplete` to the interface.
- `packages/map-runtime/src/port/map-engine-port.test.ts` — extend the fake + add a modify contract test.
- `packages/map-runtime/src/openlayers/ol-map-adapter.ts` — implement Modify + Snap.
- `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts` — add modify/snap smoke test.
- `apps/gis-core/src/shared/api/mocks/handlers.ts` — add `PATCH` handler.
- `apps/gis-core/src/entities/draft-feature/api/commands.ts` — add `updateDraftFeatureGeometry`.
- `apps/gis-core/src/entities/draft-feature/model/types.ts` — re-export the update request type.
- `apps/gis-core/src/entities/draft-feature/index.ts` — export the new command.
- `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts` — add update round-trip + 404 cases.
- `apps/gis-core/src/features/digitize/model/digitize-store.ts` — widen to an `EditMode` (`'pipe' | 'node' | 'modify' | null`).
- `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx` — Modify button + modify/snap port wiring + update mutation.
- `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx` — extend spy port; add modify cases.
- `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx` — add modify round-trip integration case.

---

## Task 1: Contract — `UpdateDraftFeatureGeometryRequest`

**Files:**
- Modify: `packages/contracts/src/draft/index.ts`
- Test: `packages/contracts/src/draft/draft.test.ts`

- [ ] **Step 1: Write the failing test**

Append these two cases inside the `describe('draft contracts', …)` block in `packages/contracts/src/draft/draft.test.ts` (and add `UpdateDraftFeatureGeometryRequest` to the import from `./index.js`):

```typescript
  it('accepts a valid update-geometry request', () => {
    const req = {
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
      correlationId: 'c-2',
    };
    expect(UpdateDraftFeatureGeometryRequest.parse(req).correlationId).toBe('c-2');
  });

  it('rejects an update-geometry request missing geometry', () => {
    const bad = { correlationId: 'c-3' };
    expect(UpdateDraftFeatureGeometryRequest.safeParse(bad).success).toBe(false);
  });
```

Update the import at the top of the test file:

```typescript
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  DraftNetworkFeature,
  DraftFeatureCollection,
} from './index.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run contracts:test -- draft`
Expected: FAIL — `UpdateDraftFeatureGeometryRequest` is not exported (import/undefined error).

- [ ] **Step 3: Write minimal implementation**

Append to `packages/contracts/src/draft/index.ts` (after `CreateDraftFeatureRequest`):

```typescript
/** Command request: replace a draft feature's geometry (CQRS). Last-write-wins (no version yet). */
export const UpdateDraftFeatureGeometryRequest = z.object({
  geometry: NetworkGeometry,
  correlationId: z.string(),
});
export type UpdateDraftFeatureGeometryRequest = z.infer<typeof UpdateDraftFeatureGeometryRequest>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run contracts:test -- draft`
Expected: PASS (all draft contract cases green).

- [ ] **Step 5: Build the contracts package (so consumers see the new export)**

Run: `npm run contracts:build`
Expected: tsc emits to `packages/contracts/dist` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/draft/index.ts packages/contracts/src/draft/draft.test.ts
git commit -m "feat(contracts): add UpdateDraftFeatureGeometryRequest (draft command)"
```

---

## Task 2: Port — `setModifyMode` + `onModifyComplete`

**Files:**
- Modify: `packages/map-runtime/src/port/map-engine-port.ts`
- Test: `packages/map-runtime/src/port/map-engine-port.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/map-runtime/src/port/map-engine-port.test.ts`, extend the `FakePort` type and `makeFake()` factory, then add a contract test.

Extend the `FakePort` type (add two members):

```typescript
type FakePort = MapEnginePort & {
  emitClick: (id: string) => void;
  emitPointer: (c: Coordinate | null) => void;
  visible: Map<string, boolean>;
  basemap: string;
  lastFit: [number, number, number, number] | null;
  emitDraw: (g: Geometry) => void;
  drawMode: DrawGeometry | null;
  modifyEnabled: boolean;
  emitModify: (id: string, g: Geometry) => void;
};
```

In `makeFake()`, add a subscriber set and wire the two new methods. Add near the other `const … = new Set(...)` lines:

```typescript
  const modifySubs = new Set<(id: string, g: Geometry) => void>();
```

Add these two properties to the `fake` object literal (next to `setDrawMode`/`onDrawComplete`):

```typescript
    setModifyMode: (enabled) => { fake.modifyEnabled = enabled; },
    onModifyComplete: (cb) => { modifySubs.add(cb); return () => modifySubs.delete(cb); },
```

Add these two properties to the trailing fields of the `fake` object literal (next to `drawMode: null` / `emitDraw`):

```typescript
    modifyEnabled: false,
    emitModify: (id, g) => modifySubs.forEach((cb) => cb(id, g)),
```

Add this test case inside `describe('MapEnginePort contract', …)`:

```typescript
  it('records modify mode and notifies + unsubscribes modify complete', () => {
    const p = makeFake();
    p.setModifyMode(true);
    expect(p.modifyEnabled).toBe(true);
    const seen: Array<[string, Geometry]> = [];
    const off = p.onModifyComplete((id, g) => seen.push([id, g]));
    const line: Geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] };
    p.emitModify('draft-1', line);
    off();
    p.emitModify('draft-2', { type: 'Point', coordinates: [0, 0] });
    expect(seen).toEqual([['draft-1', line]]);
    p.setModifyMode(false);
    expect(p.modifyEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix packages/map-runtime run test -- map-engine-port`
Expected: FAIL — `setModifyMode`/`onModifyComplete` not on `MapEnginePort` (type error / undefined).

- [ ] **Step 3: Write minimal implementation**

In `packages/map-runtime/src/port/map-engine-port.ts`, add the two methods to the `MapEnginePort` interface, right after `onDrawComplete`:

```typescript
  /** Enable/disable vertex modify on the 'draft' layer. Snap (draft + published) follows automatically. */
  setModifyMode(enabled: boolean): void;
  /** Subscribe to completed modifications; cb receives (featureId, geometry as GeoJSON EPSG:4326). Returns unsubscribe. */
  onModifyComplete(cb: (featureId: string, geometry: Geometry) => void): () => void;
```

(`Geometry` is already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix packages/map-runtime run test -- map-engine-port`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/map-runtime/src/port/map-engine-port.ts packages/map-runtime/src/port/map-engine-port.test.ts
git commit -m "feat(map-runtime): add setModifyMode/onModifyComplete to port"
```

---

## Task 3: Adapter — wire `ol/Modify` + `ol/Snap`

**Files:**
- Modify: `packages/map-runtime/src/openlayers/ol-map-adapter.ts`
- Test: `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add this case to `describe('OlMapAdapter (smoke, jsdom)', …)` in `ol-map-adapter.test.ts`:

```typescript
  it('enters and exits modify mode with snap and subscribes to modify completion without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setFeatures('draft', fc);
      const off = adapter.onModifyComplete(() => {});
      adapter.setModifyMode(true); // adds Modify(draft) + Snap(published, draft)
      adapter.setModifyMode(false); // removes Modify; Snap removed (no draw/modify active)
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix packages/map-runtime run test -- ol-map-adapter`
Expected: FAIL — `adapter.setModifyMode`/`onModifyComplete` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `packages/map-runtime/src/openlayers/ol-map-adapter.ts`:

(a) Add imports near the other `ol/interaction` import:

```typescript
import Modify from 'ol/interaction/Modify';
import type { ModifyEvent } from 'ol/interaction/Modify';
import Snap from 'ol/interaction/Snap';
```

(b) Add private fields next to `#draw` / `#drawSubs`:

```typescript
  #modify: Modify | null = null;
  #modifySubs = new Set<(id: string, g: Geometry) => void>();
  #snaps: Snap[] = [];
```

(c) Add a private helper that rebuilds snap interactions over every vector source whenever a draw or modify interaction is active. Snap must be added AFTER Draw/Modify, so this is called at the end of `setDrawMode` and `setModifyMode`:

```typescript
  #syncSnap(): void {
    for (const snap of this.#snaps) this.#map?.removeInteraction(snap);
    this.#snaps = [];
    const editing = this.#draw != null || this.#modify != null;
    if (!editing || !this.#map) return;
    for (const layer of this.#layers.values()) {
      const src = layer.getSource();
      if (!src) continue;
      const snap = new Snap({ source: src });
      this.#map.addInteraction(snap);
      this.#snaps.push(snap);
    }
  }
```

(d) Call `this.#syncSnap();` as the LAST statement of the existing `setDrawMode(...)` method (after `this.#draw = draw;` and also covering the early-return path — simplest: add `this.#syncSnap();` just before every `return` and at the end). Concretely, rewrite `setDrawMode` to end with a single sync:

```typescript
  setDrawMode(geometry: DrawGeometry | null): void {
    if (this.#draw) {
      this.#map?.removeInteraction(this.#draw);
      this.#draw = null;
    }
    if (geometry && this.#map) {
      this.#drawSource.clear();
      const draw = new Draw({ source: this.#drawSource, type: geometry });
      draw.on('drawend', (evt: DrawEvent) => {
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
    this.#syncSnap();
  }
```

(e) Add the two new methods after `onDrawComplete`:

```typescript
  setModifyMode(enabled: boolean): void {
    if (this.#modify) {
      this.#map?.removeInteraction(this.#modify);
      this.#modify = null;
    }
    if (enabled && this.#map) {
      const src = this.#layers.get('draft')?.getSource();
      if (src) {
        const modify = new Modify({ source: src });
        modify.on('modifyend', (evt: ModifyEvent) => {
          evt.features.forEach((feature) => {
            const g = feature.getGeometry();
            const id = feature.getId();
            if (!g || id == null) return;
            const geojson = this.#format.writeGeometryObject(g, {
              featureProjection: VIEW_PROJECTION,
              dataProjection: DATA_PROJECTION,
            }) as Geometry;
            this.#modifySubs.forEach((cb) => cb(String(id), geojson));
          });
        });
        this.#map.addInteraction(modify);
        this.#modify = modify;
      }
    }
    this.#syncSnap();
  }

  onModifyComplete(cb: (id: string, g: Geometry) => void): () => void {
    this.#modifySubs.add(cb);
    return () => this.#modifySubs.delete(cb);
  }
```

(f) Extend `destroy()` to clean up modify + snap. Add inside `destroy()` (before `this.#map = null;` is fine, but remove interactions while `#map` still set):

```typescript
    if (this.#modify) {
      this.#map?.removeInteraction(this.#modify);
      this.#modify = null;
    }
    for (const snap of this.#snaps) this.#map?.removeInteraction(snap);
    this.#snaps = [];
    this.#modifySubs.clear();
```

Place this block immediately after the existing `#draw` cleanup block at the top of `destroy()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix packages/map-runtime run test -- ol-map-adapter`
Expected: PASS (new modify/snap case green, existing draw case still green).

- [ ] **Step 5: Run the full map-runtime suite + build**

Run: `npm --prefix packages/map-runtime run test`
Expected: PASS (port contract + adapter + others).

Run: `npm --prefix packages/map-runtime run build`
Expected: tsc emits to `packages/map-runtime/dist` with no errors (so `apps/gis-core` sees the new port methods).

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime/src/openlayers/ol-map-adapter.ts packages/map-runtime/src/openlayers/ol-map-adapter.test.ts
git commit -m "feat(map-runtime): implement ol/Modify + ol/Snap in adapter"
```

---

## Task 4: MSW — `PATCH` draft geometry handler

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`

(The handler is exercised by the entity round-trip test in Task 5, mirroring how the existing POST/GET handlers are tested via the entity. No separate handler test file.)

- [ ] **Step 1: Update the import**

In `apps/gis-core/src/shared/api/mocks/handlers.ts`, widen the `@wn/contracts/draft` import:

```typescript
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  type DraftNetworkFeature,
} from '@wn/contracts/draft'
```

- [ ] **Step 2: Add the PATCH handler**

Insert into the `handlers` array, immediately after the existing `http.get('*/snapshot/:id/draft/features', …)` handler:

```typescript
  http.patch('*/snapshot/:id/draft/features/:featureId', async ({ params, request }) => {
    const parsed = UpdateDraftFeatureGeometryRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid draft geometry' }, { status: 422 })
    }
    const target = draftFeatures.find((f) => f.id === String(params.featureId))
    if (!target) {
      return HttpResponse.json({ error: 'Draft feature not found' }, { status: 404 })
    }
    target.geometry = parsed.data.geometry
    return HttpResponse.json(target, { status: 200 })
  }),
```

- [ ] **Step 3: Commit**

```bash
git add apps/gis-core/src/shared/api/mocks/handlers.ts
git commit -m "feat(gis-core): MSW PATCH draft geometry handler (mock CQRS update)"
```

---

## Task 5: Entity command — `updateDraftFeatureGeometry`

**Files:**
- Modify: `apps/gis-core/src/entities/draft-feature/api/commands.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/model/types.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/index.ts`
- Test: `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts`

- [ ] **Step 1: Write the failing test**

In `draft-feature.test.ts`, extend the dynamic import to include the new command and add two cases:

```typescript
const { createDraftFeature, fetchDraftFeatures, updateDraftFeatureGeometry } = await import(
  '@/entities/draft-feature'
);
```

Add inside `describe('draft-feature entity', …)`:

```typescript
  it('updateDraftFeatureGeometry replaces geometry and reads back the new shape', async () => {
    const created = await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
    });
    const moved: { type: 'LineString'; coordinates: number[][] } = {
      type: 'LineString',
      coordinates: [[105.8, 21], [105.85, 21.05]],
    };
    const updated = await updateDraftFeatureGeometry('snap-1', created.id, { geometry: moved });
    expect(updated.geometry).toEqual(moved);
    const collection = await fetchDraftFeatures('snap-1');
    expect(collection.features[0]?.geometry).toEqual(moved);
  });

  it('updateDraftFeatureGeometry rejects an unknown featureId (404)', async () => {
    await expect(
      updateDraftFeatureGeometry('snap-1', 'draft-999', {
        geometry: { type: 'Point', coordinates: [105.8, 21] },
      }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- draft-feature`
Expected: FAIL — `updateDraftFeatureGeometry` is not exported.

- [ ] **Step 3: Write minimal implementation**

(a) Append to `apps/gis-core/src/entities/draft-feature/api/commands.ts`:

```typescript
export interface UpdateDraftFeatureGeometryArgs {
  geometry: Geometry;
}

/** CQRS command: replace a draft feature's geometry. Last-write-wins (no version yet). */
export async function updateDraftFeatureGeometry(
  snapshotId: string,
  featureId: string,
  args: UpdateDraftFeatureGeometryArgs,
): Promise<DraftFeature> {
  const raw = await httpClient.patch<unknown>(
    `/snapshot/${snapshotId}/draft/features/${featureId}`,
    { geometry: args.geometry, correlationId: crypto.randomUUID() },
  );
  return DraftNetworkFeature.parse(raw);
}
```

(b) Append to `apps/gis-core/src/entities/draft-feature/model/types.ts` re-exports (value + type):

```typescript
export { UpdateDraftFeatureGeometryRequest } from '@wn/contracts/draft';
export type { UpdateDraftFeatureGeometryRequest as UpdateDraftFeatureGeometryInput } from '@wn/contracts/draft';
```

(c) Add to `apps/gis-core/src/entities/draft-feature/index.ts` (extend the commands export line):

```typescript
export {
  createDraftFeature,
  type CreateDraftFeatureArgs,
  updateDraftFeatureGeometry,
  type UpdateDraftFeatureGeometryArgs,
} from './api/commands';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- draft-feature`
Expected: PASS (create/fetch/update/404 cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/entities/draft-feature
git commit -m "feat(gis-core): updateDraftFeatureGeometry draft command (entity)"
```

---

## Task 6: digitize-store + DigitizeToolbar — Modify mode

**Files:**
- Modify: `apps/gis-core/src/features/digitize/model/digitize-store.ts`
- Modify: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx`
- Test: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx`

> The store rename (`drawKind` → `mode`) and the toolbar update are done together so the feature compiles at the commit boundary.

- [ ] **Step 1: Write the failing test**

In `digitize-toolbar.test.tsx`, extend the spy port and add two cases.

Extend `spyPort()` to record modify state and emit modify events. Replace the `calls` shape and the `port` object's modify-related members:

```typescript
function spyPort() {
  const calls = { draw: [] as (DrawGeometry | null)[], modify: [] as boolean[] };
  let drawCb: ((g: Geometry) => void) | null = null;
  let modifyCb: ((id: string, g: Geometry) => void) | null = null;
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: vi.fn(), setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(),
    setDrawMode: (g) => calls.draw.push(g),
    onDrawComplete: (cb) => { drawCb = cb; return () => { drawCb = null; }; },
    setModifyMode: (e) => calls.modify.push(e),
    onModifyComplete: (cb) => { modifyCb = cb; return () => { modifyCb = null; }; },
    destroy: vi.fn(),
  };
  return {
    port, calls,
    emitDraw: (g: Geometry) => drawCb?.(g),
    emitModify: (id: string, g: Geometry) => modifyCb?.(id, g),
  };
}
```

Add two cases to `describe('DigitizeToolbar', …)`:

```typescript
  it('enables modify mode (and disables draw) when Modify is clicked', async () => {
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
    fireEvent.click(getByTestId('edit-modify'));
    expect(calls.modify[calls.modify.length - 1]).toBe(true);
    expect(calls.draw[calls.draw.length - 1]).toBeNull();
  });

  it('fires the update command on modify completion without resetting the mode', async () => {
    const { port, calls, emitModify } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-modify'));
    emitModify('draft-1', { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] });
    // Mode stays 'modify' (repeated op): the latest setModifyMode call is still true.
    await waitFor(() => expect(calls.modify[calls.modify.length - 1]).toBe(true));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- digitize-toolbar`
Expected: FAIL — no `edit-modify` testid; `setModifyMode`/`onModifyComplete` not driven.

- [ ] **Step 3: Write minimal implementation — store**

Replace `apps/gis-core/src/features/digitize/model/digitize-store.ts` with:

```typescript
import { createSignal } from 'solid-js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';

/** Kinds the digitize tool draws. */
export type DrawKind = Extract<NetworkFeatureKind, 'pipe' | 'node'>;
/** Editor interaction modes: draw a kind, modify existing geometry, or idle (null). */
export type EditMode = DrawKind | 'modify';

/** Client UI state for the editor toolbar: the active interaction mode (null = idle). */
export function createDigitizeStore() {
  const [mode, setMode] = createSignal<EditMode | null>(null);
  const toggle = (m: EditMode) => setMode((cur) => (cur === m ? null : m));
  const clear = () => setMode(null);
  return { mode, toggle, clear };
}
```

Update the feature barrel `apps/gis-core/src/features/digitize/index.ts` to also export `EditMode`:

```typescript
export { DigitizeToolbar } from './ui/digitize-toolbar';
export { createDigitizeStore, type DrawKind, type EditMode } from './model/digitize-store';
```

- [ ] **Step 4: Write minimal implementation — toolbar**

Replace `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx` with:

```tsx
import { createEffect, onCleanup, Show } from 'solid-js';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import type { Geometry } from 'geojson';
import type { DrawGeometry } from '@wn/map-runtime';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createDraftFeature, updateDraftFeatureGeometry } from '@/entities/draft-feature';
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

  const update = useMutation(() => ({
    mutationFn: (input: { featureId: string; geometry: Geometry }) =>
      updateDraftFeatureGeometry(props.snapshotId, input.featureId, { geometry: input.geometry }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) });
      // Do NOT clear the mode — modify is a repeated operation (spec §2d).
    },
  }));

  // Drive the port's draw + modify modes from the store (mutually exclusive).
  createEffect(() => {
    const p = port();
    if (!p) return;
    const m = store.mode();
    if (m === 'modify') {
      p.setDrawMode(null);
      p.setModifyMode(true);
    } else {
      p.setModifyMode(false);
      p.setDrawMode(m ? GEOM[m] : null);
    }
  });

  // Fire the create command when a geometry is drawn.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onDrawComplete((geometry: Geometry) => {
      const m = store.mode();
      if (m === 'pipe' || m === 'node') create.mutate({ kind: m, geometry });
    });
    onCleanup(off);
  });

  // Fire the update command when a draft feature's geometry is modified.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onModifyComplete((featureId: string, geometry: Geometry) => {
      update.mutate({ featureId, geometry });
    });
    onCleanup(off);
  });

  return (
    <div data-testid="digitize-toolbar" class="flex gap-2 rounded bg-white/90 p-2 shadow">
      <button
        type="button"
        data-testid="draw-pipe"
        classList={{ 'font-bold': store.mode() === 'pipe' }}
        onClick={() => store.toggle('pipe')}
      >
        Pipe
      </button>
      <button
        type="button"
        data-testid="draw-node"
        classList={{ 'font-bold': store.mode() === 'node' }}
        onClick={() => store.toggle('node')}
      >
        Node
      </button>
      <button
        type="button"
        data-testid="edit-modify"
        classList={{ 'font-bold': store.mode() === 'modify' }}
        onClick={() => store.toggle('modify')}
      >
        Modify
      </button>
      <Show when={store.mode()}>
        <button type="button" data-testid="draw-cancel" onClick={() => store.clear()}>
          Cancel
        </button>
      </Show>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- digitize-toolbar`
Expected: PASS (existing pipe/draw cases + new modify cases green).

- [ ] **Step 6: Commit**

```bash
git add apps/gis-core/src/features/digitize
git commit -m "feat(gis-core): Modify mode in digitize toolbar (snap + geometry-modify)"
```

---

## Task 7: Integration — editor modify round-trip

**Files:**
- Test: `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx`

- [ ] **Step 1: Write the failing test**

Extend `spyPort()` in `editor-page.test.tsx` to support modify (capture the modify subscriber and record `setModifyMode`). Replace the `spyPort()` function with:

```typescript
function spyPort() {
  const calls = {
    draftSet: [] as FeatureCollection[],
    draw: [] as (DrawGeometry | null)[],
    modify: [] as boolean[],
  };
  let drawCb: ((g: Geometry) => void) | null = null;
  let modifyCb: ((id: string, g: Geometry) => void) | null = null;
  const port: MapEnginePort = {
    mount: vi.fn(), setView: vi.fn(), getView: () => ({ center: { lon: 0, lat: 0 }, zoom: 1 }),
    setFeatures: (layerId, fc) => { if (layerId === 'draft') calls.draftSet.push(fc); },
    setSelection: vi.fn(), getSelection: () => null,
    onFeatureClick: () => () => {}, onPointerMove: () => () => {},
    setLayerVisible: vi.fn(), setBasemap: vi.fn(), fitToBbox: vi.fn(),
    setDrawMode: (g) => calls.draw.push(g),
    onDrawComplete: (cb) => { drawCb = cb; return () => { drawCb = null; }; },
    setModifyMode: (e) => calls.modify.push(e),
    onModifyComplete: (cb) => { modifyCb = cb; return () => { modifyCb = null; }; },
    destroy: vi.fn(),
  };
  return {
    port, calls,
    emitDraw: (g: Geometry) => drawCb?.(g),
    emitModify: (id: string, g: Geometry) => modifyCb?.(id, g),
  };
}
```

Add this case to `describe('GisEditorPage', …)`:

```typescript
  it('draws a pipe, then modifies it -> the draft plane re-renders the new geometry', async () => {
    const { port, calls, emitDraw, emitModify } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <GisEditorPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-shell')).toBeInTheDocument());

    // Create one draft pipe so there is something to modify.
    fireEvent.click(getByTestId('draw-pipe'));
    emitDraw({ type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] });
    await waitFor(() => expect(calls.draftSet.some((c) => c.features.length === 1)).toBe(true));
    const created = calls.draftSet.find((c) => c.features.length === 1)!.features[0];
    const id = String(created.id);

    // Enter modify mode and move the pipe's far vertex.
    fireEvent.click(getByTestId('edit-modify'));
    expect(calls.modify[calls.modify.length - 1]).toBe(true);
    const moved: Geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.85, 21.05]] };
    emitModify(id, moved);

    // The PATCH → invalidate → refetch pushes a draft collection whose feature
    // carries the moved geometry.
    await waitFor(() =>
      expect(
        calls.draftSet.some(
          (c) =>
            c.features.length === 1 &&
            JSON.stringify(c.features[0]?.geometry) === JSON.stringify(moved),
        ),
      ).toBe(true),
    );
  });
```

(`FeatureCollection` and `Geometry` are already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- editor-page`
Expected: Initially FAIL only if wiring is wrong; with Tasks 4–6 in place it should pass. If you are running tasks in order, this verifies the end-to-end round-trip. If it fails, debug the modify→PATCH→refetch chain (do not weaken the assertion).

- [ ] **Step 3: Run test to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- editor-page`
Expected: PASS (both the draw round-trip and the modify round-trip).

- [ ] **Step 4: Commit**

```bash
git add apps/gis-core/src/pages/gis/editor/editor-page.test.tsx
git commit -m "test(gis-core): editor modify round-trip integration"
```

---

## Task 8: Full gates (typecheck / lint / test / size)

**Files:** none (verification only).

- [ ] **Step 1: Rebuild both packages (fresh dist consumed by gis-core)**

Run: `npm run contracts:build && npm --prefix packages/map-runtime run build`
Expected: both emit with no errors.

- [ ] **Step 2: Contracts + map-runtime suites**

Run: `npm run contracts:test && npm --prefix packages/map-runtime run test`
Expected: PASS.

- [ ] **Step 3: gis-core typecheck**

Run: `npm --prefix apps/gis-core run typecheck`
Expected: PASS (no errors). This confirms the port's new methods resolve from `@wn/map-runtime` dist.

- [ ] **Step 4: gis-core lint**

Run: `npm --prefix apps/gis-core run lint`
Expected: PASS (no errors).

- [ ] **Step 5: gis-core full test run**

Run: `npm --prefix apps/gis-core run test:run`
Expected: PASS (all suites).

- [ ] **Step 6: gis-core size gate**

Run: `npm --prefix apps/gis-core run size`
Expected: PASS — `index` chunk within budget; `ol/Modify` + `ol/Snap` ride the lazy `ol-map-adapter-*` chunk (they are imported only under `openlayers/*`, which is dynamically imported by the factory).

- [ ] **Step 7: Commit (only if any gate required a fix; otherwise skip)**

```bash
git add -A
git commit -m "chore(gis-core): green gates for slice 2.3b (snap + modify)"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §3 (port: 2 methods) → Task 2. ✓
- Spec §2c + §3 adapter (snap implicit, no port-method; Modify on draft source) → Task 3. ✓
- Spec §4 (`UpdateDraftFeatureGeometryRequest`) → Task 1. ✓
- Spec §5 (MSW PATCH, 404) → Task 4 (+ asserted in Task 5). ✓
- Spec §6 (entity command; store `mode`; toolbar Modify button + wiring; no reset after modify) → Tasks 5–6. ✓
- Spec §7 (data flow modify→PATCH→invalidate→refetch→setFeatures) → Task 7 integration. ✓
- Spec §9 (ol/Modify↔refetch: rebuild source acceptable for mock) → respected: `setFeatures` unchanged; modifyend ends the gesture before refetch. ✓
- Spec §11 testing table → Tasks 1,2,3,5,6,7 cover contract/port/adapter/entity/component/integration; Task 8 covers size. ✓
- Snap on draw too (global) → Task 3 `#syncSnap` runs from both `setDrawMode` and `setModifyMode`. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**3. Type consistency:**
- `setModifyMode(enabled: boolean)` / `onModifyComplete(cb: (featureId: string, geometry: Geometry) => void)` identical across port interface (Task 2), fake (Task 2), adapter (Task 3), and all spy ports (Tasks 6–7). ✓
- `updateDraftFeatureGeometry(snapshotId, featureId, { geometry })` signature identical in entity (Task 5) and toolbar caller (Task 6). ✓
- Store API renamed `drawKind`→`mode` consistently: store (Task 6 Step 3), toolbar (Task 6 Step 4 uses `store.mode()`/`store.toggle`/`store.clear`), barrel exports `EditMode`. No remaining `drawKind()` caller (only `DigitizeToolbar` consumed the store). ✓
- `UpdateDraftFeatureGeometryRequest` is the single zod source; MSW (Task 4) and contracts test (Task 1) both reference it. ✓
