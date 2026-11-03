import { describe, expect, it } from 'vitest';
import { MapFeatureCollection } from '../map-features/index.js';
import { aMapFeatureCollection } from './index.js';
import { aFeatureSearchResults } from './index.js';
import { FeatureSearchResults } from '../map-features/index.js';

describe('aMapFeatureCollection builder', () => {
  it('produces a valid, parseable collection by default', () => {
    const fc = aMapFeatureCollection();
    expect(() => MapFeatureCollection.parse(fc)).not.toThrow();
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('honours a requested feature count', () => {
    expect(aMapFeatureCollection({ count: 5 }).features).toHaveLength(5);
  });
});

describe('aFeatureSearchResults builder', () => {
  it('produces parseable results carrying the query term in names', () => {
    const built = aFeatureSearchResults({ q: 'valve', count: 2 });
    expect(FeatureSearchResults.parse(built).results).toHaveLength(2);
    expect(built.results[0]!.name.toLowerCase()).toContain('valve');
  });
});
