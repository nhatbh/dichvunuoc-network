import { describe, expect, it } from 'vitest';
import { closestOnSegment, densifyLine, formatLength, haversineM, lineLengthM, lineMidpoint, ringCentroid, segmentIntersectsRect } from './geo-math.js';

describe('geo-math', () => {
  it('haversine ≈ 111 km per degree of latitude', () => {
    expect(haversineM([105, 21], [105, 22])).toBeGreaterThan(110_500);
    expect(haversineM([105, 21], [105, 22])).toBeLessThan(111_700);
  });
  it('lineLengthM sums segments', () => {
    const l = lineLengthM([[105, 21], [105, 21.001], [105.001, 21.001]]);
    expect(l).toBeGreaterThan(190);
    expect(l).toBeLessThan(220);
  });
  it('formats lengths like the 2D engine', () => {
    expect(formatLength(12.4)).toBe('12 m');
    expect(formatLength(1234)).toBe('1.23 km');
  });
  it('closestOnSegment clamps to the ends', () => {
    expect(closestOnSegment([5, 5], [0, 0], [10, 0])).toEqual({ point: [5, 0], t: 0.5 });
    expect(closestOnSegment([-5, 3], [0, 0], [10, 0]).point).toEqual([0, 0]);
    expect(closestOnSegment([1, 1], [2, 2], [2, 2]).point).toEqual([2, 2]);
  });
  it('clips segments against a rect', () => {
    const r = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segmentIntersectsRect([-5, 5], [15, 5], r)).toBe(true);
    expect(segmentIntersectsRect([-5, -5], [-1, 20], r)).toBe(false);
    expect(segmentIntersectsRect([2, 2], [3, 3], r)).toBe(true);
    expect(segmentIntersectsRect([12, 0], [12, 10], r)).toBe(false);
  });
  it('finds a line midpoint and a ring centroid', () => {
    const mid = lineMidpoint([[0, 0], [0, 2]])!;
    expect(mid[1]).toBeCloseTo(1, 6);
    const c = ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])!;
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[1]).toBeCloseTo(1, 6);
  });
  it('densifies long segments but keeps endpoints', () => {
    const out = densifyLine([[105, 21], [105, 21.01]], 100);
    expect(out.length).toBeGreaterThan(10);
    expect(out[0]).toEqual([105, 21]);
    expect(out.at(-1)).toEqual([105, 21.01]);
  });
});
