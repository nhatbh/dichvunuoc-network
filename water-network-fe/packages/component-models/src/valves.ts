// Valves. In-line valves split a pipe (ports A upstream, B downstream); air valves and
// washouts are node devices with a single base port pointing down into the main.
import * as THREE from 'three';
import { AX, Ctx, M, V, outerDiameter, flangeDiameter } from './core.js';
import type { BuildOptions } from './core.js';

const base = (code: string, o: BuildOptions, dnDefault = 150) => {
  const dn = o.dn ?? dnDefault;
  return { c: new Ctx(code, dn, o.segments ?? 20), dn, od: outerDiameter(dn), r: outerDiameter(dn) / 2, fd: flangeDiameter(dn) };
};
function flangedEnds(c: Ctx, L: number, dn: number, r: number, neck = 0.22) {
  for (const s of [-1, 1]) {
    c.cyl(r * 1.08, r * 1.08, L * neck, M.epoxy(), V(s * L / 2), s > 0 ? AX.nx : AX.x);
    c.flange(V(s * L / 2), s > 0 ? AX.x : AX.nx, dn);
  }
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
}

export function gateValve(o: BuildOptions) {
  const { c, dn, od, r, fd } = base('GateValve', o);
  const L = od * 1.6 + 0.1, H = od * 1.5 + 0.06;
  flangedEnds(c, L, dn, r, 0.25);
  const body = c.cylC(fd * 0.48, L * 0.55, M.epoxy(), V(), AX.x); body.scale.set(1, 1, 0.8);
  c.cyl(fd * 0.32, fd * 0.26, H, M.epoxy(), V(0, 0), AX.y);           // body + bonnet
  c.cyl(fd * 0.34, fd * 0.34, od * 0.08, M.epoxy(), V(0, H * 0.55), AX.y);
  const top = H + 0.01;
  if (o.handwheel !== false) {
    c.cyl(0.008 + dn * 0.00006, 0.008 + dn * 0.00006, od * 0.6, M.stainless(), V(0, top), AX.y, 8);
    c.handwheel(V(0, top + od * 0.6), AX.y, Math.max(0.08, fd * 0.55));
  } else c.operatorNut(V(0, top), 0.05);
  return c.finish();
}

export function butterflyValve(o: BuildOptions) {
  const { c, dn, od, fd } = base('ButterflyValve', o, 300);
  const L = Math.max(od * 0.5, 0.1);
  c.cylC(fd * 0.5, L, M.epoxy(), V(), AX.x);
  c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  const neck = fd * 0.5 + od * 0.15;
  c.cyl(od * 0.09, od * 0.09, od * 0.2, M.epoxy(), V(0, fd * 0.45), AX.y);
  const gb = Math.max(0.12, od * 0.42);
  c.box(gb, gb * 0.8, gb, M.epoxy(), V(0, neck + gb * 0.4, 0));          // gearbox
  c.cyl(0.012, 0.012, gb * 0.8, M.stainless(), V(0, neck + gb * 0.4, gb / 2), AX.z, 8);
  c.handwheel(V(0, neck + gb * 0.4, gb * 1.3), AX.z, gb * 0.7);
  return c.finish();
}

export function ballValve(o: BuildOptions) {
  const { c, dn, od, r } = base('BallValve', o, 50);
  const L = od * 2.6 + 0.04;
  const m = dn <= 50 ? M.brass() : M.epoxy();
  c.cyl(r * 1.15, r * 1.15, L, m, V(-L / 2), AX.x, 6);                  // hex body ends
  c.sphere(r * 1.65, m, V());
  if (dn > 50) { c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn); }
  c.cyl(r * 0.25, r * 0.25, r * 2.2, M.stainless(), V(0, r), AX.y, 8);
  c.box(L * 1.1, r * 0.25, r * 0.5, M.hydrant(), V(L * 0.4, r * 3.2, 0));  // lever
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function checkValve(o: BuildOptions) {
  const { c, dn, od, r, fd } = base('CheckValve', o);
  const L = od * 2.3 + 0.12;
  flangedEnds(c, L, dn, r, 0.2);
  const b = c.cylC(fd * 0.45, L * 0.6, M.epoxy(), V(), AX.x); b.scale.set(1, 1, 0.85);
  c.box(L * 0.45, od * 0.16, fd * 0.6, M.epoxy(), V(0, fd * 0.45, 0));    // cover
  c.cylC(od * 0.1, fd * 0.95, M.epoxy(), V(-L * 0.12, fd * 0.3, 0), AX.z, 12); // hinge shaft boss
  c.box(od * 0.08, od * 0.08, od * 0.9, M.dark(), V(-L * 0.12, fd * 0.3, fd * 0.48 + od * 0.4)); // lever
  c.sphere(od * 0.16, M.dark(), V(-L * 0.12, fd * 0.3, fd * 0.48 + od * 0.85));        // counterweight
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(od * 0.12, od * 0.3, 3), M.white());
  arrow.rotation.z = -Math.PI / 2; arrow.position.set(L * 0.12, fd * 0.45 + od * 0.1, 0); c.add(arrow);
  return c.finish();
}

const CONTROL_TINT = { PRV: 0xe5a00d, PSV: 0x1aa39a, FCV: 0x8a5cd6, AltitudeValve: 0x3f9b4f } as const;
function controlValve(code: keyof typeof CONTROL_TINT, o: BuildOptions) {
  const { c, dn, od, r, fd } = base(code, o);
  const L = od * 2.4 + 0.12;
  flangedEnds(c, L, dn, r, 0.2);
  c.sphere(fd * 0.5, M.epoxy(), V());
  const cy = fd * 0.42;
  c.cyl(fd * 0.62, fd * 0.6, od * 0.22, M.epoxy(), V(0, cy), AX.y);                 // diaphragm cover
  c.cyl(fd * 0.63, fd * 0.63, od * 0.04, M.tint(CONTROL_TINT[code]), V(0, cy + od * 0.1), AX.y); // type band
  c.cyl(od * 0.1, od * 0.08, od * 0.25, M.epoxy(), V(0, cy + od * 0.22), AX.y);
  // pilot circuit
  const px = L * 0.05, pz = fd * 0.75, ps = Math.max(0.05, od * 0.25);
  c.box(ps, ps * 1.4, ps * 0.8, M.stainless(), V(px, cy + od * 0.1, pz));
  c.tube([V(-L * 0.38, 0, r * 0.9), V(-L * 0.38, cy * 0.6, pz), V(px - ps / 2, cy + od * 0.05, pz)], Math.max(0.004, od * 0.025), M.copper());
  c.tube([V(px + ps / 2, cy + od * 0.15, pz), V(L * 0.38, cy * 0.6, pz), V(L * 0.38, 0, r * 0.9)], Math.max(0.004, od * 0.025), M.copper());
  c.tube([V(px, cy + od * 0.1 + ps * 0.7, pz), V(px * 0.5, cy + od * 0.45, pz * 0.5), V(0, cy + od * 0.35, 0)], Math.max(0.004, od * 0.025), M.copper());
  // gauge
  c.cyl(od * 0.02 + 0.003, od * 0.02 + 0.003, od * 0.2, M.brass(), V(L * 0.3, r, 0), AX.y, 8);
  c.cylC(Math.max(0.03, od * 0.16), od * 0.06, M.white(), V(L * 0.3, r + od * 0.3, 0), AX.z, 16);
  if (code === 'AltitudeValve') {
    c.cyl(0.008, 0.008, od * 2.5, M.stainless(), V(-px, cy + od * 0.3, -pz * 0.6), AX.y, 6);
    c.sphere(od * 0.25, M.white(), V(-px, cy + od * 2.8, -pz * 0.6));
  }
  return c.finish();
}
export const prv = (o: BuildOptions) => controlValve('PRV', o);
export const psv = (o: BuildOptions) => controlValve('PSV', o);
export const fcv = (o: BuildOptions) => controlValve('FCV', o);
export const altitudeValve = (o: BuildOptions) => controlValve('AltitudeValve', o);

export function airValve(o: BuildOptions) {
  const { c, dn, od, r } = base('AirValve', o, 80);
  c.flange(V(), AX.ny, dn);
  c.cyl(r * 1.05, r * 1.05, od * 0.6, M.epoxy(), V(), AX.y);                     // isolating spool
  const b = Math.max(r * 1.6, 0.06), H = Math.max(od * 3, 0.28), y0 = od * 0.6;
  c.flange(V(0, y0), AX.y, dn, M.epoxy(), false);
  c.cyl(b, b, H, M.epoxy(), V(0, y0), AX.y);
  c.cyl(b * 1.08, b * 1.08, H * 0.08, M.epoxy(), V(0, y0 + H * 0.45), AX.y);
  const top = c.sphere(b, M.black(), V(0, y0 + H), undefined, Math.PI * 2, Math.PI / 2);
  top.scale.y = 0.5;
  c.tube([V(0, y0 + H + b * 0.4), V(0, y0 + H + b * 0.9), V(b * 0.6, y0 + H + b * 0.95), V(b * 0.9, y0 + H + b * 0.5)], Math.max(0.006, b * 0.16), M.black());
  c.port('A', V(), AX.ny);
  return c.finish();
}

export function washout(o: BuildOptions) {
  const { c, dn, od, r } = base('Washout', o, 80);
  const H = Math.max(0.45, od * 3);
  c.flange(V(), AX.ny, dn);
  c.cyl(r, r, H, M.epoxy(), V(), AX.y);
  // small gate valve on the riser
  const vy = H * 0.45, fd = flangeDiameter(dn);
  c.cylC(fd * 0.42, od * 1.3, M.epoxy(), V(0, vy), AX.y);
  c.cyl(fd * 0.25, fd * 0.2, od * 1.1, M.epoxy(), V(0, vy), AX.z);
  c.operatorNut(V(0, vy, od * 1.1), 0.04);
  // elbow to the outlet
  const R = od * 1.2;
  c.tube([V(0, H), V(0, H + R * 0.6), V(R * 0.4, H + R), V(R, H + R)], r, M.epoxy());
  c.cyl(r, r, od * 1.5, M.epoxy(), V(R, H + R), AX.x);
  c.cyl(r * 1.25, r * 1.25, od * 0.25, M.brass(), V(R + od * 1.5, H + R), AX.x);   // hose coupling
  c.port('A', V(), AX.ny);
  c.port('Outlet', V(R + od * 1.75, H + R), AX.x);
  return c.finish();
}

export function backflowPreventer(o: BuildOptions) {
  const { c, dn, od, r, fd } = base('BackflowPreventer', o, 100);
  const L = od * 5 + 0.3;
  c.cyl(r * 1.05, r * 1.05, L, M.epoxy(), V(-L / 2), AX.x);
  c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn);
  for (const x of [-L * 0.18, L * 0.18]) {
    const b = c.cylC(fd * 0.46, L * 0.24, M.epoxy(), V(x), AX.x); b.scale.set(1, 1, 0.85);
    c.box(L * 0.18, od * 0.14, fd * 0.5, M.epoxy(), V(x, fd * 0.42, 0));
  }
  c.cyl(od * 0.18, od * 0.18, fd * 0.6, M.epoxy(), V(0, -r), AX.ny);                // relief valve
  c.cylC(Math.max(0.05, od * 0.38), od * 0.7, M.epoxy(), V(0, -r - fd * 0.75), AX.y);
  c.cyl(od * 0.15, od * 0.15, od * 0.5, M.epoxy(), V(0, -r - fd * 1.1), AX.ny);
  for (const x of [-L * 0.32, 0, L * 0.32]) c.cyl(0.006, 0.006, r * 1.6, M.brass(), V(x, r * 0.8, r * 0.5), AX.y, 6); // test cocks
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function strainer(o: BuildOptions) {
  const { c, dn, od, r, fd } = base('Strainer', o);
  const L = od * 2.2 + 0.1;
  flangedEnds(c, L, dn, r, 0.2);
  c.cylC(fd * 0.42, L * 0.6, M.epoxy(), V(), AX.x);
  const d = V(1, -1, 0).normalize(), len = od * 1.6 + 0.05;
  c.cyl(fd * 0.32, fd * 0.32, len, M.epoxy(), V(), d);
  c.flange(d.clone().multiplyScalar(len + flangeDiameter(dn) * 0.05), d, dn);
  return c.finish();
}
