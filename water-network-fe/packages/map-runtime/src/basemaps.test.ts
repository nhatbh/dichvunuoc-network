import { describe, expect, it } from 'vitest';
import { BASEMAPS } from './basemaps.js';

describe('BASEMAPS catalog', () => {
  it('lists the five basemaps with labels', () => {
    expect([...BASEMAPS.map((b) => b.id)].sort()).toEqual(
      ['carto-dark', 'carto-light', 'none', 'osm', 'satellite'].sort(),
    );
    expect(BASEMAPS.every((b) => b.label.length > 0)).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
  });
});
