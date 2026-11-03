/**
 * Query Key Factory
 *
 * Centralized, type-safe query keys for TanStack Query.
 * Add your domain query keys here as your application grows.
 *
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 */

export const queryKeys = {
  session: () => ['session'] as const,

  mapFeatures: {
    byBbox: (snapshotId: string, bbox: readonly number[]) =>
      ['map-features', snapshotId, bbox.join(',')] as const,
    search: (snapshotId: string, q: string) =>
      ['map-features', snapshotId, 'search', q] as const,
  },

  draftFeatures: {
    all: (snapshotId: string) => ['draft-features', snapshotId] as const,
  },
} as const
