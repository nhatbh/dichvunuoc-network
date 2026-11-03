import { PublishedNetworkSnapshot } from '../snapshot/index.js';
import type {
  MapFeatureCollection,
  NetworkFeature,
  FeatureSearchResults,
  FeatureSearchResult,
} from '../map-features/index.js';
import type { DraftFeatureCollection, DraftNetworkFeature } from '../draft/index.js';

/**
 * Deterministic builders for tests/fixtures (replaces the bloated 680-line
 * fixture file in the old repo). Mock adapters share one consistent set.
 */
export function aSnapshot(
  overrides: Partial<PublishedNetworkSnapshot> = {},
): PublishedNetworkSnapshot {
  return {
    snapshotId: '00000000-0000-0000-0000-000000000001',
    version: 1,
    status: 'published',
    crs: 'EPSG:4326',
    publishedAt: '2026-06-15T00:00:00.000Z',
    featureCount: 42,
    ...overrides,
  };
}

export function aMapFeatureCollection(
  opts: { count?: number } = {},
): MapFeatureCollection {
  const count = opts.count ?? 3;
  const kinds = ['node', 'pipe', 'facility'] as const;
  const features: NetworkFeature[] = Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length] as NetworkFeature['properties']['kind'];
    return {
      type: 'Feature' as const,
      id: `feat-${i + 1}`,
      geometry:
        kind === 'pipe'
          ? { type: 'LineString' as const, coordinates: [[105.8 + i * 0.01, 21.0], [105.81 + i * 0.01, 21.01]] }
          : { type: 'Point' as const, coordinates: [105.8 + i * 0.01, 21.0 + i * 0.01] },
      properties: { kind, name: `Feature ${i + 1}`, status: 'active' },
    };
  });
  return { type: 'FeatureCollection', features };
}

export function aFeatureSearchResults(
  opts: { q?: string; count?: number } = {},
): FeatureSearchResults {
  const count = opts.count ?? 3;
  const kinds = ['node', 'pipe', 'facility'] as const;
  const results: FeatureSearchResult[] = Array.from({ length: count }, (_, i) => ({
    id: `feat-${i + 1}`,
    name: `${opts.q ?? 'Feature'} ${i + 1}`,
    kind: kinds[i % kinds.length] as FeatureSearchResult['kind'],
    bbox: [105.8 + i * 0.01, 21.0, 105.81 + i * 0.01, 21.01],
  }));
  return { results };
}

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
