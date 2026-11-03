import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import OLMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import MapBrowserEvent from 'ol/MapBrowserEvent';
import type { GeometryEditComplete, GeometryVertexSelection } from '../port/types.js';
import { createGeometryEditInteraction } from './geometry-edit-interaction.js';

beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver; });

// Real OL map, features and browser events; jsdom has no renderer/frame transforms.
// Supply only the CSS-pixel transform and drive the map's actual interaction chain.
function setup(coords: number[][] = [[0, 0], [100, 0], [200, 0]], mode: 'vertex' | 'segment' = 'vertex', locked: number[] = [], point = false, snapFeatures: Feature[] = [], snapModes = { node: false, vertex: false, edge: false }) {
  const map = new OLMap({ view: new View({ center: [1000, 1000], resolution: 1 }), controls: [], interactions: [] });
  vi.spyOn(map, 'getPixelFromCoordinate').mockImplementation((c) => c.slice());
  vi.spyOn(map, 'getCoordinateFromPixel').mockImplementation((p) => p.slice());
  const feature = new Feature(point ? new Point(coords[0]!) : new LineString(coords));
  feature.setId('pipe');
  const complete: GeometryEditComplete[] = [], selection: (GeometryVertexSelection | null)[] = [];
  const controller = createGeometryEditInteraction({ map, feature, target: { featureId: 'pipe', mode, lockedEndpointIndices: locked, gestureKey: 'revision-1' }, snapModes: () => snapModes, snapFeatures: () => [...snapFeatures, feature], onComplete: (e) => complete.push(e), onVertexSelect: (e) => selection.push(e) });
  cleanups.push(() => { controller.destroy(); map.dispose(); });
  function event(type: string, coordinate: number[], modifiers: MouseEventInit = {}) {
    const original = new MouseEvent(type, { button: 0, ...modifiers });
    const e = new MapBrowserEvent(type, map, original as PointerEvent);
    e.coordinate = coordinate; e.pixel = coordinate;
    const interactions = map.getInteractions().getArray().slice().reverse();
    for (const interaction of interactions) if (interaction.getActive() && !interaction.handleEvent(e)) break;
    return e;
  }
  return { map, feature, complete, selection, controller, event, coords: () => (feature.getGeometry() as LineString).getCoordinates() };
}
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.restoreAllMocks(); });
const drag = (s: ReturnType<typeof setup>, from: number[], to: number[]) => { s.event('pointerdown', from); s.event('pointerdrag', to); s.event('pointerup', to); };

describe('scoped geometry interaction', () => {
  it('previews a vertex and completes exactly once with the captured scope', () => {
    const s = setup(); s.event('pointerdown', [100, 0]); s.event('pointerdrag', [110, 30]);
    expect(s.coords()).toEqual([[0, 0], [110, 30], [200, 0]]); expect(s.complete).toEqual([]);
    s.event('pointerup', [110, 30]); s.event('pointerup', [110, 30]);
    expect(s.complete).toHaveLength(1); expect(s.complete[0]).toMatchObject({ featureId: 'pipe', gestureKey: 'revision-1', geometry: { type: 'LineString' } });
    expect(s.complete[0]!.geometry.type === 'LineString' && s.complete[0]!.geometry.coordinates[1]![0]).toBeCloseTo(0.00098815, 7);
  });
  it('does not move or select a locked endpoint', () => {
    const s = setup(undefined, 'vertex', [0, 2]); drag(s, [0, 0], [30, 30]);
    expect(s.coords()).toEqual([[0, 0], [100, 0], [200, 0]]); expect(s.complete).toEqual([]); expect(s.selection.at(-1)).toBeNull();
  });
  it('inserts a midpoint once and clears selection', () => {
    const s = setup(); drag(s, [50, 0], [50, 0]);
    expect(s.coords()).toEqual([[0, 0], [50, 0], [100, 0], [200, 0]]); expect(s.complete).toHaveLength(1); expect(s.selection.at(-1)).toBeNull();
  });
  it('gives vertex hits precedence over nearby midpoint handles within ten CSS pixels', () => {
    const s = setup([[0, 0], [18, 0], [100, 0]]); drag(s, [9, 0], [9, 20]);
    expect(s.coords()).toEqual([[9, 20], [18, 0], [100, 0]]);
  });
  it('deletes a selected interior vertex and clears selection', () => {
    const s = setup(); drag(s, [100, 0], [100, 0]); s.controller.deleteSelectedVertex();
    expect(s.coords()).toEqual([[0, 0], [200, 0]]); expect(s.complete).toHaveLength(1); expect(s.selection.at(-1)).toBeNull();
  });
  it('refuses endpoint deletion, two-point deletion and a degenerate result without completion', () => {
    const s = setup([[0, 0], [100, 0]]); drag(s, [0, 0], [0, 0]); s.controller.deleteSelectedVertex();
    expect(s.coords()).toEqual([[0, 0], [100, 0]]); expect(s.complete).toEqual([]);
    const loop = setup([[0, 0], [100, 0], [0, 0]]); drag(loop, [100, 0], [100, 0]); loop.controller.deleteSelectedVertex();
    expect(loop.coords()).toEqual([[0, 0], [100, 0], [0, 0]]); expect(loop.complete).toEqual([]);
  });
  it('translates a whole two-point segment rigidly while retaining its outside endpoints', () => {
    const s = setup([[0, 0], [100, 0]], 'segment'); s.event('pointerdown', [50, 0]); s.event('pointerdrag', [60, 20]); s.event('pointerdrag', [70, 30]); s.event('pointerup', [70, 30]);
    const c = s.coords(); expect(c).toHaveLength(4); c.forEach((p, i) => { expect(p[0]).toBeCloseTo([0, 20, 120, 100][i]!); expect(p[1]).toBeCloseTo([0, 30, 30, 0][i]!, 6); });
    expect(s.complete).toHaveLength(1);
  });
  it('does not commit zero delta', () => { const s = setup(undefined, 'segment'); drag(s, [50, 0], [50, 0]); expect(s.complete).toEqual([]); });
  it.each(['escape', 'pointercancel', 'cancel', 'destroy'])('restores snapshot on %s and ignores later pointerup', (method) => {
    const s = setup(); s.event('pointerdown', [100, 0]); s.event('pointerdrag', [130, 50]);
    expect(s.coords()[1]).toEqual([130, 50]);
    if (method === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (method === 'pointercancel') s.map.getViewport().dispatchEvent(new Event('pointercancel'));
    else s.controller[method as 'cancel' | 'destroy']();
    s.event('pointerup', [130, 50]); expect(s.coords()).toEqual([[0, 0], [100, 0], [200, 0]]); expect(s.complete).toEqual([]); expect(s.selection.at(-1)).toBeNull();
    if (method === 'destroy') { expect(s.map.getInteractions().getLength()).toBe(0); expect(s.map.getLayers().getLength()).toBe(0); }
  });
  it('drags a Point without insertion, deletion or segment support', () => {
    const s = setup([[0, 0]], 'vertex', [], true); drag(s, [0, 0], [30, 40]); s.controller.deleteSelectedVertex();
    expect((s.feature.getGeometry() as Point).getCoordinates()).toEqual([30, 40]); expect(s.complete).toHaveLength(1);
    const segment = setup([[0, 0]], 'segment', [], true); drag(segment, [0, 0], [30, 40]); expect(segment.complete).toEqual([]);
  });
  it('restores invalid vertex movement without emitting completion', () => {
    const s = setup([[0, 0], [100, 0]]); drag(s, [0, 0], [100, 0]); expect(s.coords()).toEqual([[0, 0], [100, 0]]); expect(s.complete).toEqual([]);
  });
});

it('retains the end lock after inserting a midpoint', () => {
  const s = setup(undefined, 'vertex', [0, 2]); drag(s, [50, 0], [50, 0]);
  drag(s, [200, 0], [230, 40]); expect(s.coords().at(-1)).toEqual([200, 0]); expect(s.complete).toHaveLength(1);
});

it('snaps the segment handle anchor and applies one rigid delta to both vertices', () => {
  const node = new Feature(new Point([75, 35])); node.setId('other');
  const s = setup([[0, 0], [100, 0]], 'segment', [], false, [node], { node: true, vertex: false, edge: false });
  drag(s, [50, 0], [70, 30]);
  const c = s.coords(); expect(c).toHaveLength(4); expect(c[1]![0]).toBeCloseTo(25); expect(c[1]![1]).toBeCloseTo(35, 6); expect(c[2]![0]).toBeCloseTo(125); expect(c[2]![1]).toBeCloseTo(35, 6);
});
it('excludes the edited feature and handles from vertex snap and keeps unrelated assets unchanged', () => {
  const node = new Feature(new Point([300, 300])); node.setId('other');
  const s = setup(undefined, 'vertex', [], false, [node], { node: true, vertex: true, edge: true });
  drag(s, [100, 0], [104, 5]); expect(s.coords()[1]).toEqual([104, 5]);
  // [50, 0] is an insertion handle, which is not an asset snap target.
  drag(s, [104, 5], [50, 5]); expect(s.coords()[1]).toEqual([50, 5]);
  expect((node.getGeometry() as Point).getCoordinates()).toEqual([300, 300]);
});
it('supports edge snapping and respects all-off configuration', () => {
  const pipe = new Feature(new LineString([[250, 0], [350, 0]])); pipe.setId('other');
  const s = setup(undefined, 'vertex', [], false, [pipe], { node: false, vertex: false, edge: true });
  drag(s, [100, 0], [300, 5]); expect(s.coords()[1]).toEqual([300, 0]);
  const off = setup(undefined, 'vertex', [], false, [pipe]); drag(off, [100, 0], [300, 5]); expect(off.coords()[1]).toEqual([300, 5]);
});
it('uses a ten CSS pixel handle tolerance independently of view resolution', () => {
  const s = setup(); s.map.getView().setResolution(100);
  vi.mocked(s.map.getPixelFromCoordinate).mockImplementation((c) => [c[0]! * 2, c[1]! * 2]);
  s.event('pointerdown', [211, 0]); s.event('pointerdrag', [140, 40]); s.event('pointerup', [140, 40]);
  expect(s.complete).toEqual([]);
  s.event('pointerdown', [209, 0]); s.event('pointerdrag', [140, 40]); s.event('pointerup', [140, 40]);
  expect(s.coords()[1]).toEqual([140, 40]); expect(s.complete).toHaveLength(1);
});
it('cancels when the target feature geometry is replaced directly and cleans up listeners on destroy', () => {
  const s = setup(); s.event('pointerdown', [100, 0]); s.event('pointerdrag', [140, 40]);
  s.feature.setGeometry(new LineString([[0, 0], [100, 70], [200, 0]])); s.event('pointerup', [140, 40]);
  expect(s.coords()[1]).toEqual([100, 70]); expect(s.complete).toEqual([]);
  s.controller.destroy(); const count = s.selection.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); s.map.getViewport().dispatchEvent(new Event('pointercancel'));
  s.feature.setGeometry(new LineString([[0, 0], [100, 80], [200, 0]])); expect(s.selection).toHaveLength(count);
});

it('prevents handle release from becoming an unrelated asset click', () => {
  const s = setup(); s.event('pointerdown', [50, 0]);
  const release = s.event('pointerup', [50, 0]); expect(release.defaultPrevented).toBe(true);
  s.event('pointerdown', [100, 0]); s.controller.cancel();
  expect(s.event('pointerup', [100, 0]).defaultPrevented).toBe(true);
});

it.each([0, 1, 2])('keeps the exact outside endpoints while translating segment %s', (index) => {
  const coordinates = [[10000, 20000], [10100, 20000], [10200, 20000], [10300, 20000]];
  const s = setup(coordinates, 'segment'); const handle = [10050 + index * 100, 20000];
  drag(s, handle, [handle[0]! + 20, 20030]);
  expect(s.coords()[0]).toEqual([10000, 20000]); expect(s.coords().at(-1)).toEqual([10300, 20000]);
  expect(s.complete).toHaveLength(1);
});

it.each([
  { point: false, snap: false }, { point: false, snap: true },
  { point: true, snap: false }, { point: true, snap: true },
])('selects an off-center handle without moving it (Point=$point, snap=$snap)', ({ point: isPoint, snap }) => {
  const nearby = new Feature(new Point([107, 3])); nearby.setId('snap-target');
  const original = isPoint ? [[100, 0]] : [[0, 0], [100, 0], [200, 0]];
  const s = setup(original, 'vertex', [], isPoint, [nearby], { node: snap, vertex: snap, edge: snap });
  s.event('pointerdown', [105, 0]); s.event('pointerup', [105, 0]);
  expect(isPoint ? [(s.feature.getGeometry() as Point).getCoordinates()] : s.coords()).toEqual(original);
  expect(s.complete).toEqual([]); expect(s.selection.at(-1)).toEqual({ featureId: 'pipe', vertexIndex: isPoint ? 0 : 1 });
});
it.each([
  { index: 1, neighbor: 0, locked: [] }, { index: 1, neighbor: 2, locked: [] },
  { index: 1, neighbor: 0, locked: [0, 4] }, { index: 3, neighbor: 4, locked: [0, 4] },
])('clears a collapsed vertex selection before deletion (index=$index, neighbor=$neighbor, locks=$locked)', ({ index, neighbor, locked }) => {
  const original = [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]];
  const s = setup(original, 'vertex', locked);
  drag(s, original[index]!, original[neighbor]!);
  expect(s.coords()).toHaveLength(4); expect(s.selection.at(-1)).toBeNull(); expect(s.complete).toHaveLength(1);
  const collapsed = s.coords(); s.controller.deleteSelectedVertex();
  expect(s.coords()).toEqual(collapsed); expect(s.complete).toHaveLength(1);
  expect(s.coords()[0]).toEqual([0, 0]); expect(s.coords().at(-1)).toEqual([400, 0]);
});


it('Alt-click deletes an interior vertex once and consumes drag/release without moving another vertex', () => {
  const s = setup();
  s.event('pointerdown', [100, 0], { altKey: true });
  expect(s.coords()).toEqual([[0, 0], [200, 0]]);
  s.event('pointerdrag', [150, 50], { altKey: true });
  expect(s.event('pointerup', [150, 50], { altKey: true }).defaultPrevented).toBe(true);
  s.event('pointerup', [150, 50], { altKey: true });
  expect(s.coords()).toEqual([[0, 0], [200, 0]]);
  expect(s.complete).toHaveLength(1); expect(s.selection.at(-1)).toBeNull();
});
it.each([
  { coords: [[0, 0], [100, 0], [200, 0]], hit: [0, 0], locks: [] },
  { coords: [[0, 0], [100, 0], [200, 0]], hit: [200, 0], locks: [0, 2] },
  { coords: [[0, 0], [100, 0]], hit: [0, 0], locks: [] },
  { coords: [[0, 0], [100, 0], [0, 0]], hit: [100, 0], locks: [] },
])('Alt-click rejects endpoint/minimum/locked/degenerate deletion ($hit, $locks)', ({ coords, hit, locks }) => {
  const s = setup(coords, 'vertex', locks);
  s.event('pointerdown', hit, { altKey: true }); s.event('pointerdrag', [150, 50], { altKey: true });
  expect(s.event('pointerup', [150, 50], { altKey: true }).defaultPrevented).toBe(true);
  expect(s.coords()).toEqual(coords); expect(s.complete).toEqual([]);
});
it('Alt-click on a midpoint does not insert or delete a previously selected vertex', () => {
  const s = setup(); drag(s, [100, 0], [100, 0]);
  s.event('pointerdown', [50, 0], { altKey: true }); s.event('pointerup', [50, 0], { altKey: true });
  expect(s.coords()).toEqual([[0, 0], [100, 0], [200, 0]]); expect(s.complete).toEqual([]);
});
it.each(['input', 'textarea', 'select', 'editable', 'composing', 'ime229'])('bubbling Escape from %s retains selection and preview until normal map Escape', (kind) => {
  const s = setup();
  const host = document.createElement(kind === 'editable' ? 'div' : ['composing', 'ime229'].includes(kind) ? 'span' : kind);
  if (kind === 'editable') host.setAttribute('contenteditable', 'true');
  const child = kind === 'editable' ? host.appendChild(document.createElement('span')) : host;
  document.body.appendChild(host);
  try {
    s.event('pointerdown', [100, 0]); s.event('pointerdrag', [130, 50]);
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: kind === 'composing', keyCode: kind === 'ime229' ? 229 : 0 }));
    expect(s.coords()[1]).toEqual([130, 50]);
    expect(s.selection.at(-1)).toEqual({ featureId: 'pipe', vertexIndex: 1 }); expect(s.complete).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    s.event('pointerup', [130, 50]);
    expect(s.coords()).toEqual([[0, 0], [100, 0], [200, 0]]); expect(s.selection.at(-1)).toBeNull(); expect(s.complete).toEqual([]);
  } finally { host.remove(); }
});
