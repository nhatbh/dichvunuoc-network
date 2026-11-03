import type { Geometry, Position } from 'geojson';
import type { Coordinate, ImageSpec } from '@wn/map-runtime';
import type { HostPointerEvent } from '../../port/map-host.js';
import { emptyPrepared, type PreparedLayer } from '../../layers/prepare-layer.js';
import { closestOnSegment, pxDist } from '../geo-math.js';
import { isEditableTarget, type Interaction, type InteractionContext } from '../interaction.js';
import { pushDot } from '../overlay.js';
import { snapToFeatures } from '../snap.js';

const DRAFT = 'draft';
const TOLERANCE_PX = 10;

type Hover = { fid: string; kind: 'vertex' | 'edge'; index: number; coordinate: Coordinate };
type Drag = { fid: string; original: Geometry; working: Position[]; index: number; isPoint: boolean; moved: boolean };

const geojson = (isPoint: boolean, coords: Position[]): Geometry =>
  isPoint ? { type: 'Point', coordinates: coords[0]! } : { type: 'LineString', coordinates: coords };

/**
 * Legacy "modify" mode: every vertex of every 'draft' feature is draggable, dragging on
 * an edge inserts a vertex, Alt+click deletes a vertex (same gestures as `ol/interaction/Modify`).
 * Completion is reported per feature once the pointer is released.
 */
export function createModifyInteraction(ctx: InteractionContext, onModify: (id: string, g: Geometry) => void): Interaction {
  const { host, store } = ctx;
  let hover: Hover | null = null;
  let drag: Drag | null = null;

  const coordsOf = (g: Geometry): { isPoint: boolean; coords: Position[] } | null =>
    g.type === 'Point' ? { isPoint: true, coords: [g.coordinates] } : g.type === 'LineString' ? { isPoint: false, coords: g.coordinates } : null;

  function findHover(px: [number, number]): Hover | null {
    let best: (Hover & { d: number }) | null = null;
    for (const f of store.visibleFeatures()) {
      if (f.layerId !== DRAFT) continue;
      const g = store.displayedGeometry(DRAFT, f.id);
      const c = g && coordsOf(g);
      if (!c) continue;
      c.coords.forEach((p, i) => {
        const d = pxDist(px, host.project({ lon: p[0]!, lat: p[1]! }));
        if (d <= TOLERANCE_PX && (!best || best.kind === 'edge' || d < best.d)) best = { fid: f.id, kind: 'vertex', index: i, coordinate: { lon: p[0]!, lat: p[1]! }, d };
      });
      if (!c.isPoint) {
        for (let i = 0; i < c.coords.length - 1; i++) {
          const a = c.coords[i]!;
          const b = c.coords[i + 1]!;
          const hit = closestOnSegment(px, host.project({ lon: a[0]!, lat: a[1]! }), host.project({ lon: b[0]!, lat: b[1]! }));
          const d = pxDist(px, hit.point);
          if (d <= TOLERANCE_PX && !(best && (best as Hover).kind === 'vertex') && (!best || d < (best as { d: number }).d)) {
            best = { fid: f.id, kind: 'edge', index: i, coordinate: { lon: a[0]! + (b[0]! - a[0]!) * hit.t, lat: a[1]! + (b[1]! - a[1]!) * hit.t }, d };
          }
        }
      }
    }
    return best;
  }

  const finish = (d: Drag) => {
    onModify(d.fid, geojson(d.isPoint, d.working));
  };

  return {
    onPointer(e: HostPointerEvent): boolean {
      if (e.type === 'move') {
        if (drag) {
          const snap = snapToFeatures(host, store, ctx.snapModes(), e.px, { excludeId: drag.fid });
          const c = snap?.coordinate ?? e.coordinate;
          drag.working[drag.index] = [c.lon, c.lat];
          drag.moved = true;
          store.setPreview(DRAFT, drag.fid, geojson(drag.isPoint, drag.working));
          hover = { fid: drag.fid, kind: 'vertex', index: drag.index, coordinate: c };
          ctx.requestRender();
          return true;
        }
        hover = findHover(e.px);
        host.setDragPan(!hover);
        host.setCursor(hover ? 'grab' : null);
        ctx.requestRender();
        return false;
      }
      if (e.type === 'down' && e.button === 0) {
        hover = findHover(e.px);
        if (!hover) return false;
        const g = store.displayedGeometry(DRAFT, hover.fid);
        const c = g && coordsOf(g);
        if (!c) return false;
        host.setDragPan(false);
        const working = c.coords.map((p) => [...p] as Position);
        if (e.altKey && hover.kind === 'vertex') {
          if (!c.isPoint && working.length > 2) {
            working.splice(hover.index, 1);
            store.setPreview(DRAFT, hover.fid, geojson(false, working));
            onModify(hover.fid, geojson(false, working));
          }
          hover = null;
          ctx.requestRender();
          return true;
        }
        let index = hover.index;
        if (hover.kind === 'edge') {
          index = hover.index + 1;
          working.splice(index, 0, [hover.coordinate.lon, hover.coordinate.lat]);
        }
        drag = { fid: hover.fid, original: g!, working, index, isPoint: c.isPoint, moved: hover.kind === 'edge' };
        if (hover.kind === 'edge') store.setPreview(DRAFT, hover.fid, geojson(c.isPoint, working));
        return true;
      }
      if (e.type === 'up') {
        host.setDragPan(true);
        if (drag) {
          const d = drag;
          drag = null;
          if (d.moved) finish(d);
          ctx.requestRender();
          return true;
        }
      }
      if (e.type === 'leave') {
        hover = null;
        ctx.requestRender();
      }
      return false;
    },
    onKey(e: KeyboardEvent): boolean {
      if (e.key === 'Escape' && drag && !isEditableTarget(e)) {
        store.setPreview(DRAFT, drag.fid, null);
        drag = null;
        host.setDragPan(true);
        ctx.requestRender();
        return true;
      }
      return false;
    },
    overlay(): PreparedLayer {
      const out = emptyPrepared();
      if (hover) {
        const im: ImageSpec = { shape: 'circle', radius: 5, color: '#ffffff', stroke: '#0e7c86', strokeWidth: 2 };
        pushDot(ctx, out, hover.coordinate, im);
      }
      return out;
    },
    destroy() {
      if (drag) store.setPreview(DRAFT, drag.fid, null);
      drag = null;
      hover = null;
      host.setDragPan(true);
      host.setCursor(null);
    },
  };
}
