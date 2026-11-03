import type { Geometry } from 'geojson';
import type { GeometryEditComplete, GeometryEditTarget, GeometryVertexSelection, ImageSpec } from '@wn/map-runtime';
import { normalizeLine, toGeoPoint, toMapPoint, translateSegment, type LinePoint } from '@wn/map-runtime';
import type { HostPointerEvent } from '../../port/map-host.js';
import { emptyPrepared, type PreparedLayer } from '../../layers/prepare-layer.js';
import { pxDist } from '../geo-math.js';
import { isEditableTarget, type Interaction, type InteractionContext } from '../interaction.js';
import { pushDot } from '../overlay.js';
import { snapToFeatures } from '../snap.js';

export const HANDLE_HIT_PX = 10;
const DRAFT = 'draft';

export interface GeometryEditController extends Interaction {
  cancel(): void;
  deleteSelectedVertex(): void;
}

export interface GeometryEditOptions {
  target: GeometryEditTarget;
  onComplete: (event: GeometryEditComplete) => void;
  onVertexSelect: (selection: GeometryVertexSelection | null) => void;
}

type Handle = { kind: 'vertex' | 'mid'; index: number; coordinate: LinePoint };
/** Geometry as plain EPSG:3857 coordinates; `point` distinguishes Point from LineString. */
type Shape = { point: boolean; coords: LinePoint[] };
type Gesture = { original: Shape; working: LinePoint[]; handle: Handle; start: LinePoint; inserted: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = (s: Shape): Shape => ({ point: s.point, coords: s.coords.map((p) => [p[0], p[1]] as LinePoint) });

function readShape(g: Geometry | undefined): Shape | null {
  if (!g) return null;
  if (g.type === 'Point') return { point: true, coords: [toMapPoint([g.coordinates[0]!, g.coordinates[1]!])] };
  if (g.type === 'LineString') return { point: false, coords: g.coordinates.map((c) => toMapPoint([c[0]!, c[1]!])) };
  return null;
}

function writeShape(shape: Shape): Geometry {
  return shape.point
    ? { type: 'Point', coordinates: toGeoPoint(shape.coords[0]!) }
    : { type: 'LineString', coordinates: shape.coords.map((p) => toGeoPoint(p)) };
}

/**
 * Scoped, single-feature geometry editor for the 'draft' layer (ADR 0014). A port of the
 * OpenLayers controller: one snapshot transaction per gesture, preview confined to the
 * target feature, hit tolerance 10 CSS px, vertex hits before midpoint hits, locked
 * endpoints, Esc / pointercancel / destroy restore the snapshot without completing.
 */
export function createGeometryEditController(ctx: InteractionContext, options: GeometryEditOptions): GeometryEditController {
  const { host, store } = ctx;
  const target: GeometryEditTarget = { ...options.target, lockedEndpointIndices: [...options.target.lockedEndpointIndices] };
  const featureIdStr = target.featureId;
  const initial = readShape(store.displayedGeometry(DRAFT, featureIdStr));
  const initialLast = initial && !initial.point ? initial.coords.length - 1 : 0;
  const locksStart = target.lockedEndpointIndices.includes(0);
  const locksEnd = target.lockedEndpointIndices.includes(initialLast);

  let handles: Handle[] = [];
  let selected: number | null = null;
  let gesture: Gesture | null = null;
  let destroyed = false;
  let captured = false;

  const current = (): Shape | null => readShape(store.displayedGeometry(DRAFT, featureIdStr));
  const lockedAt = (index: number): boolean => {
    const s = current();
    const last = s && !s.point ? s.coords.length - 1 : 0;
    return (index === 0 && locksStart) || (index === last && locksEnd);
  };
  const select = (index: number | null) => {
    selected = index;
    options.onVertexSelect(index === null ? null : { featureId: featureIdStr, vertexIndex: index });
  };
  const write = (shape: Shape) => {
    store.setPreview(DRAFT, featureIdStr, writeShape(shape));
    refresh();
  };
  const restore = (shape: Shape) => {
    // writing back the pre-gesture snapshot is a preview of the original; drop the override entirely
    store.setPreview(DRAFT, featureIdStr, null);
    void shape;
    refresh();
  };

  function refresh() {
    handles = [];
    const s = current();
    if (s && !(s.point && target.mode === 'segment')) {
      s.coords.forEach((coordinate, index) => {
        if (target.mode === 'vertex') handles.push({ kind: 'vertex', index, coordinate });
        if (index < s.coords.length - 1) {
          const end = s.coords[index + 1]!;
          handles.push({ kind: 'mid', index, coordinate: [(coordinate[0] + end[0]) / 2, (coordinate[1] + end[1]) / 2] });
        }
      });
    }
    ctx.requestRender();
  }

  const px = (c: LinePoint): [number, number] => host.project(pointToCoord(c));
  const snapAt = (coordinate: LinePoint): LinePoint => {
    const { node, vertex, edge } = ctx.snapModes();
    if (!node && !vertex && !edge) return coordinate;
    const hit = snapToFeatures(host, store, ctx.snapModes(), px(coordinate), { excludeId: featureIdStr });
    return hit ? toMapPoint([hit.coordinate.lon, hit.coordinate.lat]) : coordinate;
  };

  function shapeFrom(coordinates: LinePoint[], isPoint: boolean): Shape {
    if (!coordinates.flat().every(Number.isFinite)) throw new Error('Non-finite coordinates.');
    if (isPoint) {
      toGeoPoint(coordinates[0]!);
      return { point: true, coords: [coordinates[0]!] };
    }
    const geographic = coordinates.map(toGeoPoint);
    const normalized = normalizeLine(geographic);
    // normalizeLine retains input point objects; resolve them back to exact map coordinates.
    return { point: false, coords: normalized.map((p) => coordinates[geographic.indexOf(p)]!) };
  }

  function complete(original: Shape) {
    const now = current();
    if (!now) return;
    if (same(original.coords, now.coords)) return;
    options.onComplete({ featureId: featureIdStr, geometry: writeShape(now), gestureKey: target.gestureKey });
  }

  function preview(coordinate: LinePoint) {
    if (!gesture) return;
    const { original, working, handle, start, inserted } = gesture;
    // Hit tolerance allows an off-centre click; only real pointer displacement moves anything.
    if (same(coordinate, start)) {
      if (!inserted) {
        restore(original);
        return;
      }
      coordinate = handle.coordinate;
    }
    try {
      let next: LinePoint[];
      if (target.mode === 'segment') {
        const anchor: LinePoint = [handle.coordinate[0] + coordinate[0] - start[0], handle.coordinate[1] + coordinate[1] - start[1]];
        const dest = snapAt(anchor);
        const delta: LinePoint = [dest[0] - handle.coordinate[0], dest[1] - handle.coordinate[1]];
        if (delta[0] === 0 && delta[1] === 0) {
          restore(original);
          return;
        }
        next = translateSegment(working.map(toGeoPoint), handle.index, delta).map(toMapPoint);
        // conversion round-off must never displace the fixed outside endpoints
        next[0] = working[0]!;
        next[next.length - 1] = working.at(-1)!;
      } else {
        next = working.map((p) => [...p] as LinePoint);
        next[handle.index] = snapAt(coordinate);
      }
      const nextShape = shapeFrom(next, original.point);
      // normalisation can remove the dragged coordinate or its neighbour: the old index must not stay a deletion target
      if (target.mode === 'vertex' && !nextShape.point && nextShape.coords.length !== next.length) select(null);
      write(nextShape);
    } catch {
      restore(original);
    }
  }

  function deleteSelectedVertex() {
    if (destroyed || gesture || selected === null || target.mode !== 'vertex') return;
    const s = current();
    if (!s || s.point) return;
    const coordinates = s.coords.map((p) => [...p] as LinePoint);
    const index = selected;
    if (index <= 0 || index >= coordinates.length - 1 || coordinates.length <= 2 || lockedAt(index)) return;
    coordinates.splice(index, 1);
    try {
      const next = shapeFrom(coordinates, false);
      const original = clone(s);
      write(next);
      select(null);
      complete(original);
    } catch {
      /* failed deletion preserves geometry and selection */
    }
  }

  function cancel() {
    const previous = gesture;
    gesture = null;
    if (previous) restore(previous.original);
    select(null);
  }

  const eventCoordinate = (e: HostPointerEvent): LinePoint => toMapPoint([e.coordinate.lon, e.coordinate.lat]);

  refresh();
  select(null);

  return {
    cancel,
    deleteSelectedVertex,
    onPointer(e: HostPointerEvent): boolean {
      if (destroyed) return false;
      if (e.type === 'down') {
        if (e.button !== 0) return false;
        if (gesture) cancel();
        const ordered = [...handles].sort((a, b) => Number(a.kind === 'mid') - Number(b.kind === 'mid'));
        const hit = ordered.find((h) => pxDist(px(h.coordinate), e.px) <= HANDLE_HIT_PX);
        if (!hit) {
          select(null);
          return false;
        }
        captured = true;
        host.setDragPan(false);
        if (target.mode === 'vertex' && e.altKey) {
          if (hit.kind === 'vertex') {
            select(hit.index);
            deleteSelectedVertex();
          }
          return true;
        }
        if (hit.kind === 'vertex' && lockedAt(hit.index)) {
          select(null);
          return true;
        }
        const s = current();
        if (!s) return false;
        const working = s.coords.map((p) => [...p] as LinePoint);
        const inserted = hit.kind === 'mid' && target.mode === 'vertex';
        const handle: Handle = { ...hit };
        if (inserted) {
          working.splice(hit.index + 1, 0, hit.coordinate);
          handle.index++;
          handle.kind = 'vertex';
        }
        gesture = { original: clone(s), working, handle, start: eventCoordinate(e), inserted };
        select(target.mode === 'vertex' && !inserted ? handle.index : null);
        if (inserted) preview(hit.coordinate);
        return true;
      }
      if (e.type === 'move') {
        if (gesture) {
          preview(eventCoordinate(e));
          return true;
        }
        // hover: take the drag away from the map only while a handle is under the pointer
        const over = handles.some((h) => pxDist(px(h.coordinate), e.px) <= HANDLE_HIT_PX);
        host.setDragPan(!over);
        host.setCursor(over ? 'grab' : null);
        return false;
      }
      if (e.type === 'up') {
        host.setDragPan(true);
        if (gesture) {
          captured = false;
          const previous = gesture;
          preview(eventCoordinate(e));
          gesture = null;
          if (previous.inserted || target.mode === 'segment') select(null);
          complete(previous.original);
          return true;
        }
        if (captured) {
          captured = false;
          return true;
        }
      }
      return false;
    },
    onKey(e: KeyboardEvent): boolean {
      if (e.isComposing || e.keyCode === 229 || isEditableTarget(e)) return false;
      if (e.key === 'Escape') {
        cancel();
        return false; // other Escape handlers (tool exit, menus) still run
      }
      return false;
    },
    onMove() {
      ctx.requestRender();
    },
    overlay(): PreparedLayer {
      const out = emptyPrepared();
      for (const h of handles) {
        const isLocked = h.kind === 'vertex' && lockedAt(h.index);
        const im: ImageSpec = {
          shape: target.mode === 'segment' ? 'square' : 'circle',
          radius: target.mode === 'segment' ? 6 : h.kind === 'mid' ? 4 : 6,
          color: isLocked ? '#94a3b8' : '#ffffff',
          stroke: '#0e7c86',
          strokeWidth: 2,
        };
        pushDot(ctx, out, pointToCoord(h.coordinate), im, 0);
      }
      // selected vertex gets a ring so deletion targets are visible
      if (selected !== null) {
        const h = handles.find((x) => x.kind === 'vertex' && x.index === selected);
        if (h) {
          const c = pointToCoord(h.coordinate);
          out.pointHalos.push({ fid: '', position: [c.lon, c.lat, 0], radius: 10, color: [245, 158, 11, 255], width: 2 });
        }
      }
      return out;
    },
    destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
      host.setDragPan(true);
      host.setCursor(null);
      store.setPreview(DRAFT, featureIdStr, null);
      ctx.requestRender();
    },
  };
}

const pointToCoord = (p: LinePoint) => {
  const g = toGeoPoint(p);
  return { lon: g[0], lat: g[1] };
};
