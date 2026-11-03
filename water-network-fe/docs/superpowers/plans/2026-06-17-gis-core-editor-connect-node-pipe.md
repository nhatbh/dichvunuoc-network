# GIS Core Editor — Connect node↔pipe (slice 2.3b-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Connect mode, click a draft node then a point on a draft pipe to attach the node to the pipe via a `ConnectNodeToPipe` CQRS command (MSW mock splits the pipe at the junction and writes bidirectional connectivity refs).

**Architecture:** Reuse the editor seam from 2.3b-2 with **zero new port methods** — both clicks ride the existing `setFeaturePointMode`/`onFeaturePointPick`. gis-core owns a two-click state machine in `DigitizeToolbar`, distinguishing node-click vs pipe-click by `kind` (read from the draft query cache). The MSW mock reuses the existing `splitLineAt` helper: a mid-pipe pick splits the pipe into two pipes (both referencing the node) and moves the node to the junction; an endpoint pick attaches without splitting. Connectivity is recorded explicitly in a new `connectedFeatureIds` prop (both directions). `ol` stays untouched inside the adapter.

**Tech Stack:** Solid.js + Vite + TanStack Solid Query · `@wn/map-runtime` (OpenLayers behind `MapEnginePort`) · `@wn/contracts` (Zod) · MSW · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-gis-core-editor-connect-node-pipe-design.md`
**Branch:** `feature/US-002-editor-connect-node-pipe` (already created; spec committed).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/contracts/src/map-features/index.ts` | modify | `NetworkFeatureProps.connectedFeatureIds` |
| `packages/contracts/src/map-features/map-features.test.ts` | modify | props contract test |
| `packages/contracts/src/draft/index.ts` | modify | `ConnectNodeToPipeRequest` schema |
| `packages/contracts/src/draft/draft.test.ts` | modify | command contract test |
| `apps/gis-core/src/shared/api/mocks/handlers.ts` | modify | `POST .../connect` (reuses `splitLineAt`) |
| `apps/gis-core/src/shared/api/mocks/draft.handler.test.ts` | modify | handler test |
| `apps/gis-core/src/entities/draft-feature/api/commands.ts` | modify | `connectNodeToPipe` command |
| `apps/gis-core/src/entities/draft-feature/model/types.ts` | modify | re-export `ConnectNodeToPipeRequest` |
| `apps/gis-core/src/entities/draft-feature/index.ts` | modify | barrel: export `connectNodeToPipe` |
| `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts` | modify | command test |
| `apps/gis-core/src/features/digitize/model/digitize-store.ts` | modify | `'connect'` mode + `pendingConnectNodeId` |
| `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx` | modify | Connect button + selection effect + branched pick handler + mutation |
| `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx` | modify | component test |
| `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx` | modify | integration test |

> **No `@wn/map-runtime` changes** — the port, adapter, and `createFakePort` already expose `setFeaturePointMode`/`onFeaturePointPick`/`emitFeaturePointPick`/`setSelection` from 2.3b-2.

---

## Task 1: Contract — `connectedFeatureIds` prop + `ConnectNodeToPipeRequest`

**Files:**
- Modify: `packages/contracts/src/map-features/index.ts`
- Modify: `packages/contracts/src/draft/index.ts`
- Test: `packages/contracts/src/map-features/map-features.test.ts`, `packages/contracts/src/draft/draft.test.ts`

- [ ] **Step 1: Write the failing prop test** — append inside `describe('map-features contract', …)` in `map-features.test.ts`:

```typescript
  it('parses optional connectedFeatureIds on props', () => {
    const connected = {
      ...point,
      properties: { kind: 'node', connectedFeatureIds: ['pipe-1', 'pipe-2'] },
    };
    expect(NetworkFeature.parse(connected).properties.connectedFeatureIds).toEqual([
      'pipe-1',
      'pipe-2',
    ]);
  });

  it('rejects a non-string connectedFeatureIds entry', () => {
    const bad = { ...point, properties: { kind: 'node', connectedFeatureIds: [1] } };
    expect(() => NetworkFeature.parse(bad)).toThrow();
  });
```

- [ ] **Step 2: Write the failing command test** — append inside the draft contracts `describe(…)` block in `draft.test.ts`, and add `ConnectNodeToPipeRequest` to the import from `./index.js`:

```typescript
  it('accepts a valid connect request (nodeId + Point atPoint + correlationId)', () => {
    const req = {
      nodeId: 'node-1',
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
      correlationId: 'c-connect',
    };
    expect(ConnectNodeToPipeRequest.parse(req).nodeId).toBe('node-1');
  });

  it('rejects a connect request missing nodeId', () => {
    expect(
      ConnectNodeToPipeRequest.safeParse({
        atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
        correlationId: 'c-x',
      }).success,
    ).toBe(false);
  });
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npm --prefix packages/contracts test -- src/map-features/map-features.test.ts src/draft/draft.test.ts`
Expected: FAIL — `connectedFeatureIds` not parsed / `ConnectNodeToPipeRequest is not defined`.

- [ ] **Step 4: Add the prop** — in `packages/contracts/src/map-features/index.ts`, extend `NetworkFeatureProps`:

```typescript
export const NetworkFeatureProps = z.object({
  kind: NetworkFeatureKind,
  name: z.string().optional(),
  status: z.string().optional(),
  connectedFeatureIds: z.array(z.string()).optional(), // pipe → node-ids; node → pipe-ids (bidirectional topology)
});
```

- [ ] **Step 5: Add the command schema** — append to `packages/contracts/src/draft/index.ts` (after `SplitPipeRequest`):

```typescript
/** Command request: connect a node to a pipe at a point. Mock moves the node to the junction,
 *  splits the pipe if the point is interior, and writes bidirectional connectedFeatureIds. */
export const ConnectNodeToPipeRequest = z.object({
  nodeId: z.string(),                  // the draft node to attach (click 1)
  atPoint: NetworkGeometry,            // Point (EPSG:4326), already on the pipe line (click 2)
  correlationId: z.string(),
});
export type ConnectNodeToPipeRequest = z.infer<typeof ConnectNodeToPipeRequest>;
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npm --prefix packages/contracts test -- src/map-features/map-features.test.ts src/draft/draft.test.ts`
Expected: PASS.

- [ ] **Step 7: Build contracts so consumers see the exports**

Run: `npm --prefix packages/contracts run build`
Expected: tsc completes, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/map-features/index.ts \
        packages/contracts/src/map-features/map-features.test.ts \
        packages/contracts/src/draft/index.ts \
        packages/contracts/src/draft/draft.test.ts
git commit -m "feat(contracts): connectedFeatureIds prop + ConnectNodeToPipeRequest" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: MSW — `POST .../connect` handler (reuses `splitLineAt`)

**Files:**
- Modify: `apps/gis-core/src/shared/api/mocks/handlers.ts`
- Test: `apps/gis-core/src/shared/api/mocks/draft.handler.test.ts`

The existing `splitLineAt(coords, at)` (from slice 2.3b-2) returns `{ a, b } | null`, where `null` means
`at` lands on an endpoint. Connect reuses it directly: non-null → split into two pipes; null → endpoint
attach (no split). No refactor needed — it is already a standalone function in `handlers.ts`.

- [ ] **Step 1: Write the failing handler tests** — append inside `describe('default MSW handler: draft features', …)` in `draft.handler.test.ts`. Ensure `z` is imported (`import { z } from 'zod'` — already added in slice 2.3b-2; keep if present):

```typescript
  it('POST .../connect (mid-pipe) splits into two pipes referencing the node, moves node to junction', async () => {
    const node = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'node',
        geometry: { type: 'Point', coordinates: [105.79, 21.0] },
        correlationId: 'c-n',
      }),
    );
    const pipe = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'pipe',
        geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
        correlationId: 'c-p',
      }),
    );
    const affected = z.array(DraftNetworkFeature).parse(
      await httpClient.post(`/snapshot/snap-1/draft/features/${pipe.id}/connect`, {
        nodeId: node.id,
        atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
        correlationId: 'c-c',
      }),
    );
    // affected = 2 new pipes + the moved node
    const pipes = affected.filter((f) => f.geometry.type === 'LineString');
    const movedNode = affected.find((f) => f.id === node.id)!;
    expect(pipes).toHaveLength(2);
    expect(movedNode.geometry).toEqual({ type: 'Point', coordinates: [105.81, 21.01] });
    expect(new Set(movedNode.properties.connectedFeatureIds)).toEqual(
      new Set(pipes.map((p) => p.id)),
    );
    for (const p of pipes) expect(p.properties.connectedFeatureIds).toContain(node.id);

    const all = DraftFeatureCollection.parse(
      await httpClient.get('/snapshot/snap-1/draft/features'),
    );
    // original pipe gone; 2 new pipes + node = 3 features
    expect(all.features.find((f) => f.id === pipe.id)).toBeUndefined();
    expect(all.features).toHaveLength(3);
  });

  it('POST .../connect (endpoint) attaches without splitting', async () => {
    const node = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'node',
        geometry: { type: 'Point', coordinates: [105.79, 21.0] },
        correlationId: 'c-n2',
      }),
    );
    const pipe = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'pipe',
        geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
        correlationId: 'c-p2',
      }),
    );
    const affected = z.array(DraftNetworkFeature).parse(
      await httpClient.post(`/snapshot/snap-1/draft/features/${pipe.id}/connect`, {
        nodeId: node.id,
        atPoint: { type: 'Point', coordinates: [105.8, 21] }, // exactly the start endpoint
        correlationId: 'c-c2',
      }),
    );
    const pipes = affected.filter((f) => f.geometry.type === 'LineString');
    expect(pipes).toHaveLength(1);
    expect(pipes[0]!.id).toBe(pipe.id); // same pipe, not split
    expect(pipes[0]!.properties.connectedFeatureIds).toContain(node.id);
    const movedNode = affected.find((f) => f.id === node.id)!;
    expect(movedNode.properties.connectedFeatureIds).toEqual([pipe.id]);
  });

  it('rejects connect with an unknown pipe (404)', async () => {
    const node = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'node',
        geometry: { type: 'Point', coordinates: [105.79, 21.0] },
        correlationId: 'c-n3',
      }),
    );
    await expect(
      httpClient.post('/snapshot/snap-1/draft/features/nope/connect', {
        nodeId: node.id,
        atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
        correlationId: 'c-c3',
      }),
    ).rejects.toThrow();
  });

  it('rejects connect when nodeId is not a node (400)', async () => {
    const pipe = DraftNetworkFeature.parse(
      await httpClient.post('/snapshot/snap-1/draft/features', {
        kind: 'pipe',
        geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
        correlationId: 'c-p4',
      }),
    );
    await expect(
      httpClient.post(`/snapshot/snap-1/draft/features/${pipe.id}/connect`, {
        nodeId: pipe.id, // a pipe, not a node
        atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
        correlationId: 'c-c4',
      }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: FAIL — connect route not handled (happy paths reject / 404).

- [ ] **Step 3: Implement the handler** — in `handlers.ts`:

Add `ConnectNodeToPipeRequest` to the `@wn/contracts/draft` import (alongside `SplitPipeRequest`):

```typescript
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  SplitPipeRequest,
  ConnectNodeToPipeRequest,
  type DraftNetworkFeature,
} from '@wn/contracts/draft'
```

Add this handler to the `handlers` array, right after the `http.post('*/snapshot/:id/draft/features/:featureId/split', …)` handler:

```typescript
  http.post('*/snapshot/:id/draft/features/:featureId/connect', async ({ params, request }) => {
    const parsed = ConnectNodeToPipeRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid connect request' }, { status: 422 })
    }
    const pipe = draftFeatures.find((f) => f.id === String(params.featureId))
    if (!pipe) {
      return HttpResponse.json({ error: 'Pipe not found' }, { status: 404 })
    }
    if (pipe.geometry.type !== 'LineString') {
      return HttpResponse.json({ error: 'Connect target must be a pipe (LineString)' }, { status: 400 })
    }
    const node = draftFeatures.find((f) => f.id === parsed.data.nodeId)
    if (!node) {
      return HttpResponse.json({ error: 'Node not found' }, { status: 404 })
    }
    if (node.properties.kind !== 'node') {
      return HttpResponse.json({ error: 'nodeId must reference a node' }, { status: 400 })
    }
    const at = (parsed.data.atPoint as { coordinates: number[] }).coordinates
    const dedupe = (ids: string[]) => [...new Set(ids)]

    const movedNode: DraftNetworkFeature = {
      ...node,
      geometry: { type: 'Point', coordinates: at },
      properties: { ...node.properties },
    }

    const split = splitLineAt(pipe.geometry.coordinates as number[][], at)
    let newPipes: DraftNetworkFeature[]
    if (split) {
      // Interior pick → split into two pipes, both referencing the node.
      const make = (c: number[][]): DraftNetworkFeature => ({
        type: 'Feature',
        id: `draft-${++draftSeq}`,
        geometry: { type: 'LineString', coordinates: c },
        properties: {
          ...pipe.properties,
          connectedFeatureIds: dedupe([...(pipe.properties.connectedFeatureIds ?? []), node.id]),
        },
      })
      newPipes = [make(split.a), make(split.b)]
      movedNode.properties.connectedFeatureIds = dedupe([
        ...(node.properties.connectedFeatureIds ?? []),
        ...newPipes.map((p) => p.id),
      ])
    } else {
      // Endpoint pick → attach without splitting; keep the same pipe id.
      const updatedPipe: DraftNetworkFeature = {
        ...pipe,
        properties: {
          ...pipe.properties,
          connectedFeatureIds: dedupe([...(pipe.properties.connectedFeatureIds ?? []), node.id]),
        },
      }
      newPipes = [updatedPipe]
      movedNode.properties.connectedFeatureIds = dedupe([
        ...(node.properties.connectedFeatureIds ?? []),
        pipe.id,
      ])
    }

    // Replace the old pipe + old node with the new pipe(s) + moved node (preserve the array reference).
    const remaining = draftFeatures.filter((f) => f.id !== pipe.id && f.id !== node.id)
    draftFeatures.length = 0
    draftFeatures.push(...remaining, ...newPipes, movedNode)

    return HttpResponse.json([...newPipes, movedNode], { status: 200 })
  }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- src/shared/api/mocks/draft.handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/shared/api/mocks/handlers.ts \
        apps/gis-core/src/shared/api/mocks/draft.handler.test.ts
git commit -m "feat(gis-core): MSW POST connect handler (mock CQRS connect node↔pipe)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Entity command — `connectNodeToPipe`

**Files:**
- Modify: `apps/gis-core/src/entities/draft-feature/api/commands.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/model/types.ts`
- Modify: `apps/gis-core/src/entities/draft-feature/index.ts`
- Test: `apps/gis-core/src/entities/draft-feature/api/draft-feature.test.ts`

- [ ] **Step 1: Write the failing test** — in `draft-feature.test.ts`, add `connectNodeToPipe` to the dynamic import and append a test:

Change the import line to:

```typescript
const {
  createDraftFeature,
  fetchDraftFeatures,
  updateDraftFeatureGeometry,
  splitPipe,
  connectNodeToPipe,
} = await import('@/entities/draft-feature');
```

Append:

```typescript
  it('connectNodeToPipe splits a pipe and attaches the node at the junction', async () => {
    const node = await createDraftFeature('snap-1', {
      kind: 'node',
      geometry: { type: 'Point', coordinates: [105.79, 21.0] },
    });
    const pipe = await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
    });
    const affected = await connectNodeToPipe('snap-1', pipe.id, {
      nodeId: node.id,
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
    });
    expect(affected.filter((f) => f.geometry.type === 'LineString')).toHaveLength(2);
    const collection = await fetchDraftFeatures('snap-1');
    // 2 new pipes + node
    expect(collection.features).toHaveLength(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/entities/draft-feature/api/draft-feature.test.ts`
Expected: FAIL — `connectNodeToPipe` is not exported.

- [ ] **Step 3: Add the command** — append to `commands.ts`:

```typescript
export interface ConnectNodeToPipeArgs {
  nodeId: string;
  atPoint: Geometry; // Point (EPSG:4326), already on the pipe line
}

/** CQRS command: connect a node to a pipe at a point. Mock splits the pipe (if interior) and
 *  writes bidirectional connectivity. Returns the affected features (pipe(s) + moved node). */
export async function connectNodeToPipe(
  snapshotId: string,
  pipeId: string,
  args: ConnectNodeToPipeArgs,
): Promise<DraftFeature[]> {
  const raw = await httpClient.post<unknown>(
    `/snapshot/${snapshotId}/draft/features/${pipeId}/connect`,
    { nodeId: args.nodeId, atPoint: args.atPoint, correlationId: crypto.randomUUID() },
  );
  return DraftNetworkFeature.array().parse(raw);
}
```

- [ ] **Step 4: Re-export the request type** — in `model/types.ts`, add `ConnectNodeToPipeRequest` to the value export block:

```typescript
export {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  SplitPipeRequest,
  ConnectNodeToPipeRequest,
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
  connectNodeToPipe,
  type ConnectNodeToPipeArgs,
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
git commit -m "feat(gis-core): connectNodeToPipe draft command (entity)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: digitize-store `'connect'` mode + DigitizeToolbar Connect button

**Files:**
- Modify: `apps/gis-core/src/features/digitize/model/digitize-store.ts`
- Modify: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.tsx`
- Test: `apps/gis-core/src/features/digitize/ui/digitize-toolbar.test.tsx`

- [ ] **Step 1: Write the failing component tests** — in `digitize-toolbar.test.tsx`, ensure the `spyPort` helper exposes the members used below. Add any missing ones to its returned object:

```typescript
    featurePointToggles: () => vi.mocked(port.setFeaturePointMode).mock.calls.map(([e]) => e),
    selections: () => vi.mocked(port.setSelection).mock.calls.map(([id]) => id),
    emitFeaturePointPick: port.emitFeaturePointPick,
```

Append these tests inside `describe('DigitizeToolbar', …)`:

```typescript
  it('enables feature-point mode (and disables draw/modify) when Connect is clicked', async () => {
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
    fireEvent.click(getByTestId('edit-connect'));
    expect(featurePointToggles().at(-1)).toBe(true);
    expect(modifyToggles().at(-1)).toBe(false);
    expect(drawModes().at(-1)).toBeNull();
  });

  it('in Connect mode: picking a node then a pipe fires connectNodeToPipe and highlights the node', async () => {
    const { port, selections, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    // Seed the draft query cache so kind lookup resolves (node-1 = node, pipe-1 = pipe).
    qc.setQueryData(['draft-features', 'snap-1'], {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'node-1', geometry: { type: 'Point', coordinates: [105.79, 21] }, properties: { kind: 'node' } },
        { type: 'Feature', id: 'pipe-1', geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] }, properties: { kind: 'pipe' } },
      ],
    });
    const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([]);
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));

    // Click 1: the node → highlighted, no command yet.
    emitFeaturePointPick('node-1', { lon: 105.79, lat: 21 });
    expect(selections().at(-1)).toBe('node-1');
    expect(postSpy).not.toHaveBeenCalled();

    // Click 2: the pipe → connect command fires with the pending node + atPoint.
    emitFeaturePointPick('pipe-1', { lon: 105.81, lat: 21.01 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [url, body] = postSpy.mock.calls[0]!;
    expect(url).toBe('/snapshot/snap-1/draft/features/pipe-1/connect');
    expect(body).toMatchObject({
      nodeId: 'node-1',
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
    });
    postSpy.mockRestore();
  });

  it('in Connect mode: picking a pipe with no pending node does nothing', async () => {
    const { port, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    qc.setQueryData(['draft-features', 'snap-1'], {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'pipe-1', geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] }, properties: { kind: 'pipe' } },
      ],
    });
    const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([]);
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));
    emitFeaturePointPick('pipe-1', { lon: 105.81, lat: 21.01 });
    expect(postSpy).not.toHaveBeenCalled();
    postSpy.mockRestore();
  });
```

> If `httpClient` is not yet imported in this test file, add `import { httpClient } from '@/shared/api/http-client';` at the top.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/gis-core run test:run -- src/features/digitize/ui/digitize-toolbar.test.tsx`
Expected: FAIL — no `edit-connect` button / `setFeaturePointMode` never called true in connect mode / no connect POST.

- [ ] **Step 3: Add `'connect'` mode + pending node to the store** — replace the body of `digitize-store.ts` with:

```typescript
import { createSignal } from 'solid-js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';

/** Kinds the digitize tool draws. */
export type DrawKind = Extract<NetworkFeatureKind, 'pipe' | 'node'>;
/** Editor interaction modes: draw a kind, modify geometry, split a pipe, connect node↔pipe, or idle. */
export type EditMode = DrawKind | 'modify' | 'split' | 'connect';

/** Client UI state for the editor toolbar: the active interaction mode (null = idle) plus the
 *  node awaiting a pipe pick in connect mode. */
export function createDigitizeStore() {
  const [mode, setMode] = createSignal<EditMode | null>(null);
  const [pendingConnectNodeId, setPendingConnectNodeId] = createSignal<string | null>(null);
  const toggle = (m: EditMode) =>
    setMode((cur) => {
      setPendingConnectNodeId(null); // any mode change resets the pending node
      return cur === m ? null : m;
    });
  const clear = () => {
    setPendingConnectNodeId(null);
    setMode(null);
  };
  return { mode, toggle, clear, pendingConnectNodeId, setPendingConnectNodeId };
}
```

- [ ] **Step 4: Wire the toolbar** — in `digitize-toolbar.tsx`:

Extend the entity import and add type imports for the kind lookup:

```typescript
import {
  createDraftFeature,
  updateDraftFeatureGeometry,
  splitPipe,
  connectNodeToPipe,
} from '@/entities/draft-feature';
import type { DraftFeatures } from '@/entities/draft-feature';
```

Add a connect mutation after the `split` mutation:

```typescript
  const connect = useMutation(() => ({
    mutationFn: (input: { nodeId: string; pipeId: string; atPoint: Geometry }) =>
      connectNodeToPipe(props.snapshotId, input.pipeId, {
        nodeId: input.nodeId,
        atPoint: input.atPoint,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) });
      store.setPendingConnectNodeId(null); // clears the highlight via the selection effect; mode stays (spec §2e)
    },
  }));
```

Update the mode-driving effect to enable feature-point mode for `'connect'` too:

```typescript
  // Drive the port's draw + modify + feature-point modes from the store (mutually exclusive).
  createEffect(() => {
    const p = port();
    if (!p) return;
    const m = store.mode();
    p.setDrawMode(m === 'pipe' || m === 'node' ? GEOM[m] : null);
    p.setModifyMode(m === 'modify');
    p.setFeaturePointMode(m === 'split' || m === 'connect');
  });
```

Add an effect that mirrors the pending node into the map selection (highlight):

```typescript
  // Highlight the node awaiting a pipe pick in connect mode (null clears it).
  createEffect(() => {
    const p = port();
    if (!p) return;
    p.setSelection(store.pendingConnectNodeId());
  });
```

Replace the existing `onFeaturePointPick` effect (which only handled split) with a mode-branching version:

```typescript
  // Feature-point picks drive Split (one click) or Connect (node then pipe).
  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onFeaturePointPick((featureId: string, point) => {
      const at: Geometry = { type: 'Point', coordinates: [point.lon, point.lat] };
      const m = store.mode();
      if (m === 'split') {
        split.mutate({ pipeId: featureId, atPoint: at });
        return;
      }
      if (m === 'connect') {
        const features = qc.getQueryData<DraftFeatures>(
          queryKeys.draftFeatures.all(props.snapshotId),
        );
        const kind = features?.features.find((f) => f.id === featureId)?.properties.kind;
        if (kind === 'node') {
          store.setPendingConnectNodeId(featureId);
        } else if (kind === 'pipe') {
          const nodeId = store.pendingConnectNodeId();
          if (nodeId) connect.mutate({ nodeId, pipeId: featureId, atPoint: at });
        }
      }
    });
    onCleanup(off);
  });
```

Add the Connect button after the Split button (before the `<Show>` Cancel):

```tsx
      <button
        type="button"
        data-testid="edit-connect"
        classList={{ 'font-bold': store.mode() === 'connect' }}
        onClick={() => store.toggle('connect')}
      >
        Connect
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
git commit -m "feat(gis-core): Connect mode in digitize toolbar (node→pipe pick)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration — `GisEditorPage` connect round-trip

**Files:**
- Test: `apps/gis-core/src/pages/gis/editor/editor-page.test.tsx`

- [ ] **Step 1: Write the failing integration test** — in `editor-page.test.tsx`, ensure the `spyPort` helper's returned object exposes `emitFeaturePointPick: port.emitFeaturePointPick` (added in slice 2.3b-2; keep if present). Append this test inside `describe('GisEditorPage', …)`:

```typescript
  it('connects a draft node to a pipe: pick node then pipe splits the pipe and the plane shows node + 2 pipes', async () => {
    const { port, draftSets, emitDraw, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <GisEditorPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(getByTestId('map-shell')).toBeInTheDocument());

    // Draw a node, then a pipe.
    fireEvent.click(getByTestId('draw-node'));
    emitDraw({ type: 'Point', coordinates: [105.79, 21] });
    await waitFor(() => expect(draftSets().some((c) => c.features.length === 1)).toBe(true));

    fireEvent.click(getByTestId('draw-pipe'));
    emitDraw({ type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] });
    await waitFor(() => expect(draftSets().some((c) => c.features.length === 2)).toBe(true));

    const latest = draftSets().find((c) => c.features.length === 2)!;
    const nodeId = String(latest.features.find((f) => f.geometry.type === 'Point')!.id);
    const pipeId = String(latest.features.find((f) => f.geometry.type === 'LineString')!.id);

    // Enter Connect mode, pick the node then a mid point on the pipe.
    fireEvent.click(getByTestId('edit-connect'));
    emitFeaturePointPick(nodeId, { lon: 105.79, lat: 21 });
    emitFeaturePointPick(pipeId, { lon: 105.81, lat: 21.01 });

    // Pipe split into 2 + node = 3 features on the draft plane.
    await waitFor(() => expect(draftSets().some((c) => c.features.length === 3)).toBe(true));
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm --prefix apps/gis-core run test:run -- src/pages/gis/editor/editor-page.test.tsx`
Expected: PASS (Tasks 2–4 wire the end-to-end seam).

- [ ] **Step 3: Run the full gis-core suite + typecheck**

Run: `npm --prefix apps/gis-core run test:run`
Expected: PASS (all files).

Run: `npm --prefix apps/gis-core run typecheck`
Expected: no errors.

- [ ] **Step 4: Run size check (ol stays in the adapter chunk)**

Run: `npm --prefix apps/gis-core run build && npm --prefix apps/gis-core run size`
Expected: build succeeds; size-limit within budget; no `ol` leak into `index` (Connect adds no adapter code).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-core/src/pages/gis/editor/editor-page.test.tsx
git commit -m "test(gis-core): editor connect node↔pipe round-trip integration" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §2a zero new port methods (reuse pick for both clicks) → Task 4 (branched `onFeaturePointPick`); no map-runtime task. ✓
- §2b geometry in mock + reuse `splitLineAt` → Task 2 (handler reuses existing helper). ✓
- §2c node moves to junction + bidirectional refs → Task 2 (movedNode geometry = `at`, `connectedFeatureIds` both ways). ✓
- §2d mid → 2 pipes; endpoint → attach no split → Task 2 (split-null branch) + handler tests. ✓
- §2e repeated op, no mode reset, clears pending → Task 4 (`onSuccess` clears pending only). ✓
- §3 no port change (adapter/fake already support pick + setSelection) → no task; noted in File Structure. ✓
- §4 `connectedFeatureIds` prop + `ConnectNodeToPipeRequest` → Task 1. ✓
- §5 MSW connect handler (404 pipe / 400 not-a-pipe / 404 node / 400 not-a-node / endpoint attach) → Task 2. ✓
- §7 store `'connect'` + `pendingConnectNodeId`; toolbar button + effects + kind lookup via `getQueryData` → Task 4. ✓
- §7 entity command `connectNodeToPipe` + type re-export + barrel → Task 3. ✓
- §8 pick(node)→highlight, pick(pipe)→mutate→invalidate→refetch→plane re-render → Task 4 + Task 5. ✓
- §12 testing matrix (contract / helper-reuse / MSW / entity / component / integration / size) → Tasks 1–5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command + expected result. ✓

**3. Type consistency:**
- `onFeaturePointPick(featureId: string, point: Coordinate)` → toolbar wraps `{ type: 'Point', coordinates: [point.lon, point.lat] }` (Task 4) → command `ConnectNodeToPipeArgs.atPoint: Geometry` (Task 3) → `ConnectNodeToPipeRequest.atPoint: NetworkGeometry` (Task 1) → handler reads `atPoint.coordinates` (Task 2). ✓
- `connectNodeToPipe(snapshotId, pipeId, { nodeId, atPoint })` returns `DraftFeature[]` (`DraftNetworkFeature.array().parse`); handler returns `[...newPipes, movedNode]` (Task 2); entity/integration assert pipe count + total (Tasks 3, 5). ✓
- `pendingConnectNodeId` / `setPendingConnectNodeId` used consistently in store (Task 4.3) and toolbar (Task 4.4). ✓
- `DraftFeatures` (collection type) used for `getQueryData<DraftFeatures>` (Task 4.4) matches the type re-exported in `model/types.ts`. ✓
- `connectedFeatureIds: string[]` optional in contract (Task 1.4), written by handler (Task 2.3), asserted in handler tests (Task 2.1). ✓
- Test id `edit-connect` consistent between toolbar (Task 4.4) and component/integration tests (Tasks 4.1, 5.1). ✓

**Build-order note:** Task 1 rebuilds contracts so gis-core (Tasks 2–5, which consume dist for `@wn/contracts/draft` + `@wn/contracts/map-features`) typecheck against the new exports. No map-runtime rebuild is needed — the port is unchanged and `createFakePort` is consumed from source via the vitest alias.
