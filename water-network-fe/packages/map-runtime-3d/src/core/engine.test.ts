import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryEditComplete } from '@wn/map-runtime';
import { MapEngine3D } from './engine.js';
import { FakeHost, FAKE_ORIGIN } from '../testing/fake-host.js';

const O = FAKE_ORIGIN;
const at = (dx: number, dy: number): [number, number] => [O.lon + dx, O.lat + dy];

const fc = (...features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });
const pipe = (id: string, coords: Array<[number, number]>, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, id, properties: { kind: 'pipe', ...props }, geometry: { type: 'LineString' as const, coordinates: coords } });
const node = (id: string, c: [number, number]) => ({ type: 'Feature' as const, id, properties: { kind: 'node' }, geometry: { type: 'Point' as const, coordinates: c } });

function setup(clickDelayMs = 0) {
  const host = new FakeHost();
  const engine = new MapEngine3D(host, { clickDelayMs });
  engine.mount(document.createElement('div'));
  engine.flush();
  return { host, engine };
}

const layerIds = (h: FakeHost) => h.layers.map((l) => l.id);

describe('MapEngine3D — rendering & state', () => {
  it('renders each pushed layer in call order and drops hidden layers', () => {
    const { host, engine } = setup();
    engine.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.001, 0)])));
    engine.setFeatures('node', fc(node('n1', at(0, 0))));
    engine.flush();
    const ids = layerIds(host);
    expect(ids.findIndex((i) => i.startsWith('L/pipe:'))).toBeLessThan(ids.findIndex((i) => i.startsWith('L/node:')));
    engine.setLayerVisible('pipe', false);
    engine.flush();
    expect(layerIds(host).some((i) => i.startsWith('L/pipe:'))).toBe(false);
  });

  it('buffers features pushed before mount and renders them on mount', () => {
    const host = new FakeHost();
    const engine = new MapEngine3D(host, { clickDelayMs: 0 });
    engine.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.001, 0)])));
    engine.setSelection('p1');
    expect(engine.getSelection()).toBe('p1');
    engine.mount(document.createElement('div'));
    engine.flush();
    expect(layerIds(host).some((i) => i.startsWith('L/pipe:'))).toBe(true);
  });

  it('restyles through setLayerStyle without re-adding features', () => {
    const { host, engine } = setup();
    engine.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.001, 0)])), () => ({ stroke: { color: '#ff0000', width: 2 } }));
    engine.flush();
    const first = (host.layers.find((l) => l.id.includes('line'))!.props.data as Array<{ color: number[] }>)[0]!.color;
    expect(first).toEqual([255, 0, 0, 255]);
    engine.setLayerStyle('pipe', () => ({ stroke: { color: '#00ff00', width: 2 } }));
    engine.flush();
    expect((host.layers.find((l) => l.id.includes('line'))!.props.data as Array<{ color: number[] }>)[0]!.color).toEqual([0, 255, 0, 255]);
  });

  it('keeps the flow layer on screen when anything re-renders (no blink between ticks)', () => {
    const { host, engine } = setup();
    engine.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.001, 0)])), () => ({ stroke: { color: '#0000ff', width: 3 }, flow: { speedMps: 1, direction: 1 } }));
    engine.flush();
    expect(layerIds(host)).toContain('wn-flow-dash');
    // an unrelated re-render (overlay / selection change) must not push the static layers alone
    engine.setSelection('p1');
    engine.flush();
    expect(layerIds(host)).toContain('wn-flow-dash');
    engine.setFlowAnimation(false);
    engine.flush();
    expect(layerIds(host)).not.toContain('wn-flow-dash');
  });

  it('delegates view, fit, basemap and 3D controls to the host', () => {
    const { host, engine } = setup();
    engine.setView({ center: { lon: 1, lat: 2 }, zoom: 9 });
    expect(engine.getView().zoom).toBe(9);
    engine.fitToBbox([1, 2, 3, 4], { padding: 10 });
    expect(host.fitCalls).toEqual([{ extent: [1, 2, 3, 4], opts: { padding: 10 } }]);
    engine.setBasemap('carto-dark');
    expect(host.basemap).toBe('carto-dark');
    const cams = vi.fn();
    engine.onCameraChange(cams);
    engine.set3DMode(true);
    expect(engine.getCamera()).toEqual({ pitch: 60, bearing: -25 });
    expect(engine.is3DMode()).toBe(true);
    engine.resetNorth();
    expect(engine.getCamera().bearing).toBe(0);
    engine.set3DMode(false);
    expect(engine.is3DMode()).toBe(false);
    expect(cams).toHaveBeenCalled();
    engine.setBuildings(true);
    expect(host.buildings).toBe(true);
    expect(engine.getBuildings()).toBe(true);
    engine.setTerrain({ enabled: true, exaggeration: 2 });
    expect(host.terrain).toEqual({ enabled: true, exaggeration: 2 });
  });

  it('fitToBbox before mount is a no-op (same as the 2D engine)', () => {
    const host = new FakeHost();
    new MapEngine3D(host).fitToBbox([1, 2, 3, 4]);
    expect(host.fitCalls).toHaveLength(0);
  });

  it('drapes geometry on terrain once enabled', () => {
    const { host, engine } = setup();
    host.elevation = () => 42;
    engine.setFeatures('node', fc(node('n1', at(0, 0))));
    engine.setTerrain({ enabled: true });
    engine.flush();
    const icon = host.layers.find((l) => l.id.includes('icon'))!;
    expect((icon.props.data as Array<{ position: number[] }>)[0]!.position[2]).toBe(42);
  });

  it('destroy releases the host and subscriptions', () => {
    const { host, engine } = setup();
    const cb = vi.fn();
    engine.onFeatureClick(cb);
    engine.destroy();
    expect(host.destroyed).toBe(true);
    host.emit('click', host.px(...at(0, 0)));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('MapEngine3D — hit testing', () => {
  let host: FakeHost;
  let engine: MapEngine3D;
  beforeEach(() => {
    ({ host, engine } = setup());
    engine.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.002, 0)])), () => ({ stroke: { color: '#0E7C86', width: 3 } }));
    engine.setFeatures('node', fc(node('n1', at(0.002, 0))), () => ({ image: { shape: 'circle', radius: 5, color: '#fff' } }));
    engine.flush();
  });

  it('reports a feature click for the topmost hit, none on empty map', () => {
    const cb = vi.fn();
    engine.onFeatureClick(cb);
    host.emit('click', host.px(...at(0.001, 0)));
    expect(cb).toHaveBeenLastCalledWith('p1');
    host.emit('click', host.px(...at(0.002, 0))); // node sits on the pipe end and is painted later
    expect(cb).toHaveBeenLastCalledWith('n1');
    cb.mockClear();
    host.emit('click', host.px(...at(0.001, 0.003)));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores non-primary buttons', () => {
    const cb = vi.fn();
    engine.onFeatureClick(cb);
    host.emit('click', host.px(...at(0.001, 0)), { button: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('delays the click so a double-click can cancel it (OpenLayers singleclick parity)', () => {
    vi.useFakeTimers();
    const slow = new MapEngine3D(host, { clickDelayMs: 250 });
    slow.mount(document.createElement('div'));
    slow.setFeatures('pipe', fc(pipe('p1', [at(0, 0), at(0.002, 0)])));
    slow.flush();
    const cb = vi.fn();
    slow.onFeatureClick(cb);
    const px = host.px(...at(0.001, 0));
    host.emit('click', px);
    host.emit('dblclick', px);
    vi.advanceTimersByTime(400);
    expect(cb).not.toHaveBeenCalled();
    host.emit('click', px);
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledWith('p1');
    vi.useRealTimers();
  });

  it('emits pointer coordinates and null on leave', () => {
    const cb = vi.fn();
    engine.onPointerMove(cb);
    host.emit('move', [400, 300]);
    expect(cb.mock.calls[0]![0]).toMatchObject({ lon: O.lon, lat: O.lat });
    host.emit('leave', [0, 0]);
    expect(cb).toHaveBeenLastCalledWith(null);
  });

  it('context menu reports the hit feature (or null), coordinate and pixel', () => {
    const cb = vi.fn();
    engine.onContextMenu(cb);
    const px = host.px(...at(0.001, 0));
    host.emit('contextmenu', px, { button: 2 });
    expect(cb.mock.calls[0]![0]).toMatchObject({ featureId: 'p1', pixel: px });
    host.emit('contextmenu', [10, 10], { button: 2 });
    expect(cb.mock.calls[1]![0].featureId).toBeNull();
  });

  it('selection recolours only through the style spec (__selected)', () => {
    engine.setLayerStyle('pipe', (p) => ({ stroke: { color: p.__selected ? '#ff0000' : '#0000ff', width: 3 } }));
    engine.setSelection('p1');
    engine.flush();
    const d = host.layers.find((l) => l.id.startsWith('L/pipe:') && l.id.includes('line'))!.props.data as Array<{ color: number[] }>;
    expect(d[0]!.color).toEqual([255, 0, 0, 255]);
    engine.setSelection(null);
    engine.flush();
    expect((host.layers.find((l) => l.id.startsWith('L/pipe:') && l.id.includes('line'))!.props.data as Array<{ color: number[] }>)[0]!.color).toEqual([0, 0, 255, 255]);
  });
});

describe('MapEngine3D — draw', () => {
  it('draws a LineString with clicks and finishes on double-click; sketch is an overlay', () => {
    const { host, engine } = setup();
    const done = vi.fn();
    engine.onDrawComplete(done);
    engine.setDrawMode('LineString');
    const a = host.px(...at(0, 0));
    const b = host.px(...at(0.001, 0));
    const c = host.px(...at(0.001, 0.001));
    host.emit('move', a);
    host.emit('click', a);
    host.emit('move', b);
    host.emit('click', b);
    host.emit('move', c);
    engine.flush();
    expect(layerIds(host).some((i) => i.startsWith('overlay/'))).toBe(true);
    host.emit('click', c);
    host.emit('click', c); // second click of a double-click lands on the last vertex → finish
    host.emit('dblclick', c);
    expect(done).toHaveBeenCalledTimes(1);
    const g = done.mock.calls[0]![0] as Geometry;
    expect(g.type).toBe('LineString');
    expect((g as { coordinates: number[][] }).coordinates).toHaveLength(3);
    expect((g as { coordinates: number[][] }).coordinates[1]![0]).toBeCloseTo(O.lon + 0.001, 6);
    expect(host.doubleClickZoom).toBe(false);
    engine.setDrawMode(null);
    expect(host.doubleClickZoom).toBe(true);
  });

  it('draws a Point with one click', () => {
    const { host, engine } = setup();
    const done = vi.fn();
    engine.onDrawComplete(done);
    engine.setDrawMode('Point');
    host.emit('click', host.px(...at(0.0005, 0.0005)));
    expect(done.mock.calls[0]![0]).toMatchObject({ type: 'Point' });
  });

  it('snaps the sketch to an existing vertex and to an edge, honouring SnapModes', () => {
    const { host, engine } = setup();
    engine.setFeatures('published', fc(pipe('p1', [at(0, 0), at(0.002, 0)])));
    engine.flush();
    const done = vi.fn();
    engine.onDrawComplete(done);
    engine.setDrawMode('Point');
    // 6 px off the vertex → snaps onto it
    host.emit('click', [host.px(...at(0, 0))[0] + 4, host.px(...at(0, 0))[1] + 4]);
    expect((done.mock.calls[0]![0] as { coordinates: number[] }).coordinates).toEqual(at(0, 0));
    // 6 px off the edge midpoint → edge snap lands on the line (lat equal)
    host.emit('click', [host.px(...at(0.001, 0))[0], host.px(...at(0.001, 0))[1] - 6]);
    expect((done.mock.calls[1]![0] as { coordinates: number[] }).coordinates[1]).toBeCloseTo(O.lat, 9);
    // snapping off → the raw click point is used
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    host.emit('click', [host.px(...at(0, 0))[0] + 4, host.px(...at(0, 0))[1] + 4]);
    expect((done.mock.calls[2]![0] as { coordinates: number[] }).coordinates[0]).not.toBe(O.lon);
  });

  it('ORTHO locks segments to 45° increments', () => {
    const { host, engine } = setup();
    const done = vi.fn();
    engine.onDrawComplete(done);
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    engine.setDrawMode('LineString');
    engine.setDrawConstraint('ortho');
    const a = host.px(...at(0, 0));
    host.emit('click', a);
    const near = [a[0] + 100, a[1] - 12] as [number, number]; // ~7° off horizontal
    host.emit('move', near);
    host.emit('click', near);
    host.key('Enter');
    const [p0, p1] = (done.mock.calls[0]![0] as { coordinates: number[][] }).coordinates as [number[], number[]];
    expect(p1[1]).toBeCloseTo(p0[1]!, 6); // horizontal after locking
    expect(p1[0]).toBeGreaterThan(p0[0]!);
  });

  it('shows a live length readout when measuring', () => {
    const { host, engine } = setup();
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    engine.setDrawMode('LineString');
    engine.setDrawMeasure(true);
    host.emit('click', host.px(...at(0, 0)));
    host.emit('move', host.px(...at(0.001, 0)));
    engine.flush();
    const text = host.layers.find((l) => l.id.startsWith('overlay/') && l.id.includes('text'))!;
    expect((text.props.data as Array<{ text: string }>)[0]!.text).toMatch(/^\d+ m$/);
  });

  it('Escape aborts the sketch; Backspace removes the last vertex; entering draw clears other modes', () => {
    const { host, engine } = setup();
    const done = vi.fn();
    engine.onDrawComplete(done);
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    engine.setDrawMode('LineString');
    host.emit('click', host.px(...at(0, 0)));
    host.emit('click', host.px(...at(0.001, 0)));
    host.key('Backspace');
    host.key('Escape');
    host.key('Enter'); // nothing left to finish
    expect(done).not.toHaveBeenCalled();
    engine.setModifyMode(true);
    engine.setDrawMode('Point');
    host.emit('click', host.px(...at(0.0007, 0.0007)));
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('MapEngine3D — legacy modify', () => {
  it('drags a draft vertex and reports (id, geometry) on release', () => {
    const { host, engine } = setup();
    engine.setFeatures('draft', fc(pipe('d1', [at(0, 0), at(0.001, 0), at(0.002, 0)])));
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    engine.setModifyMode(true);
    engine.flush();
    const done = vi.fn();
    engine.onModifyComplete(done);
    const mid = host.px(...at(0.001, 0));
    host.emit('move', mid);
    expect(host.dragPan).toBe(false); // hovering a handle hands the drag to the editor
    host.emit('down', mid);
    host.emit('move', [mid[0], mid[1] - 40]);
    host.emit('up', [mid[0], mid[1] - 40]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toBe('d1');
    const coords = (done.mock.calls[0]![1] as { coordinates: number[][] }).coordinates;
    expect(coords).toHaveLength(3);
    expect(coords[1]![1]).toBeGreaterThan(O.lat);
    expect(host.dragPan).toBe(true);
  });

  it('dragging an edge inserts a vertex; Alt+click deletes one', () => {
    const { host, engine } = setup();
    engine.setFeatures('draft', fc(pipe('d1', [at(0, 0), at(0.002, 0)])));
    engine.setSnapModes({ node: false, vertex: false, edge: false });
    engine.setModifyMode(true);
    engine.flush();
    const done = vi.fn();
    engine.onModifyComplete(done);
    const mid = host.px(...at(0.001, 0));
    host.emit('move', mid);
    host.emit('down', mid);
    host.emit('move', [mid[0], mid[1] + 30]);
    host.emit('up', [mid[0], mid[1] + 30]);
    expect((done.mock.calls[0]![1] as { coordinates: number[][] }).coordinates).toHaveLength(3);
    // authoritative refresh with the 3-vertex line, then alt-click the middle vertex
    engine.setFeatures('draft', fc(pipe('d1', (done.mock.calls[0]![1] as { coordinates: Array<[number, number]> }).coordinates)));
    const v = host.px(...(done.mock.calls[0]![1] as { coordinates: Array<[number, number]> }).coordinates[1]!);
    host.emit('move', v);
    host.emit('down', v, { altKey: true });
    expect((done.mock.calls[1]![1] as { coordinates: number[][] }).coordinates).toHaveLength(2);
  });
});

describe('MapEngine3D — scoped geometry edit (ADR 0014)', () => {
  const target = (over: Partial<{ mode: 'vertex' | 'segment'; locked: number[]; key: string }> = {}) => ({ featureId: 'd1', mode: over.mode ?? 'vertex', lockedEndpointIndices: over.locked ?? [], gestureKey: over.key ?? 'g1' });
  const draft = (coords: Array<[number, number]>) => fc(pipe('d1', coords));
  function editSetup(mode: 'vertex' | 'segment' = 'vertex', locked: number[] = []) {
    const s = setup();
    s.engine.setSnapModes({ node: false, vertex: false, edge: false });
    s.engine.setFeatures('draft', draft([at(0, 0), at(0.001, 0), at(0.002, 0)]));
    const done = vi.fn<(e: GeometryEditComplete) => void>();
    const sel = vi.fn();
    s.engine.onGeometryEditComplete(done);
    s.engine.onGeometryVertexSelect(sel);
    s.engine.setGeometryEditTarget(target({ mode, locked }));
    s.engine.flush();
    return { ...s, done, sel };
  }

  it('drags a vertex: previews live, completes once on release with the gestureKey', () => {
    const { host, engine, done, sel } = editSetup();
    const v = host.px(...at(0.001, 0));
    host.emit('move', v);
    host.emit('down', v);
    expect(sel).toHaveBeenLastCalledWith({ featureId: 'd1', vertexIndex: 1 });
    host.emit('move', [v[0], v[1] - 30]);
    engine.flush();
    expect(done).not.toHaveBeenCalled(); // preview only
    const live = host.layers.find((l) => l.id.startsWith('L/draft:') && l.id.includes('line'))!.props.data as Array<{ path: number[][] }>;
    expect(live.at(-1)!.path[1]![1]).toBeGreaterThan(O.lat);
    host.emit('up', [v[0], v[1] - 30]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toMatchObject({ featureId: 'd1', gestureKey: 'g1' });
    expect((done.mock.calls[0]![0].geometry as { coordinates: number[][] }).coordinates[1]![1]).toBeGreaterThan(O.lat);
  });

  it('a press-release without movement completes nothing', () => {
    const { host, done } = editSetup();
    const v = host.px(...at(0.001, 0));
    host.emit('down', v);
    host.emit('up', v);
    expect(done).not.toHaveBeenCalled();
  });

  it('midpoint handle inserts a vertex (one completion, four… three coords)', () => {
    const { host, done } = editSetup();
    const m = host.px(...at(0.0005, 0)); // midpoint of segment 0
    host.emit('down', m);
    host.emit('move', [m[0], m[1] - 30]);
    host.emit('up', [m[0], m[1] - 30]);
    expect(done).toHaveBeenCalledTimes(1);
    expect((done.mock.calls[0]![0].geometry as { coordinates: number[][] }).coordinates).toHaveLength(4);
  });

  it('locked endpoints cannot be dragged', () => {
    const { host, done } = editSetup('vertex', [0]);
    const start = host.px(...at(0, 0));
    host.emit('down', start);
    host.emit('move', [start[0], start[1] - 30]);
    host.emit('up', [start[0], start[1] - 30]);
    expect(done).not.toHaveBeenCalled();
  });

  it('Alt+click deletes an interior vertex but never an endpoint', () => {
    const { host, done } = editSetup();
    host.emit('down', host.px(...at(0, 0)), { altKey: true });
    expect(done).not.toHaveBeenCalled();
    host.emit('down', host.px(...at(0.001, 0)), { altKey: true });
    expect(done).toHaveBeenCalledTimes(1);
    expect((done.mock.calls[0]![0].geometry as { coordinates: number[][] }).coordinates).toHaveLength(2);
  });

  it('deleteSelectedGeometryVertex removes the selected interior vertex', () => {
    const { host, engine, done } = editSetup();
    const v = host.px(...at(0.001, 0));
    host.emit('down', v);
    host.emit('up', v);
    engine.deleteSelectedGeometryVertex();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('Escape during a gesture restores the snapshot with no completion', () => {
    const { host, engine, done } = editSetup();
    const v = host.px(...at(0.001, 0));
    host.emit('down', v);
    host.emit('move', [v[0], v[1] - 30]);
    host.key('Escape');
    host.emit('up', [v[0], v[1] - 30]);
    engine.flush();
    expect(done).not.toHaveBeenCalled();
    const live = host.layers.find((l) => l.id.startsWith('L/draft:') && l.id.includes('line'))!.props.data as Array<{ path: number[][] }>;
    expect(live[0]!.path[1]![1]).toBeCloseTo(O.lat, 9);
  });

  it('segment mode translates a segment rigidly and keeps outside endpoints fixed', () => {
    const { host, done } = editSetup('segment');
    const m = host.px(...at(0.0005, 0));
    host.emit('down', m);
    host.emit('move', [m[0], m[1] - 40]);
    host.emit('up', [m[0], m[1] - 40]);
    expect(done).toHaveBeenCalledTimes(1);
    const coords = (done.mock.calls[0]![0].geometry as { coordinates: number[][] }).coordinates;
    expect(coords[0]![0]).toBeCloseTo(at(0, 0)[0], 9); // outside endpoint preserved
    expect(coords[0]![1]).toBeCloseTo(at(0, 0)[1], 9);
    expect(coords.length).toBeGreaterThanOrEqual(4); // connecting segments added
  });

  it('keeps the controller when only other assets rerender, resets it when the geometry changes', () => {
    const { host, engine, done, sel } = editSetup();
    const v = host.px(...at(0.001, 0));
    host.emit('down', v);
    host.emit('move', [v[0], v[1] - 30]);
    // unrelated rerender with identical target geometry: preview survives
    engine.setFeatures('draft', fc(pipe('d1', [at(0, 0), at(0.001, 0), at(0.002, 0)]), node('n9', at(0.01, 0.01))));
    engine.flush();
    let live = host.layers.find((l) => l.id.startsWith('L/draft:') && l.id.includes('line'))!.props.data as Array<{ path: number[][] }>;
    expect(live.at(-1)!.path[1]![1]).toBeGreaterThan(O.lat);
    host.emit('up', [v[0], v[1] - 30]);
    expect(done).toHaveBeenCalledTimes(1);
    // authoritative replacement with different geometry: controller cancelled → selection cleared
    sel.mockClear();
    engine.setFeatures('draft', draft([at(0, 0), at(0.001, 0.002), at(0.002, 0)]));
    expect(sel).toHaveBeenCalledWith(null);
    engine.flush();
    live = host.layers.find((l) => l.id.startsWith('L/draft:') && l.id.includes('line'))!.props.data as Array<{ path: number[][] }>;
    expect(live[0]!.path[1]![1]).toBeCloseTo(O.lat + 0.002, 9);
  });

  it('waits for a missing draft target, and null / selection change clears it', () => {
    const s = setup();
    s.engine.setGeometryEditTarget(target());
    s.engine.flush();
    expect(layerIds(s.host).some((i) => i.startsWith('overlay/'))).toBe(false);
    s.engine.setFeatures('draft', draft([at(0, 0), at(0.002, 0)]));
    s.engine.flush();
    expect(layerIds(s.host).some((i) => i.startsWith('overlay/'))).toBe(true);
    s.engine.setSelection('other'); // selecting something else ends the scope
    s.engine.flush();
    expect(layerIds(s.host).some((i) => i.startsWith('overlay/'))).toBe(false);
  });

  it('a Point target drags only in vertex mode; segment mode shows no handles', () => {
    const s = setup();
    s.engine.setSnapModes({ node: false, vertex: false, edge: false });
    s.engine.setFeatures('draft', fc(node('d1', at(0, 0))));
    const done = vi.fn();
    s.engine.onGeometryEditComplete(done);
    s.engine.setGeometryEditTarget(target());
    const p = s.host.px(...at(0, 0));
    s.host.emit('down', p);
    s.host.emit('move', [p[0] + 30, p[1]]);
    s.host.emit('up', [p[0] + 30, p[1]]);
    expect((done.mock.calls[0]![0].geometry as { type: string }).type).toBe('Point');
    s.engine.setGeometryEditTarget(target({ mode: 'segment' }));
    s.engine.flush();
    expect(layerIds(s.host).some((i) => i.startsWith('overlay/'))).toBe(false);
  });

  it('suppresses the synthesized feature click after a handle gesture', () => {
    const { host, engine } = editSetup();
    engine.setFeatures('draft', draft([at(0, 0), at(0.001, 0), at(0.002, 0)]));
    engine.setGeometryEditTarget(target());
    engine.flush();
    const cb = vi.fn();
    engine.onFeatureClick(cb);
    const v = host.px(...at(0.001, 0));
    host.emit('down', v);
    host.emit('up', v);
    host.emit('click', v);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('MapEngine3D — box select & feature point', () => {
  it('rubber-band selects every feature touching the rectangle, across layers', () => {
    const { host, engine } = setup();
    engine.setFeatures('pipe', fc(pipe('p1', [at(-0.003, 0), at(0.003, 0)]), pipe('far', [at(0, 0.02), at(0.001, 0.02)])));
    engine.setFeatures('node', fc(node('n1', at(0, 0)), node('n2', at(0.01, 0.01))));
    engine.flush();
    const done = vi.fn();
    engine.onBoxSelect(done);
    engine.setBoxSelectMode(true);
    expect(host.dragPan).toBe(false);
    host.emit('down', host.px(-0 + O.lon - 0.0005, O.lat + 0.0005));
    host.emit('move', host.px(O.lon + 0.0005, O.lat - 0.0005));
    engine.flush();
    expect(layerIds(host).some((i) => i.startsWith('overlay/'))).toBe(true);
    host.emit('up', host.px(O.lon + 0.0005, O.lat - 0.0005));
    expect(new Set(done.mock.calls[0]![0])).toEqual(new Set(['p1', 'n1']));
    engine.setBoxSelectMode(false);
    expect(host.dragPan).toBe(true);
  });

  it('a click without drag does not box-select', () => {
    const { host, engine } = setup();
    const done = vi.fn();
    engine.onBoxSelect(done);
    engine.setBoxSelectMode(true);
    host.emit('down', [100, 100]);
    host.emit('up', [101, 101]);
    expect(done).not.toHaveBeenCalled();
  });

  it('feature-point mode reports the click projected onto the clicked draft feature', () => {
    const { host, engine } = setup();
    engine.setFeatures('draft', fc(pipe('d1', [at(0, 0), at(0.002, 0)])));
    engine.setFeatures('published', fc(pipe('pub', [at(0, 0.0005), at(0.002, 0.0005)])));
    engine.flush();
    const pick = vi.fn();
    const click = vi.fn();
    engine.onFeaturePointPick(pick);
    engine.onFeatureClick(click);
    engine.setFeaturePointMode(true);
    const px = host.px(...at(0.001, 0));
    host.emit('click', [px[0], px[1] - 2]); // 2 px above the line
    expect(click).not.toHaveBeenCalled();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0]![0]).toBe('d1');
    expect(pick.mock.calls[0]![1].lat).toBeCloseTo(O.lat, 6);
    expect(pick.mock.calls[0]![1].lon).toBeCloseTo(O.lon + 0.001, 4);
    engine.setFeaturePointMode(false);
    host.emit('click', px);
    expect(click).toHaveBeenCalled();
  });
});
