// Pipes and fittings: the nodes that make the network connected.
import * as THREE from 'three';
import { AX, Ctx, M, V, bodyMaterial, defaultJoint, nextSmallerDN, outerDiameter, flangeDiameter } from './core.js';
import type { BuildOptions } from './core.js';

const base = (code: string, o: BuildOptions, dnDefault = 150) => {
  const dn = o.dn ?? dnDefault;
  const c = new Ctx(code, dn, o.segments ?? 20);
  return { c, dn, od: outerDiameter(dn), r: outerDiameter(dn) / 2, body: bodyMaterial(o.material), joint: o.joint ?? defaultJoint(o.material) };
};

export function pipe(o: BuildOptions) {
  const { c, dn, r } = base('Pipe', { material: 'DuctileIron', ...o });
  const m = o.material ?? 'DuctileIron', L = o.length ?? 2;
  c.cyl(r, r, L, M.pipe(m), V(-L / 2), AX.x);
  if (m === 'HDPE') for (const a of [0.5, 2.6, 4.7]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(L, r * 0.08, r * 0.12), M.stripe());
    s.position.set(0, Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0); s.rotation.x = -a; c.add(s);
  }
  if (m === 'DuctileIron' || m === 'PVC' || m === 'CastIron' || m === 'Concrete') c.socket(V(L / 2), AX.x, dn, M.pipe(m));
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function junction(o: BuildOptions) {
  const { c, r } = base('Junction', o);
  c.sphere(r * 1.35, M.epoxy(), V());
  return c.finish(true);
}

function branchFitting(code: string, o: BuildOptions, dirs: THREE.Vector3[], reducing = false) {
  const { c, dn, od, r, body, joint } = base(code, o);
  const dnB = reducing ? (o.dn2 ?? nextSmallerDN(dn)) : dn;
  const L = Math.max(od * 2.6, 0.22), rb = outerDiameter(dnB) / 2;
  c.cyl(r * 1.08, r * 1.08, L, body, V(-L / 2), AX.x);
  c.end(V(-L / 2), AX.nx, dn, joint, body); c.end(V(L / 2), AX.x, dn, joint, body);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  dirs.forEach((d, i) => {
    const Lb = Math.max(L / 2, r + 0.08);
    c.cyl(rb * 1.08, rb * 1.08, Lb, body, V(), d);
    const p = d.clone().multiplyScalar(Lb);
    c.end(p, d, dnB, joint, body);
    c.port(i === 0 ? 'C' : 'D', p, d, dnB);
  });
  return c.finish();
}
export const tee = (o: BuildOptions) => branchFitting('Tee', o, [AX.z]);
export const reducingTee = (o: BuildOptions) => branchFitting('ReducingTee', o, [AX.z], true);
export const cross = (o: BuildOptions) => branchFitting('Cross', o, [AX.z, AX.nz]);

export function bend(o: BuildOptions) {
  const { c, dn, od, r, body, joint } = base('Bend', o);
  const ang = THREE.MathUtils.degToRad(o.angle ?? 90);
  const R = od * 1.0 + r;
  // Arc in the XZ plane: starts at origin heading +X, turns toward +Z.
  const pts: THREE.Vector3[] = [];
  const n = Math.max(6, Math.round(c.seg * ang / Math.PI));
  for (let i = 0; i <= n; i++) { const t = ang * i / n; pts.push(V(R * Math.sin(t), 0, R * (1 - Math.cos(t)))); }
  const curve = new THREE.CatmullRomCurve3(pts);
  c.add(new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, r * 1.06, c.seg, false), body));
  const pEnd = pts[pts.length - 1]!, dEnd = V(Math.cos(ang), 0, Math.sin(ang));
  // straight legs so the joints sit clear of the curve, as on cast socket bends
  const leg = Math.max(od * 0.6, 0.06);
  c.cyl(r * 1.06, r * 1.06, leg, body, V(), AX.nx);
  c.cyl(r * 1.06, r * 1.06, leg, body, pEnd, dEnd);
  const pA = V(-leg), pB = pEnd.clone().addScaledVector(dEnd, leg);
  c.end(pA, AX.nx, dn, joint, body); c.end(pB, dEnd, dn, joint, body);
  c.port('A', pA, AX.nx); c.port('B', pB, dEnd);
  const mid = pts[Math.floor(pts.length / 2)]!.clone().multiplyScalar(-1);
  c.g.children.forEach((ch) => ch.position.add(mid));
  c.ports.forEach((p) => p.position.add(mid));
  return c.finish();
}

export function reducer(o: BuildOptions) {
  const { c, dn, od, r, body, joint } = base('Reducer', o);
  const dn2 = o.dn2 ?? nextSmallerDN(dn), r2 = outerDiameter(dn2) / 2;
  const L = Math.max(od * 2.2, 0.2), col = L * 0.2;
  c.cyl(r * 1.06, r * 1.06, col, body, V(-L / 2), AX.x);
  c.cyl(r * 1.06, r2 * 1.06, L - 2 * col, body, V(-L / 2 + col), AX.x);
  c.cyl(r2 * 1.06, r2 * 1.06, col, body, V(L / 2 - col), AX.x);
  c.end(V(-L / 2), AX.nx, dn, joint, body); c.end(V(L / 2), AX.x, dn2, joint, body);
  c.port('A', V(-L / 2), AX.nx, dn); c.port('B', V(L / 2), AX.x, dn2);
  return c.finish();
}

export function cap(o: BuildOptions) {
  const { c, dn, od, r, body, joint } = base('Cap', o);
  if (joint === 'flanged') {
    const fd = flangeDiameter(dn);
    c.cyl(r * 1.06, r * 1.06, od * 0.5, body, V(), AX.x);
    c.flange(V(0), AX.nx, dn);
    c.cyl(fd / 2, fd / 2, od * 0.12, body, V(od * 0.5), AX.x); // blind flange
  } else {
    const L = Math.max(od * 0.8, 0.08);
    c.cyl(r * 1.12, r * 1.12, L, body, V(), AX.x);
    const dome = c.sphere(r * 1.12, body, V(L), undefined, Math.PI * 2, Math.PI / 2);
    dome.rotation.z = -Math.PI / 2;
  }
  c.port('A', V(), AX.nx);
  return c.finish();
}

export function coupling(o: BuildOptions) {
  const { c, od, r } = base('Coupling', o);
  const L = Math.max(od * 1.4, 0.16), pm = M.pipe(o.material ?? 'DuctileIron');
  c.cyl(r, r, L * 1.6, pm, V(-L * 0.8), AX.x);                // pipe ends inside
  c.cyl(r * 1.2, r * 1.2, L, M.epoxy(), V(-L / 2), AX.x);   // sleeve
  for (const s of [-1, 1]) c.cyl(r * 1.42, r * 1.42, od * 0.14, M.epoxy(), V(s * L / 2 - (s > 0 ? od * 0.14 : 0)), AX.x); // glands
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; c.cylC(r * 0.06 + 0.004, L + od * 0.3, M.bolt(), V(0, Math.cos(a) * r * 1.32, Math.sin(a) * r * 1.32), AX.x, 6); }
  c.port('A', V(-L * 0.8), AX.nx); c.port('B', V(L * 0.8), AX.x);
  return c.finish();
}

export function transition(o: BuildOptions) {
  const { c, dn, od, r } = base('Transition', o);
  const L = Math.max(od * 2.4, 0.24);
  c.cyl(r, r, L / 2, M.pipe('HDPE'), V(-L / 2), AX.x);                    // PE spigot
  c.cyl(r * 1.35, r * 1.35, od * 0.12, M.pipe('HDPE'), V(-od * 0.12), AX.x); // stub-end collar
  c.flange(V(od * 0.02), AX.nx, dn, M.stainless());                          // backing ring
  c.flange(V(od * 0.02), AX.x, dn);                                          // DI flange adapter
  c.cyl(r * 1.08, r * 1.08, L / 2 - od * 0.02, M.epoxy(), V(od * 0.02), AX.x);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function dismantlingJoint(o: BuildOptions) {
  const { c, dn, od, r } = base('DismantlingJoint', o);
  const L = Math.max(od * 1.8, 0.22), fd = flangeDiameter(dn);
  c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn); c.flange(V(0.02), AX.x, dn, M.epoxy(), false);
  c.cyl(r * 1.05, r * 1.05, L, M.epoxy(), V(-L / 2), AX.x);
  c.cyl(r * 1.22, r * 1.22, L * 0.35, M.epoxy(), V(-L * 0.15), AX.x);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; c.cylC(0.008 + dn * 0.00003, L * 1.2, M.bolt(), V(0, Math.cos(a) * fd * 0.42, Math.sin(a) * fd * 0.42), AX.x, 6); }
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function expansionJoint(o: BuildOptions) {
  const { c, dn, od, r } = base('ExpansionJoint', o);
  const L = Math.max(od * 1.6, 0.2);
  c.flange(V(-L / 2), AX.nx, dn, M.pipe('Steel')); c.flange(V(L / 2), AX.x, dn, M.pipe('Steel'));
  const n = 3;
  for (let i = 0; i < n; i++) c.torus(r * 1.12, r * 0.22, M.rubber(), V(-L / 2 + L * (i + 1) / (n + 1)), AX.x);
  c.cyl(r * 1.02, r * 1.02, L, M.rubber(), V(-L / 2), AX.x);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function tappingSaddle(o: BuildOptions) {
  const { c, dn, od, r } = base('TappingSaddle', o);
  const dnB = o.dn2 ?? Math.min(50, nextSmallerDN(dn)), rb = outerDiameter(dnB) / 2;
  const L = Math.max(od * 2.6, 0.3), W = Math.max(od * 0.9, rb * 4);
  c.cyl(r, r, L, M.pipe(o.material ?? 'DuctileIron'), V(-L / 2), AX.x);
  c.cyl(r * 1.1, r * 1.1, W, M.epoxy(), V(-W / 2), AX.x);
  for (const s of [-1, 1]) c.box(W * 0.9, r * 0.25, r * 0.3, M.epoxy(), V(0, -r * 0.2, s * r * 1.15));
  const H = r + Math.max(rb * 3, 0.06);
  c.cyl(rb * 1.4, rb * 1.2, H, M.epoxy(), V(0, r * 0.6), AX.y);
  c.end(V(0, r * 0.6 + H), AX.y, dnB, dnB >= 50 ? 'flanged' : 'plain', M.epoxy());
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x); c.port('C', V(0, r * 0.6 + H), AX.y, dnB);
  return c.finish();
}

export function repairClamp(o: BuildOptions) {
  const { c, od, r } = base('RepairClamp', o);
  const L = Math.max(od * 2.4, 0.3), W = Math.max(od * 1.4, 0.2);
  c.cyl(r, r, L, M.pipe(o.material ?? 'DuctileIron'), V(-L / 2), AX.x);
  c.cyl(r * 1.06, r * 1.06, W, M.stainless(), V(-W / 2), AX.x);
  c.box(W, r * 0.35, r * 0.3, M.stainless(), V(0, r * 1.15, 0));
  for (let i = 0; i < 3; i++) c.cylC(0.006 + r * 0.04, r * 0.7, M.bolt(), V(-W / 3 + i * W / 3, r * 1.15, 0), AX.z, 6);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}
