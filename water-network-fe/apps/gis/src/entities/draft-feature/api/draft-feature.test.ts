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

const {
  createDraftFeature,
  fetchDraftFeatures,
  updateDraftFeatureGeometry,
  splitPipe,
  connectNodeToPipe,
} = await import('@/entities/draft-feature');
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
});
