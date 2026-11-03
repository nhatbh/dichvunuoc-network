import type { HostPointerEvent } from '../../port/map-host.js';
import { emptyPrepared, type PreparedLayer } from '../../layers/prepare-layer.js';
import { pointInRect, segmentIntersectsRect, type Px } from '../geo-math.js';
import { geometryLines, geometryPoints, type LayerStore } from '../layer-store.js';
import { isEditableTarget, type Interaction, type InteractionContext } from '../interaction.js';

const MIN_DRAG_PX = 4;

/** All feature ids (across visible layers) that touch the screen rectangle. */
export function featuresInRect(ctx: Pick<InteractionContext, 'host'> & { store: LayerStore }, a: Px, b: Px): string[] {
  const rect = { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
  const ids = new Set<string>();
  for (const f of ctx.store.visibleFeatures()) {
    const g = ctx.store.displayedGeometry(f.layerId, f.id) ?? f.feature.geometry;
    if (geometryPoints(g).some((p) => pointInRect(ctx.host.project({ lon: p[0]!, lat: p[1]! }), rect))) {
      ids.add(f.id);
      continue;
    }
    for (const line of geometryLines(g)) {
      let prev: Px | null = null;
      let hit = false;
      for (const p of line) {
        const pp = ctx.host.project({ lon: p[0]!, lat: p[1]! });
        if (prev && segmentIntersectsRect(prev, pp, rect)) {
          hit = true;
          break;
        }
        if (!prev && pointInRect(pp, rect)) {
          hit = true;
          break;
        }
        prev = pp;
      }
      if (hit) {
        ids.add(f.id);
        break;
      }
    }
  }
  return [...ids];
}

/** Rubber-band selection: a drag draws a rectangle and reports every intersecting feature. */
export function createBoxSelectInteraction(ctx: InteractionContext, onBox: (ids: string[]) => void): Interaction {
  const { host } = ctx;
  let start: Px | null = null;
  let current: Px | null = null;
  host.setDragPan(false);
  host.setCursor('crosshair');
  return {
    onPointer(e: HostPointerEvent): boolean {
      if (e.type === 'down' && e.button === 0) {
        start = e.px;
        current = e.px;
        return true;
      }
      if (e.type === 'move' && start) {
        current = e.px;
        ctx.requestRender();
        return true;
      }
      if (e.type === 'up' && start) {
        const s = start;
        const end = e.px;
        start = null;
        current = null;
        ctx.requestRender();
        if (Math.hypot(end[0] - s[0], end[1] - s[1]) >= MIN_DRAG_PX) {
          ctx.suppressClick();
          onBox(featuresInRect(ctx, s, end));
        }
        return true;
      }
      return false;
    },
    onKey(e: KeyboardEvent): boolean {
      if (e.key === 'Escape' && start && !isEditableTarget(e)) {
        start = null;
        current = null;
        ctx.requestRender();
        return true;
      }
      return false;
    },
    overlay(): PreparedLayer {
      const out = emptyPrepared();
      if (!start || !current) return out;
      const corners: Px[] = [start, [current[0], start[1]], current, [start[0], current[1]]];
      const ring = corners.map((p) => {
        const c = host.unproject(p);
        return [c.lon, c.lat, 0] as [number, number, number];
      });
      out.polygons.push({ fid: '', polygon: [[...ring, ring[0]!]], fill: [14, 124, 134, 30], height: 0 });
      out.lines.push({ fid: '', path: [...ring, ring[0]!], color: [14, 124, 134, 255], width: 1.5, dash: [5, 4] });
      return out;
    },
    destroy() {
      host.setDragPan(true);
      host.setCursor(null);
    },
  };
}
