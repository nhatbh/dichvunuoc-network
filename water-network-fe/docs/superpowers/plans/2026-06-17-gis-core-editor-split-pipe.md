# GIS Core Editor — Split Pipe (slice 2.3b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a draft pipe at a clicked point into two pipes via a `SplitPipe` CQRS command (MSW mock computes the geometry).

**Architecture:** Reuse the editor seam from 2.3b. Add 2 domain-agnostic port methods (`setFeaturePointMode` / `onFeaturePointPick`) so the adapter can report a click projected onto a draft feature; gis-core maps `(featureId, point)` → `SplitPipe` command; the MSW mock replaces the pipe with two pipes; the draft query refetches and the draft plane re-renders. No node is created (that is the Connect slice). `ol` math stays inside the adapter.

**Tech Stack:** Solid.js + Vite + TanStack Solid Query · `@wn/map-runtime` (OpenLayers behind `MapEnginePort`) · `@wn/contracts` (Zod) · MSW · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-gis-core-editor-split-pipe-design.md`
**Branch:** `feature/US-002-editor-split-pipe` (forked from the `createFakePort` groundwork, so the shared port fake updates in ONE place).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/contracts/src/draft/index.ts` | modify | `SplitPipeRequest` schema |
| `packages/contracts/src/draft/draft.test.ts` | modify | contract test |
| `packages/map-runtime/src/port/map-engine-port.ts` | modify | +2 port methods |
| `packages/map-runtime/src/testing/fake-port.ts` | modify | fake methods + `emitFeaturePointPick` |
| `packages/map-runtime/src/port/map-engine-port.test.ts` | modify | port contract test |
| `packages/map-runtime/src/openlayers/ol-map-adapter.ts` | modify | hit-test + project click onto draft feature |
| `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts` | modify | adapter smoke test |
| `apps/gis-core/src/shared/api/mocks/handlers.ts` | modify | `POST .../split` + `splitLineAt` |
| `apps/gis-core/src/shared/api/mocks/draft.handler.test.ts` | modify | handler test |
| `apps/gis-core/src/entities/draft-feature/api/commands.ts` | modify | `splitPipe` command |
| `apps/gis-core/src/entities/draft-feature/model/types.ts` | modify | re-export `SplitPipeRequest` |
| `apps/gis-core/src/entities/draft-feature/index.ts` | modify | barrel: export `splitPipe` |
| `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts` | modify | command test |
| `apps/gis-core/src/features/digitize/model/digitize-store.ts` | modify | add `'split'` mode |
| `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx` | modify | Split button + effect + mutation |
| `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx` | modify | component test |
| `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx` | modify | integration test |

---

## Task 1: Contract — `SplitPipeRequest`

**Files:**
- Modify: `packages/contracts/src/draft/index.ts`
- Test: `packages/contracts/src/draft/draft.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe('draft contracts', …)` block in `draft.test.ts`, and add `SplitPipeRequest` to the import from `./index.js`:

```typescript
  it('accepts a valid split request (Point atPoint + correlationId)', () => {
    const req = {
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
      correlationId: 'c-split',
    };
    expect(SplitPipeRequest.parse(req).correlationId).toBe('c-split');
  });

  it('rejects a split request missing atPoint', () => {
    expect(SplitPipeRequest.safeParse({ correlationId: 'c-x' }).success).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix packages/contracts test -- src/draft/draft.test.ts`
Expected: FAIL — `SplitPipeRequest is not defined`.

- [ ] **Step 3: Add the schema** — append to `packages/contracts/src/draft/index.ts` (after `UpdateDraftFeatureGeometryRequest`):

```typescript
/** Command request: split a pipe at a point into two pipes. Mock computes the geometry. */
export const SplitPipeRequest = z.object({
  atPoint: NetworkGeometry,            // Point (EPSG:4326), already on the pipe line
  correlationId: z.string(),
});
export type SplitPipeRequest = z.infer<typeof SplitPipeRequest>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix packages/contracts test -- src/draft/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Build contracts so consumers see the export**

Run: `npm --prefix packages/contracts run build`
Expected: tsc completes, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/draft/index.ts packages/contracts/src/draft/draft.test.ts
git commit -m "feat(contracts): add SplitPipeRequest (draft command)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `@wn/map-runtime` — feature-point pick (port + fake + adapter)

**Files:**
- Modify: `packages/map-runtime/src/port/map-engine-port.ts`
- Modify: `packages/map-runtime/src/testing/fake-port.ts`
- Modify: `packages/map-runtime/src/openlayers/ol-map-adapter.ts`
- Test: `packages/map-runtime/src/port/map-engine-port.test.ts`, `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

- [ ] **Step 1: Write the failing port-contract test** — append inside `describe('createFakePort', …)` in `map-engine-port.test.ts`:

```typescript
  it('records feature-point mode and notifies + unsubscribes feature-point picks', () => {
    const p = createFakePort();
    p.setFeaturePointMode(true);
    expect(p.setFeaturePointMode).toHaveBeenCalledWith(true);
    const seen: Array<[string, { lon: number; lat: number }]> = [];
    const off = p.onFeaturePointPick((id, pt) => seen.push([id, pt]));
    p.emitFeaturePointPick('draft-1', { lon: 105.8, lat: 21 });
    off();
    p.emitFeaturePointPick('draft-2', { lon: 0, lat: 0 });
    expect(seen).toEqual([['draft-1', { lon: 105.8, lat: 21 }]]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix packages/map-runtime test -- src/port/map-engine-port.test.ts`
Expected: FAIL — `setFeaturePointMode`/`onFeaturePointPick`/`emitFeaturePointPick` do not exist.

- [ ] **Step 3: Add the 2 methods to the port interface** — append in `map-engine-port.ts` before `destroy(): void;`:

```typescript
  /** Enter/exit "pick a point on a feature" mode: a click hit-tests the draft layer and reports the click projected onto that feature's geometry. */
  setFeaturePointMode(enabled: boolean): void;
  /** Subscribe to feature-point picks; cb receives (featureId, point lon/lat on the feature). Returns unsubscribe. */
  onFeaturePointPick(cb: (featureId: string, point: Coordinate) => void): () => void;
```

(`Coordinate` is already imported at the top of `map-engine-port.ts`.)

- [ ] **Step 4: Extend `createFakePort`** — in `fake-port.ts`:

Add to the `FakeMapEnginePort` interface (after `emitModify`):

```typescript
  /** Fire all onFeaturePointPick subscribers. */
  emitFeaturePointPick(featureId: string, point: Coordinate): void;
```

Add a subscriber set next to the others in `createFakePort`:

```typescript
  const pointPickSubs = new Set<(id: string, p: Coordinate) => void>();
```

Add the two methods inside the returned object (after `onModifyComplete`):

```typescript
    setFeaturePointMode: vi.fn(),
    onFeaturePointPick: vi.fn((cb: (id: string, p: Coordinate) => void) => {
      pointPickSubs.add(cb);
      return () => pointPickSubs.delete(cb);
    }),
```

Add the emit helper (next to the other `emit*` helpers):

```typescript
    emitFeaturePointPick: (id, point) => pointPickSubs.forEach((cb) => cb(id, point)),
```

- [ ] **Step 5: Run the port test — passes; then verify the adapter typecheck now fails**

Run: `npm --prefix packages/map-runtime test -- src/port/map-engine-port.test.ts`
Expected: PASS.

Run: `npm --prefix packages/map-runtime run typecheck`
Expected: FAIL — `OlMapAdapter` does not implement `setFeaturePointMode`/`onFeaturePointPick`.

- [ ] **Step 6: Write the failing adapter smoke test** — append inside `describe('OlMapAdapter (smoke, jsdom)', …)` in `ol-map-adapter.test.ts`:

```typescript
  it('toggles feature-point mode and subscribes to picks without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('draft', fc);
      const off = adapter.onFeaturePointPick(() => {});
      adapter.setFeaturePointMode(true);
      adapter.setFeaturePointMode(false);
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
```

- [ ] **Step 7: Implement the adapter** — in `ol-map-adapter.ts`:

Add two fields next to the other subscriber sets (after `#snaps`):

```typescript
  #featurePointMode = false;
  #featurePointSubs = new Set<(id: string, c: Coordinate) => void>();
```

Replace the `singleclick` handler inside `mount()` with a gated version:

```typescript
    this.#map.on('singleclick', (evt) => {
      if (this.#featurePointMode) {
        const draftLayer = this.#layers.get('draft');
        const picked = this.#map?.forEachFeatureAtPixel(evt.pixel, (f) => f, {
          layerFilter: (l) => l === draftLayer,
        });
        const g = picked?.getGeometry();
        const id = picked?.getId();
        if (picked && g && id != null) {
          const onLine = g.getClosestPoint(evt.coordinate);
          const [lon, lat] = toLonLat(onLine, this.#view.getProjection());
          this.#featurePointSubs.forEach((cb) => cb(String(id), { lon: lon ?? 0, lat: lat ?? 0 }));
        }
        return;
      }
      const hit = this.#map?.forEachFeatureAtPixel(evt.pixel, (f) => f.getId());
      if (hit != null) this.#clickSubs.forEach((cb) => cb(String(hit)));
    });
```

Add the two methods (place them after `onModifyComplete`):

```typescript
  setFeaturePointMode(enabled: boolean): void {
    this.#featurePointMode = enabled;
  }

  onFeaturePointPick(cb: (id: string, c: Coordinate) => void): () => void {
    this.#featurePointSubs.add(cb);
    return () => this.#featurePointSubs.delete(cb);
  }
```

In `destroy()`, add cleanup (after `this.#drawSource.clear();`):

```typescript
    this.#featurePointMode = false;
    this.#featurePointSubs.clear();
```

- [ ] **Step 8: Run tests + typecheck + build**

Run: `npm --prefix packages/map-runtime test`
Expected: PASS (all files).

Run: `npm --prefix packages/map-runtime run typecheck`
Expected: no errors.

Run: `npm --prefix packages/map-runtime run build`
Expected: tsc completes (so gis-core sees the new `MapEnginePort` methods via dist).

- [ ] **Step 9: Commit**

```bash
git add packages/map-runtime/src/port/map-engine-port.ts \
        packages/map-runtime/src/port/map-engine-port.test.ts \
        packages/map-runtime/src/testing/fake-port.ts \
        packages/map-runtime/src/openlayers/ol-map-adapter.ts \
        packages/map-runtime/src/openlayers/ol-map-adapter.test.ts
git commit -m "feat(map-runtime): feature-point pick (setFeaturePointMode/onFeaturePointPick)" \
  -m "Click hit-tests the draft layer and reports the click projected onto the feature's geometry (ol getClosestPoint, inside the adapter). createFakePort gains the 2 methods + emitFeaturePointPick in one place." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: MSW — `POST .../split` handler

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`
- Test: `apps/gis-core/src/shared/api/mocks/draft.handler.test.ts`

- [ ] **Step 1: Write the failing handler test** — append inside `describe('default MSW handler: draft features', …)` in `draft.handler.test.ts`. Add `z` to the vitest import line (`import { describe, expect, it, beforeEach, vi } from 'vitest'` stays; add `import { z } from 'zod'` at top):

```typescript
  it('POST .../split replaces a pipe with two pipes (original id gone)', async () => {
    const created = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'pipe',
        geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
        correlationId: 'c-1',
      }),
    );
    const raw = await httpClient.post<unknown>(
      `/snapshot/snap-1/draft/features/${created.id}/split`,
      { atPoint: { type: 'Point', coordinates: [105.81, 21.01] }, correlationId: 'c-2' },
    );
    expect(z.array(DraftNetworkFeature).parse(raw)).toHaveLength(2);
    const all = DraftFeatureCollection.parse(
      await httpClient.get('/snapshot/snap-1/draft/features'),
    );
    expect(all.features).toHaveLength(2);
    expect(all.features.find((f) => f.id === created.id)).toBeUndefined();
  });

  it('rejects splitting an unknown feature (404)', async () => {
    await expect(
      httpClient.post('/snapshot/snap-1/draft/features/nope/split', {
        atPoint: { type: 'Point', coordinates: [105.8, 21] },
        correlationId: 'c-3',
      }),
    ).rejects.toThrow();
  });

  it('rejects a split exactly on an endpoint (400)', async () => {
    const created = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'pipe',
        geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
        correlationId: 'c-4',
      }),
    );
    await expect(
      httpClient.post(`/snapshot/snap-1/draft/features/${created.id}/split`, {
        atPoint: { type: 'Point', coordinates: [105.8, 21] },
        correlationId: 'c-5',
      }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: FAIL — split route not handled (request rejected / 404 on happy path).

- [ ] **Step 3: Implement the handler + helpers** — in `handlers.ts`:

Add `SplitPipeRequest` to the `@wn/contracts/draft` import:

```typescript
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  SplitPipeRequest,
  type DraftNetworkFeature,
} from '@wn/contracts/draft'
```

Add these helpers above `export const handlers = [` :

```typescript
/** Planar distance from point p to segment [a,b] (lon/lat as cartesian — fine for the mock). */
function distToSegment(a: number[], b: number[], p: number[]): number {
  const ax = a[0] ?? 0, ay = a[1] ?? 0, bx = b[0] ?? 0, by = b[1] ?? 0, px = p[0] ?? 0, py = p[1] ?? 0
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Split a LineString's coordinates at `at` (closest segment). Null if degenerate (on an endpoint). */
function splitLineAt(coords: number[][], at: number[]): { a: number[][]; b: number[][] } | null {
  if (coords.length < 2) return null
  const same = (p: number[], q: number[]) =>
    Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0)) < 1e-9
  if (same(at, coords[0]!) || same(at, coords[coords.length - 1]!)) return null
  let best = 0, bestD = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSegment(coords[i]!, coords[i + 1]!, at)
    if (d < bestD) { bestD = d; best = i }
  }
  return { a: [...coords.slice(0, best + 1), at], b: [at, ...coords.slice(best + 1)] }
}
```

Add this handler to the `handlers` array, right after the existing `http.patch('*/snapshot/:id/draft/features/:featureId', …)` handler:

```typescript
  http.post('*/snapshot/:id/draft/features/:featureId/split', async ({ params, request }) => {
    const parsed = SplitPipeRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid split request' }, { status: 422 })
    }
    const idx = draftFeatures.findIndex((f) => f.id === String(params.featureId))
    if (idx < 0) {
      return HttpResponse.json({ error: 'Draft feature not found' }, { status: 404 })
    }
    const target = draftFeatures[idx]!
    if (target.geometry.type !== 'LineString') {
      return HttpResponse.json({ error: 'Only a pipe (LineString) can be split' }, { status: 400 })
    }
    const at = (parsed.data.atPoint as { coordinates: number[] }).coordinates
    const split = splitLineAt(target.geometry.coordinates as number[][], at)
    if (!split) {
      return HttpResponse.json({ error: 'Degenerate split' }, { status: 400 })
    }
    const make = (c: number[][]): DraftNetworkFeature => ({
      type: 'Feature',
      id: `draft-${++draftSeq}`,
      geometry: { type: 'LineString', coordinates: c },
      properties: { ...target.properties },
    })
    const a = make(split.a), b = make(split.b)
    draftFeatures.splice(idx, 1, a, b)
    return HttpResponse.json([a, b], { status: 200 })
  }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/shared/api/mocks/handlers.ts \
        apps/gis-core/src/shared/api/mocks/draft.handler.test.ts
git commit -m "feat(gis-core): MSW POST split handler (mock CQRS split pipe)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Entity command — `splitPipe`

**Files:**
- Modify: `apps/gis-core/src/entities/draft-feature/api/commands.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/model/types.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/index.ts`
- Test: `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts`

- [ ] **Step 1: Write the failing test** — in `draft-feature.test.ts`, add `splitPipe` to the dynamic import and append a test inside the `describe` block:

Change the import line to:

```typescript
const { createDraftFeature, fetchDraftFeatures, updateDraftFeatureGeometry, splitPipe } =
  await import('@/entities/draft-feature');
```

Append:

```typescript
  it('splitPipe replaces a pipe with two pipes', async () => {
    const pipe = await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
    });
    const parts = await splitPipe('snap-1', pipe.id, {
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
    });
    expect(parts).toHaveLength(2);
    const collection = await fetchDraftFeatures('snap-1');
    expect(collection.features).toHaveLength(2);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/entities/draft-feature/api/draft-feature.test.ts`
Expected: FAIL — `splitPipe` is not exported.

- [ ] **Step 3: Add the command** — append to `commands.ts`:

```typescript
export interface SplitPipeArgs {
  atPoint: Geometry; // Point (EPSG:4326), already on the pipe line
}

/** CQRS command: split a pipe at a point into two pipes. Mock computes the geometry. */
export async function splitPipe(
  snapshotId: string,
  pipeId: string,
  args: SplitPipeArgs,
): Promise<DraftFeature[]> {
  const raw = await httpClient.post<unknown>(
    `/snapshot/${snapshotId}/draft/features/${pipeId}/split`,
    { atPoint: args.atPoint, correlationId: crypto.randomUUID() },
  );
  return DraftNetworkFeature.array().parse(raw);
}
```

- [ ] **Step 4: Re-export the request type** — in `model/types.ts`, add `SplitPipeRequest` to both export blocks:

```typescript
export {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  SplitPipeRequest,
  DraftNetworkFeature,
  DraftFeatureCollection,
} from '@wn/contracts/draft';
```

- [ ] **Step 5: Export from the barrel** — in `entities/draft-feature/index.ts`, extend the commands export:

```typescript
export {
  createDraftFeature,
  type CreateDraftFeatureArgs,
  updateDraftFeatureGeometry,
  type UpdateDraftFeatureGeometryArgs,
  splitPipe,
  type SplitPipeArgs,
} from './api/commands';
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- src/entities/draft-feature/api/draft-feature.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-core/src/entities/draft-feature/api/commands.ts \
        apps/gis-core/src/entities/draft-feature/model/types.ts \
        apps/gis-core/src/entities/draft-feature/index.ts \
        apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts
git commit -m "feat(gis-core): splitPipe draft command (entity)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: digitize-store `'split'` mode + DigitizeToolbar Split button

**Files:**
- Modify: `apps/gis-core/src/features/digitize/model/digitize-store.ts`
- Modify: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx`
- Test: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx`

- [ ] **Step 1: Write the failing component test** — in `digitize-toolbar.test.tsx`, extend the `spyPort` helper and add a test.

Extend `spyPort` (add two members to the returned object):

```typescript
    featurePointToggles: () => vi.mocked(port.setFeaturePointMode).mock.calls.map(([e]) => e),
    emitFeaturePointPick: port.emitFeaturePointPick,
```

Append this test inside `describe('DigitizeToolbar', …)`:

```typescript
  it('enables feature-point mode (and disables draw/modify) when Split is clicked', async () => {
    const { port, drawModes, modifyToggles, featurePointToggles } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-split'));
    expect(featurePointToggles().at(-1)).toBe(true);
    expect(modifyToggles().at(-1)).toBe(false);
    expect(drawModes().at(-1)).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/features/digitize/ui/digitize-toolbar.test.tsx`
Expected: FAIL — no `edit-split` button / `setFeaturePointMode` never called true.

- [ ] **Step 3: Add `'split'` to the store** — in `digitize-store.ts` change the `EditMode` type:

```typescript
/** Editor interaction modes: draw a kind, modify existing geometry, split a pipe, or idle (null). */
export type EditMode = DrawKind | 'modify' | 'split';
```

- [ ] **Step 4: Wire the toolbar** — in `digitize-toolbar.tsx`:

Add `splitPipe` to the entity import:

```typescript
import { createDraftFeature, updateDraftFeatureGeometry, splitPipe } from '@/entities/draft-feature';
```

Add a split mutation after the `update` mutation:

```typescript
  const split = useMutation(() => ({
    mutationFn: (input: { pipeId: string; atPoint: Geometry }) =>
      splitPipe(props.snapshotId, input.pipeId, { atPoint: input.atPoint }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) });
      // Do NOT clear the mode — split is a repeated operation (spec §2e).
    },
  }));
```

Replace the "Drive the port's draw + modify modes" effect with a 3-mode version:

```typescript
  // Drive the port's draw + modify + feature-point modes from the store (mutually exclusive).
  createEffect(() => {
    const p = port();
    if (!p) return;
    const m = store.mode();
    p.setDrawMode(m === 'pipe' || m === 'node' ? GEOM[m] : null);
    p.setModifyMode(m === 'modify');
    p.setFeaturePointMode(m === 'split');
  });
```

Add an effect that fires the split command on a pick (after the `onModifyComplete` effect):

```typescript
  // Fire the split command when a point is picked on a pipe.
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onFeaturePointPick((pipeId: string, point) => {
      split.mutate({ pipeId, atPoint: { type: 'Point', coordinates: [point.lon, point.lat] } });
    });
    onCleanup(off);
  });
```

Add the Split button after the Modify button (before the `<Show>` Cancel):

```tsx
      <button
        type="button"
        data-testid="edit-split"
        classList={{ 'font-bold': store.mode() === 'split' }}
        onClick={() => store.toggle('split')}
      >
        Split
      </button>
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- src/features/digitize/ui/digitize-toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-core/src/features/digitize/model/digitize-store.ts \
        apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx \
        apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx
git commit -m "feat(gis-core): Split mode in digitize toolbar (feature-point pick)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Integration — `GisEditorPage` split round-trip

**Files:**
- Test: `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx`

- [ ] **Step 1: Write the failing integration test** — in `editor-page.test.tsx`, add `emitFeaturePointPick` to the `spyPort` helper's returned object:

```typescript
    emitFeaturePointPick: port.emitFeaturePointPick,
```

Append this test inside `describe('GisEditorPage', …)`:

```typescript
  it('splits a draft pipe at a clicked point into two pipes on the draft plane', async () => {
    const { port, draftSets, emitDraw, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <GisEditorPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-shell')).toBeInTheDocument());

    // Create one draft pipe to split.
    fireEvent.click(getByTestId('draw-pipe'));
    emitDraw({ type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] });
    await waitFor(() => expect(draftSets().some((c) => c.features.length === 1)).toBe(true));
    const created = draftSets().find((c) => c.features.length === 1)!.features[0]!;
    const id = String(created.id);

    // Enter Split mode and pick a mid point on the pipe.
    fireEvent.click(getByTestId('edit-split'));
    emitFeaturePointPick(id, { lon: 105.81, lat: 21.01 });

    // The split command replaces the pipe with two pipes; the plane re-renders 2 features.
    await waitFor(() => expect(draftSets().some((c) => c.features.length === 2)).toBe(true));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/pages/gis/editor/editor-page.test.tsx`
Expected: FAIL before the toolbar/handler are wired; PASS once Tasks 3–5 are in. (If running the whole plan in order, this verifies the end-to-end seam.)

- [ ] **Step 3: Run the full gis-core suite + typecheck**

Run: `npm --prefix apps/gis-core run test:run`
Expected: PASS (all files).

Run: `npm --prefix apps/gis-core run typecheck`
Expected: no errors.

- [ ] **Step 4: Run size check (ol stays in the adapter chunk)**

Run: `npm --prefix apps/gis-core run build && npm --prefix apps/gis-core run size`
Expected: build succeeds; size-limit within budget; `ol` rides the `ol-map-adapter-*` chunk, `index` not bloated.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/pages/gis/editor/editor-page.test.tsx
git commit -m "test(gis-core): editor split-pipe round-trip integration" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §3 port (2 generic methods) → Task 2. ✓
- §3 `createFakePort` + emit → Task 2 (steps 4). ✓
- §3 adapter hit-test + closestPoint + ol-containment → Task 2 (step 7). ✓
- §4 `SplitPipeRequest` → Task 1. ✓
- §5 MSW split handler (404 / 400 not-a-pipe / 400 degenerate / closest-segment) → Task 3. ✓
- §6 entity command `splitPipe` + types re-export → Task 4. ✓
- §6 store `'split'` + toolbar button + effect (mutually exclusive) + no-reset → Task 5. ✓
- §6/§7 pick → mutate → invalidate → refetch → plane re-render → Task 5 + Task 6. ✓
- §11 testing matrix (contract / port / adapter / MSW / entity / component / integration / size) → Tasks 1–6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command + expected result. ✓

**3. Type consistency:**
- Port: `setFeaturePointMode(boolean)` / `onFeaturePointPick(featureId: string, point: Coordinate)` — same in interface (Task 2.3), fake (Task 2.4), adapter (Task 2.7), toolbar callback (Task 5.4). ✓
- `Coordinate` = `{ lon, lat }` (port `types.ts`); toolbar wraps to `{ type: 'Point', coordinates: [lon, lat] }` (Task 5.4) → command `SplitPipeArgs.atPoint: Geometry` (Task 4.3) → `SplitPipeRequest.atPoint: NetworkGeometry` (Task 1.3) → handler reads `atPoint.coordinates` (Task 3.3). ✓
- `splitPipe(...)` returns `DraftFeature[]` (`DraftNetworkFeature.array().parse`); handler returns a JSON array of 2 features (Task 3.3); test asserts length 2 (Tasks 3, 4, 6). ✓
- Test id `edit-split` consistent between toolbar (Task 5.4) and component/integration tests (Tasks 5.1, 6.1). ✓

**Build-order note:** Task 1 rebuilds contracts and Task 2 rebuilds map-runtime so gis-core (Tasks 3–6, which consume dist for `@wn/contracts/draft` and `MapEnginePort`) typecheck against the new exports. `createFakePort` is consumed from source via the vitest alias, so no rebuild is needed for the fake itself.
