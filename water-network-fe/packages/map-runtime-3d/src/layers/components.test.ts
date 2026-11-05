import { afterEach, describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import * as deckModels from '@wn/component-models/deck';
import { IconAtlas } from './icon-atlas.js';
import { prepareLayer, type PrepareContext } from './prepare-layer.js';
import { buildDeckLayers } from './build-deck-layers.js';
import { buildComponentLayers, componentModelsLoaded, loadComponentModels, setComponentModelsForTesting } from './components.js';
import type { FeatureStyle3D } from '../port/map-engine-3d-port.js';

const ctx = (): PrepareContext => ({ selectedId: null, preview: new Map(), isDraft: false, atlas: new IconAtlas(), groundZ: null });
const fc = (...features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });
const point = (id: string, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, id, properties: props, geometry: { type: 'Point' as const, coordinates: [105.8, 21] } });

const valveStyle = (over: Partial<NonNullable<FeatureStyle3D['component']>> = {}): FeatureStyle3D => ({
  image: { shape: 'diamond', radius: 5, color: '#fff', stroke: '#0E7C86' },
  solid: { shape: 'box', size: [1, 1, 1], color: '#0969DA' },
  component: { code: 'GateValve', dn: 200, bearing: 30, scale: 10, ...over },
});
const ids = (layers: { id: string }[]) => layers.map((l) => l.id);

afterEach(() => setComponentModelsForTesting(null));

describe('catalog components: prepare', () => {
  it('records the component, its symbol, and marks the stand-in solid', () => {
    const out = prepareLayer(fc(point('v1')), () => valveStyle({ status: 'warning' }), ctx());
    expect(out.components[0]).toMatchObject({ fid: 'v1', code: 'GateValve', dn: 200, bearing: 30, scale: 10, status: 'warning', color: [255, 255, 255, 255] });
    expect(out.symbols[0]).toMatchObject({ fid: 'v1', code: 'GateValve', size: 26, angle: 60 });
    expect(out.solids[0]!.componentFallback).toBe(true);
    expect(out.points).toHaveLength(0); // the catalog symbol replaces the generic image
  });

  it('keeps the image when the symbol is turned off, and tints with the given colour', () => {
    const out = prepareLayer(fc(point('v1')), () => valveStyle({ symbol: false, color: '#FFC400' }), ctx());
    expect(out.symbols).toHaveLength(0);
    expect(out.points[0]!.solid).toBe(true);
    expect(out.components[0]!.color).toEqual([255, 196, 0, 255]);
  });

  it('leaves features without a component unchanged', () => {
    const out = prepareLayer(fc(point('h')), () => ({ image: { shape: 'circle', radius: 3, color: '#000' } }), ctx());
    expect(out.components).toHaveLength(0);
    expect(out.symbols).toHaveLength(0);
    expect(out.points).toHaveLength(1);
  });
});

describe('catalog components: layers', () => {
  const prepared = () => prepareLayer(fc(point('v1'), point('v2'), point('h1', { k: 'h' })), (p) =>
    p['k'] === 'h' ? ({ component: { code: 'Hydrant', status: 'critical' }, solid: { shape: 'cylinder', size: [0.3, 0.3, 0.9] } } as FeatureStyle3D) : valveStyle(), ctx());
  const entry = (data = prepared()) => [{ id: 'wn:valves', data, pickable: true }];

  it('draws symbols on the flat map: pipe-aligned ones turn, point ones face the camera', () => {
    const layers = buildDeckLayers(entry(), new IconAtlas().snapshot(), { solids: false });
    expect(ids(layers)).toEqual(expect.arrayContaining(['wn:valves:sym-pipe', 'wn:valves:sym']));
    const pipe = layers.find((l) => l.id === 'wn:valves:sym-pipe')!;
    expect((pipe.props as unknown as { billboard: boolean }).billboard).toBe(false);
    expect(ids(layers).some((id) => id.includes(':cm:'))).toBe(false);
  });

  it('shows the stand-in solids while the models load, then swaps in the real meshes', () => {
    expect(componentModelsLoaded()).toBe(false);
    const before = buildDeckLayers(entry(), new IconAtlas().snapshot(), { solids: true });
    expect(ids(before)).toEqual(expect.arrayContaining(['wn:valves:solid-box', 'wn:valves:solid-cylinder']));
    expect(ids(before).some((id) => id.includes(':cm:'))).toBe(false);

    setComponentModelsForTesting(deckModels);
    const after = buildDeckLayers(entry(), new IconAtlas().snapshot(), { solids: true });
    expect(ids(after)).toEqual(expect.arrayContaining(['wn:valves:cm:GateValve|200|', 'wn:valves:cm:Hydrant||', 'wn:valves:cm-status:Hydrant||']));
    expect(ids(after).some((id) => id.startsWith('wn:valves:solid'))).toBe(false);
    expect(ids(after).some((id) => id.includes(':sym'))).toBe(false);
  });

  it('groups instances per code and size, lifts in-line devices onto the tube axis, colours status parts', () => {
    setComponentModelsForTesting(deckModels);
    const layers = buildComponentLayers('x', prepared().components, true);
    const valves = layers.find((l) => l.id === 'x:cm:GateValve|200|')!;
    const props = valves.props as unknown as { data: unknown[]; getPosition: (d: unknown) => number[]; getTransformMatrix: (d: unknown) => number[] };
    expect(props.data).toHaveLength(2);
    expect(props.getPosition(props.data[0])[2]).toBeCloseTo((0.2 * 10) / 2); // DN200 x scale 10, half
    const m = props.getTransformMatrix(props.data[0]);
    expect(Math.hypot(m[0]!, m[1]!, m[2]!)).toBeCloseTo(10);                 // scaled
    const status = layers.find((l) => l.id === 'x:cm-status:Hydrant||')!;
    const sp = status.props as unknown as { data: unknown[]; getColor: (d: unknown) => number[] };
    expect(sp.getColor(sp.data[0]).slice(0, 3)).toEqual([224, 69, 58]);
  });

  it('ignores unknown codes instead of throwing', () => {
    setComponentModelsForTesting(deckModels);
    const out = prepareLayer(fc(point('z')), () => ({ component: { code: 'NotAThing' } }) as never, ctx());
    expect(buildComponentLayers('x', out.components, true)).toEqual([]);
  });

  it('loads the models through the lazy entry', async () => {
    const m = await loadComponentModels();
    expect(typeof m.componentMesh).toBe('function');
    expect(componentModelsLoaded()).toBe(true);
  });
});
