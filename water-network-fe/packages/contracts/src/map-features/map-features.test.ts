import { describe, expect, it } from 'vitest';
import { MapFeatureCollection, NetworkFeature } from './index.js';
import { FeatureSearchResult, FeatureSearchResults } from './index.js';

const point = {
  type: 'Feature',
  id: 'node-1',
  geometry: { type: 'Point', coordinates: [105.8, 21.02] },
  properties: { kind: 'node', name: 'N1', status: 'active' },
};

describe('map-features contract', () => {
  it('parses a valid network feature', () => {
    const parsed = NetworkFeature.parse(point);
    expect(parsed.properties.kind).toBe('node');
  });

  it('parses a feature collection', () => {
    const fc = { type: 'FeatureCollection', features: [point] };
    expect(MapFeatureCollection.parse(fc).features).toHaveLength(1);
  });

  it('rejects an unknown kind', () => {
    const bad = { ...point, properties: { kind: 'spaceship' } };
    expect(() => NetworkFeature.parse(bad)).toThrow();
  });

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
});

describe('feature-search contract', () => {
  const hit = {
    id: 'feat-1',
    name: 'Valve 1',
    kind: 'node',
    bbox: [105.8, 21.0, 105.81, 21.01],
  };

  it('parses a search result', () => {
    expect(FeatureSearchResult.parse(hit).kind).toBe('node');
  });

  it('parses a results envelope', () => {
    expect(FeatureSearchResults.parse({ results: [hit] }).results).toHaveLength(1);
  });

  it('rejects a bbox that is not a 4-tuple', () => {
    expect(() => FeatureSearchResult.parse({ ...hit, bbox: [1, 2, 3] })).toThrow();
  });
});
