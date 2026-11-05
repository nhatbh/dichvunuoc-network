import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, CATALOG_ITEMS, COMPONENT_CODES, createComponent, getPorts, getWorldPorts, placeOnPipe, setStatus, toInstancedParts, triangleCount, clampDN, PipeView, outerDiameter } from './index.js';
import type { Port } from './index.js';

const sizesFor = (min: number, max: number, def: number) => [...new Set([min, def, max])];

describe('catalog', () => {
  it('has unique codes and a 3D builder for every item', () => {
    expect(new Set(COMPONENT_CODES).size).toBe(COMPONENT_CODES.length);
    expect(CATALOG.length).toBe(CATALOG_ITEMS.length);
  });
  it('keeps default DN inside the range', () => {
    for (const c of CATALOG_ITEMS) {
      expect(c.dnRange[0]).toBeLessThanOrEqual(c.defaultDN);
      expect(c.defaultDN).toBeLessThanOrEqual(c.dnRange[1]);
    }
  });
  it('clamps DN and rejects unknown codes', () => {
    expect(clampDN('GateValve', 5000)).toBe(600);
    expect(clampDN('GateValve')).toBe(150);
    expect(() => clampDN('Nope')).toThrow();
    expect(() => createComponent('Nope')).toThrow(/Unknown component code/);
  });
});

describe.each(CATALOG_ITEMS.map((c) => [c.code, c] as const))('%s', (code, item) => {
  for (const dn of sizesFor(item.dnRange[0], item.dnRange[1], item.defaultDN)) {
    it(`builds valid geometry at DN ${dn}`, () => {
      const g = createComponent(code, { dn, segments: 12 });
      let meshes = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const a = m.geometry.attributes.position!.array as Float32Array;
        for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i])).toBe(true);
      });
      expect(meshes).toBeGreaterThan(0);
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      expect(size.length()).toBeGreaterThan(0.01);
      expect(size.length()).toBeLessThan(60);
    });
  }

  it('exposes the ports the catalog declares', () => {
    const g = createComponent(code);
    const ports = getPorts(g);
    expect(ports.map((p) => p.id)).toEqual([...item.ports]);
    for (const p of ports) {
      expect(p.direction.length()).toBeCloseTo(1, 5);
      expect(p.dn).toBeGreaterThan(0);
    }
    if (item.variablePorts) expect((g.userData as { variablePorts?: boolean }).variablePorts).toBe(true);
  });

  it('uses the second DN on the declared ports only', () => {
    if (!item.usesDN2) return;
    const dn = item.dnRange[1] >= 300 ? 300 : item.defaultDN, dn2 = 100;
    const ports = getPorts(createComponent(code, { dn, dn2 }));
    for (const p of ports) expect(p.dn).toBe(item.dn2Ports?.includes(p.id) ? dn2 : dn);
  });

  it('has a status part only when the catalog says so', () => {
    const g = createComponent(code);
    let status = 0;
    g.traverse((o) => { if (o.userData.part === 'status') status++; });
    expect(status > 0).toBe(!!item.hasStatus);
    setStatus(g, 'critical');
  });

  it('merges into instanced parts without losing triangles', () => {
    const g = createComponent(code, { segments: 8 });
    const parts = toInstancedParts(g);
    const merged = parts.reduce((n, p) => n + p.geometry.attributes.position!.count / 3, 0);
    expect(merged).toBe(triangleCount(g));
  });
});

describe('placement', () => {
  it('turns an in-line device so its ports face along the pipe', () => {
    const v = createComponent('GateValve', { dn: 200 });
    const from = new THREE.Vector3(10, 0, 5), to = new THREE.Vector3(10, 0, 15);
    placeOnPipe(v, from, to);
    const [a, b] = getWorldPorts(v) as [Port, Port];
    expect(a.direction.z).toBeCloseTo(-1, 5);
    expect(b.direction.z).toBeCloseTo(1, 5);
    expect(a.position.x).toBeCloseTo(10, 5);
  });
  it('builds a pipe view between two points', () => {
    const pv = new PipeView(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 0, 40), { dn: 200, material: 'HDPE' });
    const box = new THREE.Box3().setFromObject(pv.near);
    expect(box.getSize(new THREE.Vector3()).length()).toBeGreaterThan(49);
    expect(pv.od).toBeCloseTo(outerDiameter(200), 6);
  });
});
