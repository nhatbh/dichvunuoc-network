import { describe, expect, it } from 'vitest';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { createBasemapSource } from './basemaps.js';

describe('createBasemapSource', () => {
  it('builds an OSM source for "osm"', () => {
    expect(createBasemapSource('osm')).toBeInstanceOf(OSM);
  });
  it('builds an XYZ source for "carto-light"', () => {
    expect(createBasemapSource('carto-light')).toBeInstanceOf(XYZ);
  });
  it('builds an XYZ source for "carto-dark"', () => {
    expect(createBasemapSource('carto-dark')).toBeInstanceOf(XYZ);
  });
  it('builds an XYZ source for "satellite"', () => {
    expect(createBasemapSource('satellite')).toBeInstanceOf(XYZ);
  });
  it('returns null for "none"', () => {
    expect(createBasemapSource('none')).toBeNull();
  });
});
