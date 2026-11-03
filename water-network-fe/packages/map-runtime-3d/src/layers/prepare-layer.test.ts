import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { StyleSpec } from '@wn/map-runtime';
import { IconAtlas } from './icon-atlas.js';
import { prepareLayer, type PrepareContext } from './prepare-layer.js';

const ctx = (over: Partial<PrepareContext> = {}): PrepareContext => ({ selectedId: null, preview: new Map(), isDraft: false, atlas: new IconAtlas(), groundZ: null, ...over });
const fc = (...features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (id: string, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, id, properties: props, geometry: { type: 'LineString' as const, coordinates: [[105.8, 21], [105.801, 21.001]] } });
const point = (id: string, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, id, properties: props, geometry: { type: 'Point' as const, coordinates: [105.8, 21] } });

describe('prepareLayer', () => {
  it('uses kind styles when no spec is registered (selected → red, wider)', () => {
    const a = prepareLayer(fc(line('p1', { kind: 'pipe' })), undefined, ctx());
    expect(a.lines[0]).toMatchObject({ fid: 'p1', width: 3, color: [2, 132, 199, 255] });
    const b = prepareLayer(fc(line('p1', { kind: 'pipe' })), undefined, ctx({ selectedId: 'p1' }));
    expect(b.lines[0]).toMatchObject({ width: 5, color: [239, 68, 68, 255] });
  });

  it('converts dashes, halos, opacity and passes __selected to the spec', () => {
    const spec: StyleSpec = (p) => ({ stroke: { color: '#0E7C86', width: 4, dash: [8, 5] }, halo: p.__selected ? { color: '#ff0000', width: 9 } : undefined, opacity: 0.5 });
    const out = prepareLayer(fc(line('a'), line('b')), spec, ctx({ selectedId: 'b' }));
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]!.dash).toEqual([8, 5]);
    expect(out.lines[0]!.color[3]).toBe(128);
    expect(out.halos).toHaveLength(1);
    expect(out.halos[0]).toMatchObject({ fid: 'b', width: 9 });
  });

  it('turns point images into atlas icons, halos into rings, text into labels', () => {
    const spec: StyleSpec = () => ({
      image: { shape: 'diamond', radius: 5, color: '#fff', stroke: '#0E7C86', strokeWidth: 2 },
      halo: { color: '#f00', width: 2 },
      text: { value: 'V1', font: '11px monospace', color: '#000', offsetY: -12, stroke: '#fff', strokeWidth: 3 },
    });
    const atlas = new IconAtlas();
    const out = prepareLayer(fc(point('v1')), spec, ctx({ atlas }));
    expect(out.points).toHaveLength(1);
    expect(atlas.snapshot().mapping[out.points[0]!.iconKey]).toBeDefined();
    expect(out.pointHalos[0]!.radius).toBeGreaterThan(5);
    expect(out.texts[0]).toMatchObject({ text: 'V1', size: 11, family: 'monospace', offsetY: -12 });
  });

  it('does not draw images for line geometries nor strokes for points (OpenLayers parity)', () => {
    const spec: StyleSpec = () => ({ stroke: { color: '#000', width: 2 }, image: { shape: 'circle', radius: 4, color: '#000' } });
    expect(prepareLayer(fc(line('l')), spec, ctx()).points).toHaveLength(0);
    expect(prepareLayer(fc(point('p')), spec, ctx()).lines).toHaveLength(0);
  });

  it('extrudes points into columns and polygons into blocks (3D style extension)', () => {
    const spec: StyleSpec = () => ({ image: { shape: 'circle', radius: 4, color: '#1A7F37' }, extrude: { height: 30, radius: 8 } }) as never;
    const out = prepareLayer(fc(point('tank')), spec, ctx());
    expect(out.columns[0]).toMatchObject({ height: 30, radius: 8, sides: 16 });
    const poly = { type: 'Feature' as const, id: 'dma', properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[105.8, 21], [105.81, 21], [105.81, 21.01], [105.8, 21]]] } };
    const blocks = prepareLayer(fc(poly), () => ({ fill: '#abc', extrude: { height: 12 } }) as never, ctx());
    expect(blocks.polygons[0]!.height).toBe(12);
  });

  it('applies elevation and drapes + densifies on terrain', () => {
    const flat = prepareLayer(fc(point('p')), () => ({ image: { shape: 'circle', radius: 3, color: '#000' }, elevation: 5 }) as never, ctx());
    expect(flat.points[0]!.position[2]).toBe(5);
    const draped = prepareLayer(fc(line('l')), () => ({ stroke: { color: '#000', width: 2 } }), ctx({ groundZ: (lon) => (lon - 105.8) * 1e5 }));
    const path = draped.lines[0]!.path;
    expect(path.length).toBeGreaterThan(2); // densified
    expect(path.at(-1)![2]).toBeGreaterThan(path[0]![2]);
  });

  it('an edit preview geometry overrides the stored one', () => {
    const preview = new Map([['a', { type: 'LineString' as const, coordinates: [[1, 1], [2, 2]] }]]);
    const out = prepareLayer(fc(line('a')), () => ({ stroke: { color: '#000', width: 2 } }), ctx({ preview }));
    expect(out.lines[0]!.path.map((p) => [p[0], p[1]])).toEqual([[1, 1], [2, 2]]);
  });

  it('skips features without a geometry and draws multi-geometries', () => {
    const multi = { type: 'Feature' as const, id: 'm', properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } };
    const out = prepareLayer(fc(multi, { type: 'Feature', id: 'x', properties: {}, geometry: null as never }), () => ({ stroke: { color: '#000' } }), ctx());
    expect(out.lines).toHaveLength(2);
  });

  it('builds real-size tubes: segment length, radius, flange connectors, bend joints', () => {
    const bent = { type: 'Feature' as const, id: 'p', properties: {}, geometry: { type: 'LineString' as const, coordinates: [[105.8, 21], [105.8009, 21], [105.8009, 21.0009]] } };
    const spec: StyleSpec = () => ({ stroke: { color: '#0e7c86', width: 3 }, tube: { diameterM: 0.4 } } as never);
    const out = prepareLayer(fc(bent), spec, ctx());
    expect(out.lines[0]!.tubed).toBe(true);
    // 2 pipe segments + 2 flanges
    expect(out.tubes).toHaveLength(4);
    const seg = out.tubes[0]!;
    // matrix column 0 is the segment vector: ~93 m east (0.0009° at lat 21)
    expect(Math.hypot(seg.matrix[0]!, seg.matrix[1]!, seg.matrix[2]!)).toBeCloseTo(93.4, 0);
    // columns 1 and 2 are the 0.2 m radius cross-section
    expect(Math.hypot(seg.matrix[4]!, seg.matrix[5]!, seg.matrix[6]!)).toBeCloseTo(0.2, 5);
    // pipe rests on the ground: centreline one radius up
    expect(seg.position[2]).toBeCloseTo(0.2, 5);
    // 90° corner → one elbow joint
    expect(out.joints).toHaveLength(1);
    // flanges are wider than the tube
    expect(Math.hypot(out.tubes[2]!.matrix[4]!, out.tubes[2]!.matrix[5]!, out.tubes[2]!.matrix[6]!)).toBeCloseTo(0.28, 5);
  });

  it('builds point solids (meter box sits on the ground, sphere is centred above it)', () => {
    const box = prepareLayer(fc(point('m')), (() => ({ image: { shape: 'circle', radius: 3, color: '#f80' }, solid: { shape: 'box', size: [0.6, 0.4, 0.5] } })) as never, ctx());
    expect(box.solids[0]).toMatchObject({ shape: 'box', position: [105.8, 21, 0] });
    expect(box.solids[0]!.matrix[0]).toBeCloseTo(0.6);
    expect(box.solids[0]!.matrix[10]).toBeCloseTo(0.5);
    expect(box.points[0]!.solid).toBe(true);
    const ball = prepareLayer(fc(point('s')), (() => ({ solid: { shape: 'sphere', size: [1, 1, 1] } })) as never, ctx());
    expect(ball.solids[0]!.position[2]).toBeCloseTo(0.5);
  });
});
