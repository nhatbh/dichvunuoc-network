// Pumps, storage, supply and assemblies. Facilities are fixed-size site models;
// `dn` sets the size of their inlet/outlet connections.
import * as THREE from 'three';
import { AX, Ctx, M, V, outerDiameter } from './core.js';
import type { BuildOptions } from './core.js';
import { gateValve, prv } from './valves.js';

const base = (code: string, o: BuildOptions, dnDefault: number) => {
  const dn = o.dn ?? dnDefault;
  return { c: new Ctx(code, dn, o.segments ?? 20), dn, od: outerDiameter(dn), r: outerDiameter(dn) / 2 };
};
/** Copy a sub-component into a context at an offset; its ports are not exposed. */
function place(c: Ctx, sub: THREE.Group, at: THREE.Vector3, rotY = 0) {
  sub.position.copy(at); sub.rotation.y = rotY; sub.userData = {}; c.g.add(sub);
}

export function pump(o: BuildOptions) {
  const { c, dn, od, r } = base('Pump', o, 150);
  const s = Math.max(0.35, od * 3);                                    // overall scale
  c.box(s * 2.6, s * 0.08, s * 0.9, M.dark(), V(s * 0.6, s * 0.04, 0));               // base plate
  c.cylC(s * 0.42, s * 0.3, M.epoxy(), V(0, s * 0.55, 0), AX.x);                       // volute
  c.cylC(s * 0.2, s * 0.25, M.epoxy(), V(s * 0.25, s * 0.55, 0), AX.x);
  c.box(s * 0.35, s * 0.3, s * 0.3, M.tint(0xf0b429), V(s * 0.55, s * 0.55, 0));        // coupling guard
  c.cyl(s * 0.3, s * 0.3, s * 1.0, M.tint(0x3a6e5c), V(s * 0.72, s * 0.55), AX.x);       // motor
  for (let i = 0; i < 5; i++) c.cylC(s * 0.32, s * 0.03, M.tint(0x3a6e5c), V(s * 0.85 + i * s * 0.18, s * 0.55), AX.x);
  c.box(s * 0.2, s * 0.15, s * 0.22, M.tint(0x3a6e5c), V(s * 1.1, s * 0.9, 0));         // terminal box
  for (const x of [s * 0.1, s * 1.5]) c.box(s * 0.12, s * 0.25, s * 0.6, M.dark(), V(x, s * 0.2, 0));
  // suction (axial, -X) and discharge (top, +Y)
  c.cyl(r, r, s * 0.35, M.epoxy(), V(-s * 0.15, s * 0.55), AX.nx); c.flange(V(-s * 0.5, s * 0.55), AX.nx, dn);
  c.cyl(r * 0.85, r * 0.85, s * 0.4, M.epoxy(), V(0, s * 0.9), AX.y); c.flange(V(0, s * 1.3), AX.y, dn);
  c.port('Suction', V(-s * 0.5, s * 0.55), AX.nx); c.port('Discharge', V(0, s * 1.3), AX.y);
  return c.finish();
}

export function boosterStation(o: BuildOptions) {
  const { c, dn, r } = base('BoosterStation', o, 150);
  const W = 2.4;
  c.box(W + 0.4, 0.12, 1.6, M.dark(), V(0, 0.06, 0));
  c.cyl(r, r, W + 0.6, M.pipe('Steel'), V(-W / 2 - 0.3, 0.35, 0.55), AX.x);             // suction manifold
  c.cyl(r, r, W + 0.6, M.pipe('Steel'), V(-W / 2 - 0.3, 0.95, -0.55), AX.x);            // discharge manifold
  c.flange(V(-W / 2 - 0.3, 0.35, 0.55), AX.nx, dn); c.flange(V(W / 2 + 0.3, 0.95, -0.55), AX.x, dn);
  for (let i = 0; i < 3; i++) {
    const x = -W / 3 + i * W / 3;
    c.cyl(0.11, 0.11, 0.7, M.stainless(), V(x, 0.12), AX.y);                               // multistage pump
    c.cyl(0.14, 0.14, 0.4, M.tint(0x3a6e5c), V(x, 0.82), AX.y);                            // motor
    c.cyl(0.04, 0.04, 0.5, M.pipe('Steel'), V(x, 0.35, 0.05), AX.z, 10);
    c.cyl(0.04, 0.04, 0.5, M.pipe('Steel'), V(x, 0.95 - 0.0, -0.05), AX.nz, 10);
  }
  c.box(0.5, 0.9, 0.3, M.cabinet(), V(W / 2 + 0.1, 0.57, 0.55));                          // VSD panel
  c.sphere(0.02, M.white(), V(W / 2 + 0.2, 0.85, 0.71), 'status');
  c.port('Suction', V(-W / 2 - 0.3, 0.35, 0.55), AX.nx); c.port('Discharge', V(W / 2 + 0.3, 0.95, -0.55), AX.x);
  return c.finish();
}

export function prvStation(o: BuildOptions) {
  const { c, dn, r } = base('PRVStation', o, 150);
  const seg = o.segments ?? 20, L = 3.2, h = 0.5;
  const bdn = Math.max(50, Math.round(dn / 2 / 25) * 25), rb = outerDiameter(bdn) / 2;
  c.box(L + 0.6, 0.15, 1.8, M.concrete(), V(0, -0.075, 0));                                // chamber floor
  for (const s of [-1, 1]) c.box(L + 0.6, 0.5, 0.15, M.concrete(), V(0, 0.18, s * 0.9));
  c.cyl(r, r, L, M.pipe('DuctileIron'), V(-L / 2, h), AX.x);
  place(c, gateValve({ dn, segments: seg }), V(-L * 0.32, h, 0));
  place(c, prv({ dn, segments: seg }), V(0, h, 0));
  place(c, gateValve({ dn, segments: seg }), V(L * 0.32, h, 0));
  const z = -0.55;                                                                           // bypass loop
  c.tube([V(-L * 0.45, h, 0), V(-L * 0.45, h, z * 0.6), V(-L * 0.4, h, z), V(L * 0.4, h, z), V(L * 0.45, h, z * 0.6), V(L * 0.45, h, 0)], rb, M.epoxy());
  place(c, gateValve({ dn: bdn, segments: seg }), V(0, h, z));
  c.port('A', V(-L / 2, h), AX.nx); c.port('B', V(L / 2, h), AX.x);
  return c.finish();
}

export function reservoir(o: BuildOptions) {
  const { c, dn, r } = base('Reservoir', o, 400);
  const W = 16, D = 12, H = 4;
  c.box(W, H, D, M.concrete(), V(0, H / 2 - 2.6, 0));                                        // mostly buried
  c.box(W + 0.4, 0.3, D + 0.4, M.concreteDark(), V(0, H - 2.6 + 0.15, 0));
  for (const x of [-5, 5]) c.box(1.0, 0.25, 1.0, M.dark(), V(x, H - 2.6 + 0.42, -3));        // hatches
  for (const x of [-3, 0, 3]) {                                                              // vents
    c.cyl(0.12, 0.12, 0.8, M.concreteDark(), V(x, H - 2.6 + 0.3, 3), AX.y, 12);
    c.sphere(0.35, M.concreteDark(), V(x, H - 2.6 + 1.1, 3), undefined, Math.PI * 2, Math.PI / 2);
  }
  c.cyl(r, r, 1.5, M.pipe('DuctileIron'), V(-W / 2, -1.6), AX.nx); c.flange(V(-W / 2 - 1.5, -1.6), AX.nx, dn);
  c.cyl(r, r, 1.5, M.pipe('DuctileIron'), V(W / 2, -2.2), AX.x); c.flange(V(W / 2 + 1.5, -2.2), AX.x, dn);
  c.port('Inlet', V(-W / 2 - 1.5, -1.6), AX.nx); c.port('Outlet', V(W / 2 + 1.5, -2.2), AX.x);
  return c.finish();
}

export function tank(o: BuildOptions) {
  const { c, dn, r } = base('Tank', o, 300);
  const Hl = 16, R = 5, Ht = 5, legR = 4.2;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * legR, z = Math.sin(a) * legR;
    c.cyl(0.3, 0.3, Hl, M.concrete(), V(x, 0, z), AX.y, 10);
    const a2 = a + Math.PI / 2, x2 = Math.cos(a2) * legR, z2 = Math.sin(a2) * legR;
    for (const y of [Hl * 0.33, Hl * 0.66]) {
      const p1 = V(x, y, z), p2 = V(x2, y, z2), d = p2.clone().sub(p1);
      c.cyl(0.15, 0.15, d.length(), M.concrete(), p1, d, 8);
    }
  }
  c.cyl(r * 1.1, r * 1.1, Hl, M.pipe('Steel'), V(0, 0), AX.y, 12);                           // riser
  c.cyl(R * 0.35, R, R * 0.7, M.concrete(), V(0, Hl - 0.2), AX.y);                            // cone bottom
  c.cyl(R, R, Ht, M.concrete(), V(0, Hl + R * 0.7 - 0.2), AX.y);
  const dome = c.sphere(R, M.concreteDark(), V(0, Hl + R * 0.7 + Ht - 0.2), undefined, Math.PI * 2, Math.PI / 2); dome.scale.y = 0.35;
  c.box(1.2, 0.2, 0.2, M.dark(), V(0, Hl + 2, R + 0.05));
  c.flange(V(0, 0), AX.ny, dn);
  c.port('A', V(0, 0), AX.ny);
  return c.finish();
}

export function pumpStation(o: BuildOptions) {
  const { c, dn, r } = base('PumpStation', o, 300);
  const W = 10, D = 7, H = 4.5;
  c.box(W, H, D, M.cabinet(), V(0, H / 2, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.62, D * 0.62, W + 0.6, 3, 1), M.roof());
  roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 2 + Math.PI / 6; roof.scale.set(1, 1, 0.38);
  roof.position.set(0, H + 0.6, 0); c.add(roof);
  c.box(2.4, 3, 0.1, M.roof(), V(-2, 1.5, D / 2 + 0.05));                                     // roller door
  for (let i = 0; i < 3; i++) c.box(1.0, 0.6, 0.08, M.dark(), V(1.5 + i * 1.4, 3.2, D / 2 + 0.04)); // louvres
  c.box(W + 1, 0.2, D + 1, M.concrete(), V(0, 0.1, 0));
  c.cyl(r, r, 2, M.pipe('DuctileIron'), V(-W / 2, 0.8), AX.nx); c.flange(V(-W / 2 - 2, 0.8), AX.nx, dn);
  c.cyl(r, r, 2, M.pipe('DuctileIron'), V(W / 2, 0.8), AX.x); c.flange(V(W / 2 + 2, 0.8), AX.x, dn);
  c.port('Suction', V(-W / 2 - 2, 0.8), AX.nx); c.port('Discharge', V(W / 2 + 2, 0.8), AX.x);
  return c.finish();
}

export function source(o: BuildOptions) {
  const { c, dn, r } = base('Source', o, 600);
  c.box(14, 6, 9, M.cabinet(), V(-6, 3, 0));                                                  // treatment hall
  c.box(14.4, 0.4, 9.4, M.roof(), V(-6, 6.2, 0));
  for (const z of [-7, 7]) {                                                                  // clarifiers
    c.cyl(4.5, 4.5, 2.5, M.concrete(), V(6, 0, z), AX.y, 32);
    c.cyl(4.2, 4.2, 0.05, M.water(), V(6, 2.3, z), AX.y, 32);
    c.box(9, 0.15, 0.6, M.dark(), V(6, 2.8, z));
  }
  c.cyl(r, r, 4, M.pipe('DuctileIron'), V(1, 0.6, 0), AX.x); c.flange(V(5, 0.6, 0), AX.x, dn);
  c.port('Outlet', V(5, 0.6, 0), AX.x);
  return c.finish();
}
