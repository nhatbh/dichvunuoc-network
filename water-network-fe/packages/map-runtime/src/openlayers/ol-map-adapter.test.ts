import { describe, expect, it, beforeAll } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { OlMapAdapter } from './ol-map-adapter.js';

beforeAll(() => {
  // jsdom has no canvas 2D context; give OL a permissive no-op stub.
  const ctx = new Proxy({}, { get: () => () => ({}) }) as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;

  // OL uses ResizeObserver to react to container size changes; jsdom lacks it.
  (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  };
});

const fc: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [105.8, 21] }, properties: { kind: 'node' } },
  ],
};

describe('OlMapAdapter (smoke, jsdom)', () => {
  it('constructs, sets view, and reports it back', () => {
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    adapter.setView({ center: { lon: 105.81, lat: 21.01 }, zoom: 13 });
    expect(adapter.getView().zoom).toBe(13);
    expect(adapter.getView().center.lon).toBeCloseTo(105.81, 1);
  });

  it('mounts, sets features, selects, and destroys without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setSelection('n1');
      expect(adapter.getSelection()).toBe('n1');
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('fitToBbox moves the view toward the extent centre', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 100, lat: 10 }, zoom: 4 });
    adapter.mount(el);
    adapter.fitToBbox([105.7, 20.9, 106.0, 21.1], { maxZoom: 16 });
    expect(adapter.getView().center.lon).toBeCloseTo(105.85, 1);
    expect(adapter.getView().center.lat).toBeCloseTo(21.0, 1);
    adapter.destroy();
    el.remove();
  });

  it('toggles layer visibility, switches basemap, and subscribes to pointer moves without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setLayerVisible('published', false);
      adapter.setLayerVisible('published', true);
      adapter.setBasemap('carto-light');
      adapter.setBasemap('none');
      adapter.setBasemap('osm');
      const off = adapter.onPointerMove(() => {});
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('enters and exits modify mode with snap and subscribes to modify completion without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setFeatures('draft', fc);
      const off = adapter.onModifyComplete(() => {});
      adapter.setModifyMode(true); // adds Modify(draft) + Snap(published, draft)
      adapter.setModifyMode(false); // removes Modify; Snap removed (no draw/modify active)
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('enters and exits draw mode and subscribes to draw completion without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      const off = adapter.onDrawComplete(() => {});
      adapter.setDrawMode('LineString');
      adapter.setDrawMode('Point');
      adapter.setDrawMode(null);
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('toggles feature-point mode and subscribes to picks without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('draft', fc);
      const off = adapter.onFeaturePointPick(() => {});
      adapter.setFeaturePointMode(true);
      adapter.setFeaturePointMode(false);
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('toggles box-select mode and subscribes to box selections without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      const off = adapter.onBoxSelect(() => {});
      adapter.setBoxSelectMode(true);
      adapter.setBoxSelectMode(false);
      off();
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });

  it('onContextMenu returns an unsubscribe function', () => {
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    const off = adapter.onContextMenu(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('applies snap modes and draw constraints without throwing', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
    expect(() => {
      adapter.mount(el);
      adapter.setFeatures('published', fc);
      adapter.setSnapModes({ node: true, vertex: false, edge: true });
      adapter.setDrawConstraint('ortho');
      adapter.setDrawMeasure(true);
      adapter.setDrawMode('LineString'); // built with ortho geometryFunction + measure sketch style
      adapter.setSnapModes({ node: false, vertex: false, edge: false }); // all-off skips snapping
      adapter.setDrawConstraint(null); // rebuilds the active draw
      adapter.setDrawMode(null);
      adapter.destroy();
    }).not.toThrow();
    el.remove();
  });
});

// Capture the real map created by mount, without replacing the engine.
import OLMap from 'ol/Map';
import MapBrowserEvent from 'ol/MapBrowserEvent';
import Modify from 'ol/interaction/Modify';
import Draw from 'ol/interaction/Draw';
import { vi } from 'vitest';
import type { GeometryEditComplete, GeometryVertexSelection } from '../port/types.js';

function scopedAdapter(beforeMount = false) {
  let map!: OLMap;
  const addLayer = OLMap.prototype.addLayer;
  const capture = vi.spyOn(OLMap.prototype, 'addLayer').mockImplementation(function (this: OLMap, layer) { map = this; addLayer.call(this, layer); });
  const el = document.createElement('div'); document.body.append(el);
  const adapter = new OlMapAdapter({ center: { lon: 105.8, lat: 21 }, zoom: 12 });
  const data: FeatureCollection = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'pipe', properties: { kind: 'pipe' }, geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.801, 21], [105.802, 21]] } },
    { type: 'Feature', id: 'other', properties: { kind: 'node' }, geometry: { type: 'Point', coordinates: [105.803, 21] } },
  ] };
  const target = { featureId: 'pipe', mode: 'vertex' as const, lockedEndpointIndices: [], gestureKey: 'scope' };
  const complete: GeometryEditComplete[] = [], selection: (GeometryVertexSelection | null)[] = [];
  adapter.onGeometryEditComplete((e) => complete.push(e)); adapter.onGeometryVertexSelect((e) => selection.push(e));
  if (beforeMount) { adapter.setFeatures('draft', data); adapter.setGeometryEditTarget(target); }
  adapter.mount(el);
  if (!beforeMount) { adapter.setFeatures('draft', data); adapter.setGeometryEditTarget(target); }
  capture.mockRestore();
  adapter.setSnapModes({ node: false, vertex: false, edge: false });
  vi.spyOn(map, 'getPixelFromCoordinate').mockImplementation((c) => c.slice());
  vi.spyOn(map, 'getCoordinateFromPixel').mockImplementation((p) => p.slice());
  const draft = () => map.getLayers().getArray().find((l) => !l.get('geometryEditHandles') && 'getSource' in l && (l as import('ol/layer/Vector').default).getSource()?.getFeatureById?.('pipe')) as import('ol/layer/Vector').default;
  const feature = () => draft().getSource()!.getFeatureById('pipe')!;
  const coords = () => (feature().getGeometry() as import('ol/geom/LineString').default).getCoordinates();
  const event = (type: string, coordinate: number[]) => {
    const e = new MapBrowserEvent(type, map, new MouseEvent(type, { button: 0 }) as PointerEvent); e.coordinate = coordinate; e.pixel = coordinate;
    for (const interaction of map.getInteractions().getArray().slice().reverse()) if (interaction.getActive() && !interaction.handleEvent(e)) break;
  };
  const dispose = () => { adapter.destroy(); el.remove(); vi.restoreAllMocks(); };
  return { adapter, map, data, target, complete, selection, feature, coords, event, dispose };
}

describe('OlMapAdapter scoped geometry lifecycle', () => {
  it('mounts a target configured before the map and disables legacy Modify/Draw exclusively', () => {
    const s = scopedAdapter(true);
    try {
      expect(s.map.getLayers().getArray().filter((l) => l.get('geometryEditHandles'))).toHaveLength(1);
      s.adapter.setModifyMode(true); expect(s.map.getLayers().getArray().filter((l) => l.get('geometryEditHandles'))).toHaveLength(0);
      expect(s.map.getInteractions().getArray().some((i) => i instanceof Modify)).toBe(true);
      s.adapter.setGeometryEditTarget(s.target); expect(s.map.getInteractions().getArray().some((i) => i instanceof Modify || i instanceof Draw)).toBe(false);
      s.adapter.setDrawMode('Point'); expect(s.map.getLayers().getArray().filter((l) => l.get('geometryEditHandles'))).toHaveLength(0);
      expect(s.map.getInteractions().getArray().some((i) => i instanceof Draw)).toBe(true);
    } finally { s.dispose(); }
  });
  it('keeps an unchanged target geometry gesture and selection through property/other feature rerenders', () => {
    const s = scopedAdapter();
    try {
      const original = s.coords(), middle = original[1]!;
      s.event('pointerdown', middle); s.event('pointerdrag', [middle[0]! + 30, middle[1]! + 40]);
      const data = structuredClone(s.data); data.features[0]!.properties = { kind: 'pipe', name: 'updated' }; data.features[1]!.geometry = { type: 'Point', coordinates: [105.804, 21] };
      const feature = s.feature(); s.adapter.setFeatures('draft', data); s.adapter.setGeometryEditTarget({ ...s.target });
      expect(s.feature()).toBe(feature); expect(s.selection.at(-1)).toEqual({ featureId: 'pipe', vertexIndex: 1 }); expect(s.complete).toEqual([]);
      s.event('pointerup', [middle[0]! + 30, middle[1]! + 40]); expect(s.complete).toHaveLength(1);
    } finally { s.dispose(); }
  });
  it('cancels on authoritative geometry replacement and never overwrites the new layer data', () => {
    const s = scopedAdapter();
    try {
      const middle = s.coords()[1]!; s.event('pointerdown', middle); s.event('pointerdrag', [middle[0]! + 30, middle[1]! + 40]);
      const data = structuredClone(s.data); data.features[0]!.geometry = { type: 'LineString', coordinates: [[105.8, 21], [105.801, 21.001], [105.802, 21]] };
      s.adapter.setFeatures('draft', data); const replacement = s.coords(); s.event('pointerup', [middle[0]! + 30, middle[1]! + 40]);
      expect(s.complete).toEqual([]); expect(s.coords()).toEqual(replacement); expect(replacement[1]![1]).toBeGreaterThan(middle[1]!);
    } finally { s.dispose(); }
  });
  it('restores preview on target reset and waits for a missing target to appear in draft', () => {
    const s = scopedAdapter();
    try {
      const original = s.coords(), middle = original[1]!; s.event('pointerdown', middle); s.event('pointerdrag', [middle[0]! + 30, middle[1]! + 40]);
      s.adapter.setGeometryEditTarget(null); expect(s.coords()).toEqual(original); expect(s.selection.at(-1)).toBeNull();
      s.adapter.setGeometryEditTarget({ ...s.target, featureId: 'missing' }); expect(s.map.getLayers().getArray().filter((l) => l.get('geometryEditHandles'))).toHaveLength(0);
      const data = structuredClone(s.data); data.features[0]!.id = 'missing'; s.adapter.setFeatures('draft', data);
      expect(s.map.getLayers().getArray().filter((l) => l.get('geometryEditHandles'))).toHaveLength(1); expect(s.complete).toEqual([]);
    } finally { s.dispose(); }
  });
  it('clears preview when selection or gesture scope changes', () => {
    const s = scopedAdapter();
    try {
      const original = s.coords(), middle = original[1]!; s.event('pointerdown', middle); s.event('pointerdrag', [middle[0]! + 30, middle[1]! + 40]);
      s.adapter.setGeometryEditTarget({ ...s.target, gestureKey: 'other-revision' }); expect(s.coords()).toEqual(original);
      s.event('pointerdown', middle); s.event('pointerdrag', [middle[0]! + 30, middle[1]! + 40]); s.adapter.setSelection('other');
      expect(s.coords()).toEqual(original); expect(s.selection.at(-1)).toBeNull(); expect(s.complete).toEqual([]);
    } finally { s.dispose(); }
  });
});
