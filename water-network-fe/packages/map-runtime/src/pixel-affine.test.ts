import { describe, expect, it } from 'vitest';
import { pxToLonLat, pxBboxToExtent, lonLatToPx, lonToPx, latToPx, LON0, LAT0 } from './pixel-affine.js';

describe('pixel-affine', () => {
  it('maps pixel origin to the anchor lon/lat', () => {
    const [lon, lat] = pxToLonLat(0, 0);
    expect(lon).toBeCloseTo(LON0, 6);
    expect(lat).toBeCloseTo(LAT0, 6);
  });

  it('increases longitude with x and decreases latitude with y', () => {
    const [lon] = pxToLonLat(1000, 0);
    const [, lat] = pxToLonLat(0, 1000);
    expect(lon).toBeGreaterThan(LON0);
    expect(lat).toBeLessThan(LAT0);
  });

  it('produces a sorted [minLon,minLat,maxLon,maxLat] extent from a pixel bbox', () => {
    const [minLon, minLat, maxLon, maxLat] = pxBboxToExtent({ x: 100, y: 100, w: 200, h: 200 });
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
  });

  it('lonLatToPx maps the anchor lon/lat back to the pixel origin', () => {
    const [x, y] = lonLatToPx(LON0, LAT0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('round-trips pxToLonLat ∘ lonLatToPx to the identity', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1234, 567],
      [-800, 2200],
      [42, -99],
    ];
    for (const [px, py] of cases) {
      const [lon, lat] = pxToLonLat(px, py);
      const [x, y] = lonLatToPx(lon, lat);
      expect(x).toBeCloseTo(px, 6);
      expect(y).toBeCloseTo(py, 6);
    }
  });

  it('exposes single-axis inverses consistent with lonLatToPx', () => {
    const [lon, lat] = pxToLonLat(300, 400);
    expect(lonToPx(lon)).toBeCloseTo(300, 6);
    expect(latToPx(lat)).toBeCloseTo(400, 6);
  });
});
