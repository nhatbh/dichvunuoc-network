import type { Coordinate, SnapModes } from '@wn/map-runtime';
import type { MapHost } from '../port/map-host.js';
import { closestOnSegment, pxDist, type Px } from './geo-math.js';
import { geometryLines, geometryPoints, type LayerStore, type StoredFeature } from './layer-store.js';

export const SNAP_TOLERANCE_PX = 10;

export interface SnapResult {
  coordinate: Coordinate;
  kind: 'vertex' | 'edge';
}

export interface SnapOptions {
  /** Skip this feature id (e.g. the one being edited). */
  excludeId?: string;
  /** Only consider this layer. */
  onlyLayer?: string;
  tolerancePx?: number;
}

/**
 * OSNAP in screen space (so it behaves identically top-down and tilted):
 * nodes / vertices snap to the closest geometry vertex, edges to the closest point
 * on a segment. Vertices win over edges when both are within tolerance, like the
 * 2D engine's `ol/interaction/Snap`.
 */
export function snapToFeatures(host: MapHost, store: LayerStore, modes: SnapModes, px: Px, opts: SnapOptions = {}): SnapResult | null {
  const wantVertex = modes.node || modes.vertex;
  const wantEdge = modes.edge;
  if (!wantVertex && !wantEdge) return null;
  const tol = opts.tolerancePx ?? SNAP_TOLERANCE_PX;
  // lon/lat window that certainly contains the tolerance square (also when tilted)
  const corners = [
    host.unproject([px[0] - tol, px[1] - tol]),
    host.unproject([px[0] + tol, px[1] - tol]),
    host.unproject([px[0] - tol, px[1] + tol]),
    host.unproject([px[0] + tol, px[1] + tol]),
  ];
  const minLon = Math.min(...corners.map((c) => c.lon));
  const maxLon = Math.max(...corners.map((c) => c.lon));
  const minLat = Math.min(...corners.map((c) => c.lat));
  const maxLat = Math.max(...corners.map((c) => c.lat));

  let bestVertex: { d: number; c: Coordinate } | null = null;
  let bestEdge: { d: number; c: Coordinate } | null = null;
  const consider = (feature: StoredFeature) => {
    if (opts.excludeId && feature.id === opts.excludeId) return;
    if (opts.onlyLayer && feature.layerId !== opts.onlyLayer) return;
    const [bx0, by0, bx1, by1] = feature.bbox;
    if (bx1 < minLon || bx0 > maxLon || by1 < minLat || by0 > maxLat) return;
    const g = store.displayedGeometry(feature.layerId, feature.id) ?? feature.feature.geometry;
    for (const p of geometryPoints(g)) {
      if (!wantVertex) break;
      const pp = host.project({ lon: p[0]!, lat: p[1]! });
      const d = pxDist(px, pp);
      if (d <= tol && (!bestVertex || d < bestVertex.d)) bestVertex = { d, c: { lon: p[0]!, lat: p[1]! } };
    }
    for (const line of geometryLines(g)) {
      let prev: Px | null = null;
      for (let i = 0; i < line.length; i++) {
        const p = line[i]!;
        const pp = host.project({ lon: p[0]!, lat: p[1]! });
        if (wantVertex) {
          const d = pxDist(px, pp);
          if (d <= tol && (!bestVertex || d < bestVertex.d)) bestVertex = { d, c: { lon: p[0]!, lat: p[1]! } };
        }
        if (wantEdge && prev) {
          const hit = closestOnSegment(px, prev, pp);
          const d = pxDist(px, hit.point);
          if (d <= tol && (!bestEdge || d < bestEdge.d)) {
            const a = line[i - 1]!;
            const t = hit.t;
            bestEdge = { d, c: { lon: a[0]! + (p[0]! - a[0]!) * t, lat: a[1]! + (p[1]! - a[1]!) * t } };
          }
        }
        prev = pp;
      }
    }
  };
  for (const f of store.visibleFeatures()) consider(f);
  if (bestVertex) return { coordinate: (bestVertex as { c: Coordinate }).c, kind: 'vertex' };
  if (bestEdge) return { coordinate: (bestEdge as { c: Coordinate }).c, kind: 'edge' };
  return null;
}
