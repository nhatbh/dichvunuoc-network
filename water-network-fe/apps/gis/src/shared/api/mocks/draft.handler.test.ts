// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';

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
});
