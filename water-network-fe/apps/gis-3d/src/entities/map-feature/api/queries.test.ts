// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/shared/api/mocks/server';
import { aMapFeatureCollection } from '@wn/contracts/testing';

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

const { fetchMapFeatures, searchFeaturesQueryOptions } = await import('./queries');

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

describe('searchFeaturesQueryOptions', () => {
  it('builds a disabled query for short terms and an enabled one otherwise', () => {
    const off = searchFeaturesQueryOptions('snap-1', 'a');
    const on = searchFeaturesQueryOptions('snap-1', 'valve');
    expect(off.enabled).toBe(false);
    expect(on.enabled).toBe(true);
    expect(on.queryKey).toEqual(['map-features', 'snap-1', 'search', 'valve']);
  });
});
