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

const { fetchMapFeatures } = await import('@/entities/map-feature');

describe('default MSW handler: map-features', () => {
  it('serves a parseable collection without per-test overrides', async () => {
    const fc = await fetchMapFeatures('snap-1', [105, 20, 106, 22]);
    expect(fc.features.length).toBeGreaterThan(0);
  });
});
