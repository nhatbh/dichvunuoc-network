import type { Geometry } from 'geojson';
import type { Coordinate, DrawConstraint, DrawGeometry } from '@wn/map-runtime';
import { toGeoPoint, toMapPoint } from '@wn/map-runtime';
import type { HostPointerEvent } from '../../port/map-host.js';
import type { PreparedLayer } from '../../layers/prepare-layer.js';
import { emptyPrepared } from '../../layers/prepare-layer.js';
import { formatLength, lineLengthM, pxDist } from '../geo-math.js';
import { TEAL, coordEq, isEditableTarget, type Interaction, type InteractionContext } from '../interaction.js';
import { snapToFeatures } from '../snap.js';
import { parseHex, pushDot } from '../overlay.js';

export interface DrawOptions {
  geometry: DrawGeometry;
  constraint: DrawConstraint;
  measure: boolean;
  onComplete: (geometry: Geometry) => void;
}

/** A click this close (px) to the last placed vertex finishes the line (also makes double-click finish). */
const FINISH_TOLERANCE_PX = 12;

/** Lock the segment prev→cursor to the nearest 45° (AutoCAD ORTHO) in EPSG:3857. */
export function orthoConstrain(prev: Coordinate, cursor: Coordinate): Coordinate {
  const a = toMapPoint([prev.lon, prev.lat]);
  const b = toMapPoint([cursor.lon, cursor.lat]);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return cursor;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const g = toGeoPoint([a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len]);
  return { lon: g[0], lat: g[1] };
}

/** Draw LineString / Point with OSNAP, ORTHO and a live length readout. */
export function createDrawInteraction(ctx: InteractionContext, opts: DrawOptions, getConstraint: () => DrawConstraint, getMeasure: () => boolean): Interaction {
  const coords: Coordinate[] = [];
  let cursor: Coordinate | null = null;
  let snapped = false;
  ctx.host.setDoubleClickZoom(false);
  ctx.host.setCursor('crosshair');

  const resolve = (px: [number, number]): Coordinate => {
    const snap = snapToFeatures(ctx.host, ctx.store, ctx.snapModes(), px);
    snapped = !!snap;
    let c = snap?.coordinate ?? ctx.host.unproject(px);
    if (opts.geometry === 'LineString' && getConstraint() === 'ortho' && coords.length > 0 && !snap) c = orthoConstrain(coords[coords.length - 1]!, c);
    return c;
  };

  const finish = () => {
    if (opts.geometry === 'LineString') {
      if (coords.length < 2) return;
      const done = coords.map((c) => [c.lon, c.lat]);
      coords.length = 0;
      cursor = null;
      ctx.requestRender();
      opts.onComplete({ type: 'LineString', coordinates: done });
    }
  };

  return {
    onPointer(e: HostPointerEvent) {
      if (e.type === 'move') {
        cursor = resolve(e.px);
        ctx.requestRender();
        return false;
      }
      if (e.type === 'leave') {
        cursor = null;
        ctx.requestRender();
        return false;
      }
      if (e.type === 'click' && e.button === 0) {
        const at = resolve(e.px);
        cursor = at;
        if (opts.geometry === 'Point') {
          opts.onComplete({ type: 'Point', coordinates: [at.lon, at.lat] });
          return true;
        }
        const last = coords[coords.length - 1];
        if (last && pxDist(e.px, ctx.host.project(last)) <= FINISH_TOLERANCE_PX) {
          finish();
          return true;
        }
        if (!last || !coordEq(last, at)) coords.push(at);
        ctx.requestRender();
        return true;
      }
      return false;
    },
    onKey(e: KeyboardEvent) {
      if (isEditableTarget(e) || e.isComposing) return false;
      if (e.key === 'Escape') {
        coords.length = 0;
        ctx.requestRender();
        return true;
      }
      if (e.key === 'Enter') {
        finish();
        return true;
      }
      if (e.key === 'Backspace' && coords.length > 0) {
        coords.pop();
        ctx.requestRender();
        return true;
      }
      return false;
    },
    overlay(): PreparedLayer {
      const out = emptyPrepared();
      const lineColor = getMeasure() ? TEAL : '#3399CC';
      const preview = cursor && opts.geometry === 'LineString' ? [...coords, cursor] : [...coords];
      if (preview.length >= 2) {
        out.lines.push({ fid: '', path: preview.map((c) => [c.lon, c.lat, 0]), color: parseHex(lineColor), width: 3 });
      }
      const dot = { shape: 'circle' as const, radius: 3, color: '#ffffff', stroke: lineColor, strokeWidth: 1.5 };
      for (const c of coords) pushDot(ctx, out, c, dot);
      if (cursor) {
        pushDot(ctx, out, cursor, snapped ? { shape: 'circle', radius: 6, color: 'rgba(255,255,255,0)', stroke: '#f59e0b', strokeWidth: 2 } : { shape: 'circle', radius: 4, color: lineColor, stroke: '#ffffff', strokeWidth: 1 });
      }
      if (getMeasure() && opts.geometry === 'LineString' && preview.length >= 2) {
        const last = preview[preview.length - 1]!;
        out.texts.push({
          fid: '',
          position: [last.lon, last.lat, 0],
          text: formatLength(lineLengthM(preview.map((c) => [c.lon, c.lat]))),
          color: parseHex(TEAL),
          size: 11,
          family: 'monospace',
          offsetY: -14,
          outline: [255, 255, 255, 255],
          outlineWidth: 3,
        });
      }
      return out;
    },
    destroy() {
      ctx.host.setDoubleClickZoom(true);
      ctx.host.setCursor(null);
      coords.length = 0;
      cursor = null;
    },
  };
}
