import { vi } from 'vitest';
import type { Geometry } from 'geojson';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { GeometryEditTarget, GeometryEditComplete, GeometryVertexSelection, ContextMenuEvent, Coordinate, Viewport } from '../port/types.js';

/**
 * A test double for {@link MapEnginePort}. Every port method is a `vi.fn()`, so
 * `expect(port.foo).toHaveBeenCalled()` and `vi.mocked(port.foo).mock.calls`
 * work on any of them. View and selection round-trip through internal state;
 * the subscription methods are wired to the matching `emit*` helpers so a
 * test can drive a click / pointer-move / draw / modify / context-menu
 * (see `emitContextMenu`) without reaching into the port internals.
 *
 * This is the ONE place that knows the full port surface — when a method is
 * added to `MapEnginePort`, add its default here and every fake updates at once.
 */
export interface FakeMapEnginePort extends MapEnginePort {
  readonly geometryEditTarget: GeometryEditTarget | null;
  emitGeometryEditComplete(event: GeometryEditComplete): void;
  emitGeometryVertexSelect(selection: GeometryVertexSelection | null): void;
  /** Fire all `onFeatureClick` subscribers. */
  emitClick(featureId: string): void;
  /** Fire all `onPointerMove` subscribers (null = pointer left the map). */
  emitPointer(coordinate: Coordinate | null): void;
  /** Fire all `onDrawComplete` subscribers. */
  emitDraw(geometry: Geometry): void;
  /** Fire all `onModifyComplete` subscribers. */
  emitModify(featureId: string, geometry: Geometry): void;
  /** Fire all onFeaturePointPick subscribers. */
  emitFeaturePointPick(featureId: string, point: Coordinate): void;
  /** Fire all `onBoxSelect` subscribers. */
  emitBoxSelect(featureIds: string[]): void;
  /** Fire all `onContextMenu` subscribers. */
  emitContextMenu(event: ContextMenuEvent): void;
}

const DEFAULT_VIEW: Viewport = { center: { lon: 0, lat: 0 }, zoom: 1 };

/** Create a fully-stubbed {@link MapEnginePort} for tests. */
export function createFakePort(): FakeMapEnginePort {
  let view: Viewport = DEFAULT_VIEW;
  let selected: string | null = null;
  let geometryEditTarget: GeometryEditTarget | null = null;
  const geometrySubs = new Set<(e: GeometryEditComplete) => void>();
  const vertexSubs = new Set<(e: GeometryVertexSelection | null) => void>();
  const clickSubs = new Set<(id: string) => void>();
  const pointerSubs = new Set<(c: Coordinate | null) => void>();
  const drawSubs = new Set<(g: Geometry) => void>();
  const modifySubs = new Set<(id: string, g: Geometry) => void>();
  const pointPickSubs = new Set<(id: string, p: Coordinate) => void>();
  const boxSubs = new Set<(ids: string[]) => void>();
  const ctxMenuSubs = new Set<(e: ContextMenuEvent) => void>();

  return {
    get geometryEditTarget() { return geometryEditTarget; },
    setGeometryEditTarget: vi.fn((target: GeometryEditTarget | null) => {
      geometryEditTarget = target ? { ...target, lockedEndpointIndices: [...target.lockedEndpointIndices] } : null;
      vertexSubs.forEach((cb) => cb(null));
    }),
    onGeometryEditComplete: vi.fn((cb: (e: GeometryEditComplete) => void) => { geometrySubs.add(cb); return () => geometrySubs.delete(cb); }),
    onGeometryVertexSelect: vi.fn((cb: (e: GeometryVertexSelection | null) => void) => { vertexSubs.add(cb); return () => vertexSubs.delete(cb); }),
    deleteSelectedGeometryVertex: vi.fn(),
    emitGeometryEditComplete: (e) => geometrySubs.forEach((cb) => cb(e)),
    emitGeometryVertexSelect: (e) => vertexSubs.forEach((cb) => cb(e)),
    mount: vi.fn(),
    setView: vi.fn((v: Viewport) => {
      view = v;
    }),
    getView: vi.fn(() => view),
    setFeatures: vi.fn(),
    setLayerStyle: vi.fn(),
    setSelection: vi.fn((id: string | null) => {
      selected = id;
    }),
    getSelection: vi.fn(() => selected),
    onFeatureClick: vi.fn((cb: (id: string) => void) => {
      clickSubs.add(cb);
      return () => clickSubs.delete(cb);
    }),
    onPointerMove: vi.fn((cb: (c: Coordinate | null) => void) => {
      pointerSubs.add(cb);
      return () => pointerSubs.delete(cb);
    }),
    setLayerVisible: vi.fn(),
    setBasemap: vi.fn(),
    fitToBbox: vi.fn(),
    setDrawMode: vi.fn(),
    onDrawComplete: vi.fn((cb: (g: Geometry) => void) => {
      drawSubs.add(cb);
      return () => drawSubs.delete(cb);
    }),
    setModifyMode: vi.fn(),
    onModifyComplete: vi.fn((cb: (id: string, g: Geometry) => void) => {
      modifySubs.add(cb);
      return () => modifySubs.delete(cb);
    }),
    onContextMenu: vi.fn((cb: (e: ContextMenuEvent) => void) => {
      ctxMenuSubs.add(cb);
      return () => ctxMenuSubs.delete(cb);
    }),
    setFeaturePointMode: vi.fn(),
    onFeaturePointPick: vi.fn((cb: (id: string, p: Coordinate) => void) => {
      pointPickSubs.add(cb);
      return () => pointPickSubs.delete(cb);
    }),
    setBoxSelectMode: vi.fn(),
    onBoxSelect: vi.fn((cb: (ids: string[]) => void) => {
      boxSubs.add(cb);
      return () => boxSubs.delete(cb);
    }),
    setSnapModes: vi.fn(),
    setDrawConstraint: vi.fn(),
    setDrawMeasure: vi.fn(),
    destroy: vi.fn(),
    emitClick: (id) => clickSubs.forEach((cb) => cb(id)),
    emitPointer: (c) => pointerSubs.forEach((cb) => cb(c)),
    emitDraw: (g) => drawSubs.forEach((cb) => cb(g)),
    emitModify: (id, g) => modifySubs.forEach((cb) => cb(id, g)),
    emitFeaturePointPick: (id, point) => pointPickSubs.forEach((cb) => cb(id, point)),
    emitBoxSelect: (ids) => boxSubs.forEach((cb) => cb(ids)),
    emitContextMenu: (e) => ctxMenuSubs.forEach((cb) => cb(e)),
  };
}
