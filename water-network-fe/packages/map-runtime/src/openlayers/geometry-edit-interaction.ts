import type OLMap from 'ol/Map';
import Feature from 'ol/Feature';
import Interaction from 'ol/interaction/Interaction';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import type OlGeometry from 'ol/geom/Geometry';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle, Fill, RegularShape, Stroke, Style } from 'ol/style';
import { unByKey } from 'ol/Observable';
import type { Geometry } from 'geojson';
import { normalizeLine, toGeoPoint, toMapPoint, translateSegment, type LinePoint } from '../geometry/line-edit.js';
import type { GeometryEditTarget, GeometryEditComplete, GeometryVertexSelection, SnapModes } from '../port/types.js';

export interface GeometryEditInteractionOptions {
  map: OLMap;
  feature: Feature;
  target: GeometryEditTarget;
  snapModes: () => SnapModes;
  /** Only asset features, never handles. The edited feature/id is excluded defensively. */
  snapFeatures: () => Feature[];
  onComplete: (event: GeometryEditComplete) => void;
  onVertexSelect: (selection: GeometryVertexSelection | null) => void;
}
export interface GeometryEditController {
  cancel(): void;
  deleteSelectedVertex(): void;
  destroy(): void;
}
type Handle = { kind: 'vertex' | 'mid'; index: number; coordinate: LinePoint };
type Gesture = { original: OlGeometry; working: LinePoint[]; handle: Handle; start: LinePoint; inserted: boolean };
const point = (p: number[]): LinePoint => [p[0]!, p[1]!];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One snapshot transaction, with preview confined to the supplied feature. OL never crosses the port. */
export function createGeometryEditInteraction(options: GeometryEditInteractionOptions): GeometryEditController {
  const { map, feature, onComplete, onVertexSelect } = options;
  const target = { ...options.target, lockedEndpointIndices: [...options.target.lockedEndpointIndices] };
  const initialGeometry = feature.getGeometry();
  const initialLast = initialGeometry instanceof LineString ? initialGeometry.getCoordinates().length - 1 : 0;
  const locksStart = target.lockedEndpointIndices.includes(0);
  const locksEnd = target.lockedEndpointIndices.includes(initialLast);
  const locked = (index: number) => {
    const geometry = feature.getGeometry();
    const last = geometry instanceof LineString ? geometry.getCoordinates().length - 1 : 0;
    return (index === 0 && locksStart) || (index === last && locksEnd);
  };
  const source = new VectorSource();
  const handlesLayer = new VectorLayer({ source, zIndex: 1000 });
  // Also marked for consumers that hit-test arbitrary map layers.
  handlesLayer.set('geometryEditHandles', true);
  let handles: Handle[] = [], selected: number | null = null, gesture: Gesture | null = null;
  let destroyed = false, internalChange = false, capturedPointer = false;
  const select = (index: number | null) => {
    selected = index;
    onVertexSelect(index === null ? null : { featureId: target.featureId, vertexIndex: index });
  };
  const write = (geometry: OlGeometry) => {
    internalChange = true;
    try { feature.setGeometry(geometry); } finally { internalChange = false; }
    refresh();
  };
  function refresh() {
    source.clear(); handles = [];
    const geometry = feature.getGeometry();
    const coordinates = geometry instanceof Point ? [point(geometry.getCoordinates())] : geometry instanceof LineString ? geometry.getCoordinates().map(point) : [];
    if (geometry instanceof Point && target.mode === 'segment') return;
    coordinates.forEach((coordinate, index) => {
      if (target.mode === 'vertex') handles.push({ kind: 'vertex', index, coordinate });
      if (index < coordinates.length - 1) {
        const end = coordinates[index + 1]!;
        handles.push({ kind: 'mid', index, coordinate: [(coordinate[0] + end[0]) / 2, (coordinate[1] + end[1]) / 2] });
      }
    });
    for (const handle of handles) {
      const isLocked = handle.kind === 'vertex' && locked(handle.index);
      const fill = new Fill({ color: isLocked ? '#94a3b8' : '#fff' });
      const stroke = new Stroke({ color: '#0e7c86', width: 2 });
      const image = target.mode === 'segment' ? new RegularShape({ points: 4, radius: 6, angle: Math.PI / 4, fill, stroke }) : new Circle({ radius: handle.kind === 'mid' ? 4 : 6, fill, stroke });
      const handleFeature = new Feature(new Point(handle.coordinate));
      handleFeature.setStyle(new Style({ image })); source.addFeature(handleFeature);
    }
  }
  function cancel() {
    const previous = gesture; gesture = null;
    if (previous) write(previous.original);
    select(null);
  }
  function snapped(coordinate: LinePoint): LinePoint {
    const { node, vertex, edge } = options.snapModes();
    if (!node && !vertex && !edge) return coordinate;
    const pixel = map.getPixelFromCoordinate(coordinate);
    let closest = coordinate, distance = 10;
    const consider = (candidate: number[]) => {
      const p = map.getPixelFromCoordinate(candidate);
      const d = Math.hypot(p[0]! - pixel[0]!, p[1]! - pixel[1]!);
      if (d <= distance) { distance = d; closest = point(candidate); }
    };
    for (const candidate of options.snapFeatures()) {
      if (candidate === feature || String(candidate.getId()) === target.featureId) continue;
      const geometry = candidate.getGeometry();
      if (geometry instanceof Point) { if (node || vertex) consider(geometry.getCoordinates()); }
      else if (geometry instanceof LineString) {
        if (vertex || node) geometry.getCoordinates().forEach(consider);
        if (edge) consider(geometry.getClosestPoint(coordinate));
      }
    }
    return closest;
  }
  function geometryFrom(coordinates: LinePoint[], isPoint: boolean): OlGeometry {
    if (!coordinates.flat().every(Number.isFinite)) throw new Error('Non-finite coordinates.');
    if (isPoint) { toGeoPoint(coordinates[0]!); return new Point(coordinates[0]!); }
    const geographic = coordinates.map(toGeoPoint);
    const normalized = normalizeLine(geographic);
    // normalizeLine retains input point objects. Resolve those retained members
    // back to their exact map coordinates, including locked outside endpoints.
    return new LineString(normalized.map((p) => coordinates[geographic.indexOf(p)]!));
  }
  function complete(original: OlGeometry) {
    const geometry = feature.getGeometry();
    if (!(geometry instanceof Point || geometry instanceof LineString)) return;
    const before = original instanceof Point ? original.getCoordinates() : (original as LineString).getCoordinates();
    const after = geometry.getCoordinates();
    if (same(before, after)) return;
    const geojson: Geometry = geometry instanceof Point
      ? { type: 'Point', coordinates: toGeoPoint(point(geometry.getCoordinates())) }
      : { type: 'LineString', coordinates: geometry.getCoordinates().map((p) => toGeoPoint(point(p))) };
    onComplete({ featureId: target.featureId, geometry: geojson, gestureKey: target.gestureKey });
  }
  function preview(coordinate: LinePoint) {
    if (!gesture) return;
    const { original, working, handle, start, inserted } = gesture;
    // Hit tolerance allows an off-center selection click. Only actual pointer
    // displacement can move a vertex/Point or invoke snapping.
    if (same(coordinate, start)) {
      if (!inserted) { write(original.clone()); return; }
      coordinate = handle.coordinate;
    }
    try {
      let next: LinePoint[];
      if (target.mode === 'segment') {
        const anchor: LinePoint = [handle.coordinate[0] + coordinate[0] - start[0], handle.coordinate[1] + coordinate[1] - start[1]];
        const dest = snapped(anchor);
        const delta: LinePoint = [dest[0] - handle.coordinate[0], dest[1] - handle.coordinate[1]];
        if (delta[0] === 0 && delta[1] === 0) { write(original.clone()); return; }
        next = translateSegment(working.map(toGeoPoint), handle.index, delta).map(toMapPoint);
        // Conversion round-off must never displace the fixed outside endpoints.
        next[0] = working[0]!; next[next.length - 1] = working.at(-1)!;
      } else {
        next = working.map((p) => [...p] as LinePoint);
        next[handle.index] = snapped(coordinate);
      }
      const nextGeometry = geometryFrom(next, original instanceof Point);
      // Normalization can remove the dragged coordinate or its neighbor. The
      // old index must never remain a deletion target for a different vertex.
      if (target.mode === 'vertex' && nextGeometry instanceof LineString && nextGeometry.getCoordinates().length !== next.length)
        select(null);
      write(nextGeometry);
    } catch { write(original.clone()); }
  }
  function deleteSelectedVertex() {
      if (destroyed || gesture || selected === null || target.mode !== 'vertex') return;
      const geometry = feature.getGeometry();
      if (!(geometry instanceof LineString)) return;
      const coordinates = geometry.getCoordinates().map(point), index = selected;
      if (index <= 0 || index >= coordinates.length - 1 || coordinates.length <= 2 || locked(index)) return;
      coordinates.splice(index, 1);
      try {
        const next = geometryFrom(coordinates, false), original = geometry.clone();
        write(next); select(null); complete(original);
      } catch { /* Failed deletion preserves geometry and selection. */ }
    }
  const interaction = new Interaction({ handleEvent: (event) => {
    if (destroyed) return true;
    if (event.type === 'pointercancel' || event.originalEvent.type === 'pointercancel') { cancel(); capturedPointer = false; event.preventDefault(); return false; }
    if (event.type === 'pointerdown') {
      if ((event.originalEvent as MouseEvent).button !== 0) return true;
      if (gesture) cancel();
      const ordered = [...handles].sort((a, b) => Number(a.kind === 'mid') - Number(b.kind === 'mid'));
      const hit = ordered.find((h) => { const p = map.getPixelFromCoordinate(h.coordinate); return Math.hypot(p[0]! - event.pixel[0]!, p[1]! - event.pixel[1]!) <= 10; });
      if (!hit) { select(null); return true; }
      capturedPointer = true;
      if (target.mode === 'vertex' && (event.originalEvent as MouseEvent).altKey) {
        event.preventDefault();
        if (hit.kind === 'vertex') { select(hit.index); deleteSelectedVertex(); }
        return false;
      }
      if (hit.kind === 'vertex' && locked(hit.index)) { select(null); return false; }
      const geometry = feature.getGeometry();
      if (!(geometry instanceof Point || geometry instanceof LineString)) return true;
      const working = geometry instanceof Point ? [point(geometry.getCoordinates())] : geometry.getCoordinates().map(point);
      const inserted = hit.kind === 'mid' && target.mode === 'vertex';
      const handle = { ...hit };
      if (inserted) { working.splice(hit.index + 1, 0, hit.coordinate); handle.index++; handle.kind = 'vertex'; }
      gesture = { original: geometry.clone(), working, handle, start: point(event.coordinate), inserted };
      select(target.mode === 'vertex' && !inserted ? handle.index : null);
      if (inserted) preview(hit.coordinate);
      return false;
    }
    if (gesture && event.type === 'pointerdrag') { preview(point(event.coordinate)); return false; }
    if (gesture && event.type === 'pointerup') {
      capturedPointer = false; event.preventDefault();
      const previous = gesture;
      preview(point(event.coordinate)); gesture = null;
      if (previous.inserted || target.mode === 'segment') select(null);
      complete(previous.original); return false;
    }
    if (capturedPointer && event.type === 'pointerdrag') return false;
    if (capturedPointer && event.type === 'pointerup') { capturedPointer = false; event.preventDefault(); return false; }
    return true;
  } });
  // Newer ol typings declare getViewport() as possibly undefined; accept both.
  const viewport = map.getViewport() as HTMLElement | undefined;
  const ownerDocument = viewport?.ownerDocument ?? document;
  const escape = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === 'Escape') cancel();
  };
  const pointercancel = () => cancel();
  ownerDocument.addEventListener('keydown', escape);
  viewport?.addEventListener('pointercancel', pointercancel);
  const changeKey = feature.on('change', () => {
    if (internalChange) return;
    // An authoritative geometry replacement supersedes the preview snapshot.
    gesture = null; select(null); refresh();
  });
  map.addLayer(handlesLayer); map.addInteraction(interaction); refresh(); select(null);
  return {
    cancel,
    deleteSelectedVertex,
    destroy() {
      if (destroyed) return;
      cancel(); destroyed = true;
      unByKey(changeKey);
      ownerDocument.removeEventListener('keydown', escape);
      viewport?.removeEventListener('pointercancel', pointercancel);
      map.removeInteraction(interaction); map.removeLayer(handlesLayer); source.clear();
    },
  };
}
