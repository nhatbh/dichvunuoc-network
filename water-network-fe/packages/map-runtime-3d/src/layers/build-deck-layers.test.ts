import { describe, expect, it } from 'vitest';
import { buildDeckLayers, buildFlowArrowLayer } from './build-deck-layers.js';
import { emptyPrepared, type PreparedLayer } from './prepare-layer.js';
import { alongMatrix } from '../core/tube-math.js';

const atlas = { canvas: null, mapping: {}, version: 0 };
const tube = (fid: string, lon: number): PreparedLayer['tubes'][number] => ({ fid, position: [lon, 0, 0.5], matrix: alongMatrix([10, 0, 0], 0.5), color: [0, 0, 255, 255] });
const data = (): PreparedLayer => ({ ...emptyPrepared(), tubes: [tube('near', 0), tube('far', 1)], lines: [{ fid: 'near', path: [[0, 0, 0], [0.001, 0, 0]], color: [0, 0, 255, 255], width: 2, tubed: true }] });
const tubeLayer = (layers: ReturnType<typeof buildDeckLayers>) => layers.find((l) => l.id.endsWith(':tube'));

describe('buildDeckLayers', () => {
  it('reuses the layers of an unchanged entry, so deck.gl does not rebuild their attributes', () => {
    const entries = [{ id: 'wn:pipes', data: data(), pickable: true }];
    const a = buildDeckLayers(entries, atlas, { solids: true, cull: [-0.1, -0.1, 0.1, 0.1] });
    const b = buildDeckLayers(entries, atlas, { solids: true, cull: [-0.1, -0.1, 0.1, 0.1] });
    expect(b).toHaveLength(a.length);
    b.forEach((l, i) => expect(l).toBe(a[i]));
    // a different view box is a new build
    const c = buildDeckLayers(entries, atlas, { solids: true, cull: [0.9, -0.1, 1.1, 0.1] });
    expect(tubeLayer(c)).not.toBe(tubeLayer(a));
  });

  it('only builds 3D solids inside the cull box', () => {
    const entries = [{ id: 'wn:pipes', data: data(), pickable: true }];
    const near = tubeLayer(buildDeckLayers(entries, atlas, { solids: true, cull: [-0.1, -0.1, 0.1, 0.1] }))!;
    expect((near.props.data as Array<{ fid: string }>).map((t) => t.fid)).toEqual(['near']);
    const all = tubeLayer(buildDeckLayers(entries, atlas, { solids: true, cull: null }))!;
    expect((all.props.data as unknown[]).length).toBe(2);
  });
});

describe('buildFlowArrowLayer', () => {
  it('keeps the instance data and only changes the time between frames', () => {
    const arrows = [{ position: [0, 0, 0.5] as [number, number, number], matrix: alongMatrix([1, 0, 0], 0.5), color: [255, 255, 255, 255] as [number, number, number, number], flow: [0, 8, 1, 6] as [number, number, number, number] }];
    const [a] = buildFlowArrowLayer(arrows, 1);
    const [b] = buildFlowArrowLayer(arrows, 2);
    expect(a!.props.data).toBe(b!.props.data);
    expect((a!.props as unknown as { flowTime: number }).flowTime).toBe(1);
    expect((b!.props as unknown as { flowTime: number }).flowTime).toBe(2);
    expect(buildFlowArrowLayer([], 1)).toEqual([]);
  });
});
