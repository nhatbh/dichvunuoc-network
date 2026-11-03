import type { Coordinate } from '@wn/map-runtime';

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function lineLengthM(coords: ReadonlyArray<readonly number[]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM([coords[i - 1]![0]!, coords[i - 1]![1]!], [coords[i]![0]!, coords[i]![1]!]);
  return total;
}

/** "123 m" / "1.23 km" — the same formatting the 2D engine uses for its draw measure. */
export const formatLength = (m: number): string => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');

export type Px = [number, number];

export const pxDist = (a: Px, b: Px): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Closest point to `p` on segment a–b (all in the same planar space) and its parameter t∈[0,1]. */
export function closestOnSegment(p: Px, a: Px, b: Px): { point: Px; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { point: [a[0] + t * dx, a[1] + t * dy], t };
}

/** Does segment a–b intersect the axis-aligned rectangle? (Liang–Barsky clip.) */
export function segmentIntersectsRect(a: Px, b: Px, rect: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - rect.minX, rect.maxX - a[0], a[1] - rect.minY, rect.maxY - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return false;
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export const pointInRect = (p: Px, r: { minX: number; minY: number; maxX: number; maxY: number }): boolean =>
  p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;

/** Point at half the length of a polyline (for line labels), in lon/lat. */
export function lineMidpoint(coords: ReadonlyArray<readonly number[]>): [number, number] | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return [coords[0]![0]!, coords[0]![1]!];
  const total = lineLengthM(coords);
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const a: [number, number] = [coords[i - 1]![0]!, coords[i - 1]![1]!];
    const b: [number, number] = [coords[i]![0]!, coords[i]![1]!];
    const seg = haversineM(a, b);
    if (walked + seg >= total / 2 && seg > 0) {
      const t = (total / 2 - walked) / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += seg;
  }
  const last = coords[coords.length - 1]!;
  return [last[0]!, last[1]!];
}

/** Area-weighted centroid of the outer ring (falls back to the vertex mean for degenerate rings). */
export function ringCentroid(ring: ReadonlyArray<readonly number[]>): [number, number] | null {
  if (ring.length === 0) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
    a += f;
    cx += (ring[j]![0]! + ring[i]![0]!) * f;
    cy += (ring[j]![1]! + ring[i]![1]!) * f;
  }
  if (Math.abs(a) < 1e-14) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0]!, 0) / n, ring.reduce((s, p) => s + p[1]!, 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Resample a polyline so no segment is longer than `maxM` metres (used to drape lines on terrain). */
export function densifyLine(coords: ReadonlyArray<readonly number[]>, maxM: number): number[][] {
  if (coords.length < 2) return coords.map((c) => [...c]);
  const out: number[][] = [[...coords[0]!]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const seg = haversineM([a[0]!, a[1]!], [b[0]!, b[1]!]);
    const n = Math.max(1, Math.ceil(seg / maxM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t]);
    }
  }
  return out;
}

export const coord = (c: readonly number[]): Coordinate => ({ lon: c[0] ?? 0, lat: c[1] ?? 0 });
