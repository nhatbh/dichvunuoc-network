import { describe, expect, it } from 'vitest';
import type { Geometry } from 'geojson';
import type { Coordinate } from './types.js';
import { createFakePort } from '../testing/fake-port.js';

describe('createFakePort', () => {
  it('round-trips the viewport', () => {
    const p = createFakePort();
    p.setView({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(p.getView().zoom).toBe(12);
  });

  it('reflects selection', () => {
    const p = createFakePort();
    p.setSelection('x');
    expect(p.getSelection()).toBe('x');
  });

  it('notifies + unsubscribes feature clicks', () => {
    const p = createFakePort();
    const seen: string[] = [];
    const off = p.onFeatureClick((id) => seen.push(id));
    p.emitClick('a'); off(); p.emitClick('b');
    expect(seen).toEqual(['a']);
  });

  it('notifies + unsubscribes pointer moves (null on leave)', () => {
    const p = createFakePort();
    const seen: (Coordinate | null)[] = [];
    const off = p.onPointerMove((c) => seen.push(c));
    p.emitPointer({ lon: 105.8, lat: 21 });
    p.emitPointer(null);
    off();
    p.emitPointer({ lon: 0, lat: 0 });
    expect(seen).toEqual([{ lon: 105.8, lat: 21 }, null]);
  });

  it('records layer visibility, basemap, and fit as spies', () => {
    const p = createFakePort();
    p.setLayerVisible('published', false);
    p.setBasemap('carto-light');
    p.fitToBbox([105.7, 20.9, 106.0, 21.1]);
    expect(p.setLayerVisible).toHaveBeenCalledWith('published', false);
    expect(p.setBasemap).toHaveBeenCalledWith('carto-light');
    expect(p.fitToBbox).toHaveBeenCalledWith([105.7, 20.9, 106.0, 21.1]);
  });

  it('records draw mode and notifies + unsubscribes draw complete', () => {
    const p = createFakePort();
    p.setDrawMode('LineString');
    expect(p.setDrawMode).toHaveBeenCalledWith('LineString');
    const seen: Geometry[] = [];
    const off = p.onDrawComplete((g) => seen.push(g));
    const line: Geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] };
    p.emitDraw(line);
    off();
    p.emitDraw({ type: 'Point', coordinates: [0, 0] });
    expect(seen).toEqual([line]);
  });

  it('records modify mode and notifies + unsubscribes modify complete', () => {
    const p = createFakePort();
    p.setModifyMode(true);
    expect(p.setModifyMode).toHaveBeenCalledWith(true);
    const seen: Array<[string, Geometry]> = [];
    const off = p.onModifyComplete((id, g) => seen.push([id, g]));
    const line: Geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] };
    p.emitModify('draft-1', line);
    off();
    p.emitModify('draft-2', { type: 'Point', coordinates: [0, 0] });
    expect(seen).toEqual([['draft-1', line]]);
  });

  it('records feature-point mode and notifies + unsubscribes feature-point picks', () => {
    const p = createFakePort();
    p.setFeaturePointMode(true);
    expect(p.setFeaturePointMode).toHaveBeenCalledWith(true);
    const seen: Array<[string, { lon: number; lat: number }]> = [];
    const off = p.onFeaturePointPick((id, pt) => seen.push([id, pt]));
    p.emitFeaturePointPick('draft-1', { lon: 105.8, lat: 21 });
    off();
    p.emitFeaturePointPick('draft-2', { lon: 0, lat: 0 });
    expect(seen).toEqual([['draft-1', { lon: 105.8, lat: 21 }]]);
  });

  it('onContextMenu subscribes and unsubscribes', () => {
    const p = createFakePort();
    const seen: Array<{ featureId: string | null; pixel: [number, number] }> = [];
    const off = p.onContextMenu((ev) => seen.push({ featureId: ev.featureId, pixel: ev.pixel }));
    p.emitContextMenu({ featureId: 'P-1', coordinate: { lon: 10, lat: 20 }, pixel: [5, 6] });
    off();
    p.emitContextMenu({ featureId: 'P-2', coordinate: { lon: 0, lat: 0 }, pixel: [1, 1] });
    expect(seen).toEqual([{ featureId: 'P-1', pixel: [5, 6] }]);
  });
});

it('stores a scoped target and emits geometry completion and null selection with unsubscribe', () => {
  const p = createFakePort();
  const target = { featureId: 'n1', mode: 'vertex' as const, lockedEndpointIndices: [], gestureKey: 'scope' };
  p.setGeometryEditTarget(target);
  expect(p.geometryEditTarget).toEqual(target);
  const completions: unknown[] = [], selections: unknown[] = [];
  const offComplete = p.onGeometryEditComplete((e) => completions.push(e));
  const offSelection = p.onGeometryVertexSelect((e) => selections.push(e));
  const event = { featureId: 'n1', geometry: { type: 'Point' as const, coordinates: [1, 2] }, gestureKey: 'scope' };
  p.emitGeometryEditComplete(event); p.emitGeometryVertexSelect({ featureId: 'n1', vertexIndex: 0 }); p.setGeometryEditTarget(null);
  offComplete(); offSelection(); p.emitGeometryEditComplete(event); p.emitGeometryVertexSelect(null);
  expect(completions).toEqual([event]); expect(selections).toEqual([{ featureId: 'n1', vertexIndex: 0 }, null]); expect(p.geometryEditTarget).toBeNull();
});
