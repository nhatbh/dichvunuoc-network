import { describe, expect, it } from 'vitest';
import { CATALOG_ITEMS } from './catalog.js';
import { alongMatrix, componentMesh, headingMatrix, symbolAngle, symbolFollowsPipe } from './deck.js';

const apply = (m: number[], v: [number, number, number]) => [
  m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
  m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
  m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2],
];

describe('deck meshes', () => {
  it.each(CATALOG_ITEMS.map((c) => [c.code]))('%s converts to SimpleMeshLayer data', (code) => {
    const m = componentMesh(code, { segments: 8 });
    const P = m.body.attributes.POSITION.value, N = m.body.attributes.NORMAL.value, C = m.body.attributes.COLOR_0!.value;
    expect(P.length % 3).toBe(0);
    expect(N.length).toBe(P.length);
    expect(C.length).toBe(P.length);
    expect(m.body.attributes.TEXCOORD_0.value.length).toBe((P.length / 3) * 2);
    const verts = P.length / 3;
    for (const i of m.body.indices.value) expect(i).toBeLessThan(verts);
    for (const x of P) expect(Number.isFinite(x)).toBe(true);
    for (const c of C) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    expect(!!m.status).toBe(!!CATALOG_ITEMS.find((c) => c.code === code)!.hasStatus);
    expect(m.ports.map((p) => p.id)).toEqual([...CATALOG_ITEMS.find((c) => c.code === code)!.ports]);
    expect(m.triangles).toBeGreaterThan(0);
  });

  it('stands models on +z and keeps in-line ports on the x axis', () => {
    const h = componentMesh('Hydrant');
    let maxZ = -Infinity;
    const P = h.body.attributes.POSITION.value;
    for (let i = 2; i < P.length; i += 3) maxZ = Math.max(maxZ, P[i]!);
    expect(maxZ).toBeGreaterThan(0.7);                       // hydrant is ~0.8 m tall
    expect(h.ports[0]!.direction).toEqual([0, -0, -1]);      // base port points down

    const v = componentMesh('GateValve', { dn: 200 });
    expect(v.ports[0]!.direction[0]).toBeCloseTo(-1);
    expect(v.ports[1]!.direction[0]).toBeCloseTo(1);
    const t = componentMesh('Tee');
    expect(t.ports[2]!.direction[1]).toBeCloseTo(-1);        // branch to the south (right of A->B)
  });

  it('caches by code and options', () => {
    expect(componentMesh('PRV', { dn: 200 })).toBe(componentMesh('PRV', { dn: 200 }));
    expect(componentMesh('PRV', { dn: 200 })).not.toBe(componentMesh('PRV', { dn: 250 }));
  });
});

describe('placement', () => {
  it('turns +x onto the pipe direction and keeps +z up', () => {
    const m = alongMatrix([0, 10, 0]);
    expect(apply(m, [1, 0, 0]).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 1, 0]);
    expect(apply(m, [0, 0, 1])[2]).toBeCloseTo(1);
  });
  it('reads bearings clockwise from north', () => {
    const east = headingMatrix(90);
    expect(apply(east, [1, 0, 0])[0]).toBeCloseTo(1);
    const north = headingMatrix(0);
    expect(apply(north, [1, 0, 0])[1]).toBeCloseTo(1);
  });
  it('gives IconLayer angles counter-clockwise from east', () => {
    expect(symbolAngle([0, 1, 0])).toBeCloseTo(90);
    expect(symbolFollowsPipe('GateValve')).toBe(true);
    expect(symbolFollowsPipe('Hydrant')).toBe(false);
  });
});
