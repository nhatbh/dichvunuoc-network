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
