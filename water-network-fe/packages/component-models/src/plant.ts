// Treatment-plant equipment: what a clean-water plant monitors and controls on top of the network catalog
// (online analysers, transmitters, motorised valves, pumps, blowers, mixers, process basins, chemical dosing,
// chlorination, electrical and automation panels). Same conventions as the rest of the catalog: metres,
// +Y up, main axis along X, ports with outward directions, parts tagged 'status' recoloured by setStatus().
// Moving parts (impellers, paddles, fans) sit in a child group named 'rotor' that spins about its local +Y.
import * as THREE from 'three';
import { AX, Ctx, M, V, outerDiameter, flangeDiameter } from './core.js';
import type { BuildOptions } from './core.js';

const base = (code: string, o: BuildOptions, dnDefault: number) => {
  const dn = o.dn ?? dnDefault;
  return { c: new Ctx(code, dn, o.segments ?? 20), dn, od: outerDiameter(dn), r: outerDiameter(dn) / 2 };
};
/** Build into a child group (rotor) by temporarily swapping the context's target group. */
function rotor(c: Ctx, at: THREE.Vector3, build: () => void) {
  const g = c.g, r = new THREE.Group();
  r.name = 'rotor'; r.position.copy(at);
  c.g = r; build(); c.g = g; g.add(r);
  return r;
}
const enclosure = (c: Ctx, w: number, h: number, d: number, at: THREE.Vector3, m = M.cabinet()) => c.box(w, h, d, m, at.clone().add(V(0, h / 2, 0)));

// ---------- online instruments ----------
function analyserCabinet(code: string, o: BuildOptions, label: number) {
  const { c } = base(code, o, 15);
  c.box(0.6, 0.06, 0.4, M.concreteDark(), V(0, 0.03, 0));                         // plinth
  for (const x of [-0.22, 0.22]) c.cyl(0.025, 0.025, 1.0, M.stainless(), V(x, 0.06, -0.12), AX.y, 8);
  c.box(0.6, 0.75, 0.06, M.stainless(), V(0, 1.0, -0.12));                         // back panel
  c.box(0.24, 0.3, 0.12, M.white(), V(-0.14, 1.18, -0.03));                       // controller
  c.box(0.18, 0.11, 0.01, M.glass(), V(-0.14, 1.24, 0.035));
  c.sphere(0.014, M.white(), V(-0.04, 1.3, 0.03), 'status');
  c.cyl(0.05, 0.05, 0.32, M.tint(label), V(0.15, 0.8, -0.03), AX.y, 16);          // measuring cell
  c.cyl(0.055, 0.055, 0.05, M.dark(), V(0.15, 1.12, -0.03), AX.y, 16);
  c.tube([V(0.15, 0.8, -0.03), V(0.15, 0.4, 0.0), V(0, 0.08, 0.05), V(0, 0, 0)], 0.008, M.white());
  c.tube([V(0.22, 0.85, -0.03), V(0.28, 0.5, 0.02), V(0.28, 0.06, 0.02)], 0.008, M.greyPlastic()); // drain
  c.port('A', V(), AX.ny);
  return c.finish();
}
export const turbidityMeter = (o: BuildOptions) => analyserCabinet('TurbidityMeter', o, 0x2c3036);
export const chlorineAnalyser = (o: BuildOptions) => analyserCabinet('ChlorineAnalyser', o, 0x8fc93a);
export const phAnalyser = (o: BuildOptions) => analyserCabinet('PHAnalyser', o, 0x6b4fa8);

export function dpTransmitter(o: BuildOptions) {
  const { c } = base('DPTransmitter', o, 15);
  c.box(0.16, 0.08, 0.1, M.stainless(), V(0, 0.2, 0));                            // manifold
  for (const x of [-0.05, 0.05]) {
    c.cyl(0.008, 0.008, 0.2, M.stainless(), V(x, 0, 0), AX.y, 8);                 // impulse lines
    c.box(0.025, 0.012, 0.012, M.hydrant(), V(x, 0.26, 0.05));                    // needle valves
  }
  c.cyl(0.05, 0.05, 0.07, M.tint(0x2a6fd6), V(0, 0.3, 0), AX.z, 20);              // capsule
  c.cyl(0.045, 0.045, 0.09, M.white(), V(0, 0.33, -0.045), AX.y, 20);             // electronics housing
  c.cyl(0.047, 0.047, 0.015, M.white(), V(0, 0.42, -0.045), AX.y, 20, 'status');
  c.port('High', V(-0.05, 0, 0), AX.ny); c.port('Low', V(0.05, 0, 0), AX.ny);
  return c.finish();
}

export function gasDetector(o: BuildOptions) {
  const { c } = base('GasDetector', o, 15);
  c.box(0.18, 0.22, 0.02, M.greyPlastic(), V(0, 0.11, 0));                        // wall plate
  c.box(0.14, 0.16, 0.08, M.tint(0xf0b429), V(0, 0.12, 0.05));
  c.box(0.08, 0.04, 0.005, M.glass(), V(0, 0.15, 0.092));
  c.cyl(0.025, 0.03, 0.06, M.dark(), V(0, 0.04, 0.05), AX.ny, 12);                // sensor head
  c.sphere(0.012, M.white(), V(0.05, 0.19, 0.09), 'status');
  c.port('Mount', V(), AX.nz);
  return c.finish();
}

export function cctvCamera(o: BuildOptions) {
  const { c } = base('CCTVCamera', o, 15);
  c.cyl(0.05, 0.06, 3.2, M.greyPlastic(), V(), AX.y, 10);                          // pole
  c.box(0.05, 0.05, 0.3, M.white(), V(0, 3.2, 0.12));                              // arm
  const head = c.cyl(0.07, 0.07, 0.32, M.white(), V(0, 3.15, 0.3), AX.z, 16);
  head.rotation.x += 0.35;
  c.cyl(0.05, 0.05, 0.02, M.glass(), V(0, 3.1, 0.47), AX.z, 16);
  c.sphere(0.012, M.white(), V(0.06, 3.22, 0.3), 'status');
  c.port('Mount', V(), AX.ny);
  return c.finish();
}

// ---------- valves ----------
export function motorisedValve(o: BuildOptions) {
  const { c, dn, od } = base('MotorisedValve', o, 300);
  const fd = flangeDiameter(dn), L = Math.max(od * 0.5, 0.1);
  c.cylC(fd * 0.5, L, M.epoxy(), V(), AX.x);                                      // wafer body (butterfly)
  c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn);
  const top = fd * 0.5;
  c.cyl(od * 0.09 + 0.01, od * 0.09 + 0.01, Math.max(0.08, od * 0.2), M.epoxy(), V(0, top - 0.02), AX.y);   // neck
  const a = Math.max(0.26, fd * 0.5), y0 = top + Math.max(0.08, od * 0.2);
  c.box(a * 0.8, 0.06, a * 0.8, M.dark(), V(0, y0, 0));                           // mounting flange
  c.box(a, a * 0.8, a * 0.75, M.tint(0xf0b429), V(0, y0 + 0.03 + a * 0.4, 0));    // electric actuator
  c.cylC(a * 0.22, a * 0.35, M.tint(0xf0b429), V(a * 0.65, y0 + 0.03 + a * 0.4, 0), AX.x); // motor
  c.box(a * 0.35, a * 0.22, 0.01, M.glass(), V(-a * 0.15, y0 + a * 0.5, a * 0.38));
  c.sphere(Math.max(0.015, a * 0.05), M.white(), V(a * 0.25, y0 + a * 0.6, a * 0.38), 'status');
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

// ---------- pumps and air ----------
export function verticalTurbinePump(o: BuildOptions) {
  const { c, dn, r } = base('VerticalTurbinePump', o, 400);
  const s = Math.max(0.6, outerDiameter(dn) * 2.4);
  c.box(s * 1.8, 0.12, s * 1.8, M.dark(), V(0, 0.06, 0));                         // sole plate
  c.cyl(s * 0.45, s * 0.45, s * 0.9, M.epoxy(), V(0, 0.12), AX.y);                // discharge head
  c.cyl(r, r, s * 0.7, M.epoxy(), V(0, 0.12 + s * 0.45), AX.x);                   // discharge nozzle
  c.flange(V(s * 0.7, 0.12 + s * 0.45), AX.x, dn);
  c.cyl(s * 0.32, s * 0.36, s * 0.25, M.epoxy(), V(0, 0.12 + s * 0.9), AX.y);    // motor stand
  c.cyl(s * 0.42, s * 0.42, s * 1.2, M.tint(0x3a6e5c), V(0, 0.12 + s * 1.15), AX.y);
  for (let i = 0; i < 5; i++) c.cylC(s * 0.44, 0.03, M.tint(0x3a6e5c), V(0, 0.3 + s * 1.2 + i * s * 0.2), AX.y);
  c.cyl(s * 0.3, s * 0.18, s * 0.18, M.tint(0x3a6e5c), V(0, 0.12 + s * 2.35), AX.y);
  rotor(c, V(0, 0.12 + s * 2.55, 0), () => {                                       // cooling fan cowl
    c.cyl(s * 0.12, s * 0.12, 0.04, M.dark(), V(), AX.y, 6);
  });
  c.box(s * 0.25, s * 0.2, s * 0.2, M.tint(0x3a6e5c), V(s * 0.45, 0.12 + s * 1.6, 0));     // terminal box
  c.cyl(r * 1.1, r * 1.1, s * 2.5, M.epoxy(), V(0, 0.06), AX.ny);                 // column into the sump
  c.cyl(r * 1.6, r * 1.6, s * 0.7, M.epoxy(), V(0, -s * 2.4), AX.ny);              // bowl
  c.port('Suction', V(0, -s * 3.1), AX.ny); c.port('Discharge', V(s * 0.7, 0.12 + s * 0.45), AX.x);
  return c.finish();
}

export function submersiblePump(o: BuildOptions) {
  const { c, dn, r } = base('SubmersiblePump', o, 150);
  const s = Math.max(0.35, outerDiameter(dn) * 2.2);
  for (const x of [-s * 0.3, s * 0.3]) c.cyl(0.02, 0.02, s * 4, M.stainless(), V(x, -s * 3.6, -s * 0.5), AX.y, 8); // guide rails
  c.cyl(s * 0.32, s * 0.32, s * 0.9, M.tint(0x3a6e5c), V(0, -s * 3.0, 0), AX.y);  // motor
  c.cyl(s * 0.4, s * 0.4, s * 0.35, M.epoxy(), V(0, -s * 3.4, 0), AX.y);           // volute
  c.cyl(r, r, s * 3.2, M.pipe('Steel'), V(0, -s * 3.2, -s * 0.5), AX.y);           // riser
  c.box(s * 1.4, 0.06, s * 1.0, M.stainless(), V(0, 0.03, -s * 0.2));              // access frame
  c.box(s * 1.2, 0.04, s * 0.8, M.dark(), V(0, 0.07, -s * 0.2));
  c.flange(V(0, 0.1, -s * 0.5), AX.y, dn);
  c.cyl(0.012, 0.012, s * 3, M.black(), V(s * 0.2, -s * 2.8, 0), AX.y, 6);        // cable
  c.port('Discharge', V(0, 0.1, -s * 0.5), AX.y);
  return c.finish();
}

export function blower(o: BuildOptions) {
  const { c, dn, r } = base('Blower', o, 300);
  c.box(2.4, 0.15, 1.5, M.dark(), V(0.2, 0.075, 0));
  c.box(2.2, 1.6, 1.3, M.tint(0x4f7d6a), V(0.2, 0.95, 0));                         // acoustic hood
  for (let i = 0; i < 6; i++) c.box(0.05, 1.0, 0.02, M.tint(0x3c5f50), V(-0.5 + i * 0.22, 0.95, 0.66)); // louvres
  c.cyl(0.25, 0.25, 0.5, M.stainless(), V(1.0, 1.75, 0), AX.y);                     // inlet filter
  c.box(0.3, 0.2, 0.01, M.glass(), V(-0.5, 1.45, 0.66));
  c.sphere(0.02, M.white(), V(-0.25, 1.5, 0.66), 'status');
  c.cyl(r, r, 0.8, M.stainless(), V(-0.9, 0.5, 0), AX.nx);                         // discharge + silencer
  c.cylC(r * 1.6, 0.5, M.stainless(), V(-1.2, 0.5, 0), AX.x);
  c.flange(V(-1.7, 0.5, 0), AX.nx, dn);
  c.port('Outlet', V(-1.7, 0.5, 0), AX.nx);
  return c.finish();
}

// ---------- treatment ----------
function agitator(code: string, o: BuildOptions, span: number, depth: number, paddle: 'turbine' | 'paddle') {
  const { c } = base(code, o, 15);
  c.box(span, 0.18, 0.5, M.stainless(), V(0, 0.09, 0));                            // bridge
  c.cyl(0.18, 0.18, 0.4, M.tint(0x2f5d9e), V(0, 0.18), AX.y);                       // gearbox
  c.cyl(0.16, 0.16, 0.5, M.tint(0x3a6e5c), V(0, 0.58), AX.y);                       // motor
  c.sphere(0.03, M.white(), V(0.18, 0.4, 0.2), 'status');
  rotor(c, V(0, 0, 0), () => {
    c.cyl(0.04, 0.04, depth, M.stainless(), V(0, 0), AX.ny, 10);                   // shaft
    if (paddle === 'turbine') {
      c.cyl(0.08, 0.08, 0.04, M.stainless(), V(0, -depth + 0.15), AX.y, 12);
      for (let i = 0; i < 4; i++) {
        const b = c.box(0.5, 0.15, 0.02, M.stainless(), V(0, -depth + 0.17, 0));
        b.rotation.y = i * Math.PI / 4 * 2; b.translateX(0.25);
      }
    } else {
      for (const y of [-depth * 0.3, -depth * 0.62, -depth * 0.9]) {
        c.box(2.4, 0.06, 0.06, M.stainless(), V(0, y, 0));
        for (const x of [-1.05, 1.05]) c.box(0.12, depth * 0.22, 0.06, M.tint(0x6d8fa3), V(x, y - depth * 0.11, 0));
      }
    }
  });
  c.port('Mount', V(), AX.ny);
  return c.finish();
}
export const mixer = (o: BuildOptions) => agitator('Mixer', o, 3.2, 4.0, 'turbine');
export const flocculator = (o: BuildOptions) => agitator('Flocculator', o, 2.8, 4.4, 'paddle');

export function lamellaSettler(o: BuildOptions) {
  const { c, dn, r } = base('LamellaSettler', o, 600);
  const W = 8, L = 12, H = 5;
  c.box(W, 0.3, L, M.concrete(), V(0, 0.15, 0));
  for (const s of [-1, 1]) { c.box(0.3, H, L, M.concrete(), V(s * W / 2, H / 2, 0)); c.box(W, H, 0.3, M.concrete(), V(0, H / 2, s * L / 2)); }
  for (let i = 0; i < 18; i++) {                                                    // tube packs
    const p = c.box(W - 0.8, 0.9, 0.05, M.white(), V(0, H - 1.6, -L / 2 + 0.8 + i * ((L - 1.6) / 17)));
    p.rotation.x = 0.35;
  }
  for (let i = 0; i < 4; i++) c.box(W - 0.8, 0.3, 0.3, M.stainless(), V(0, H - 0.5, -L / 2 + 1.5 + i * ((L - 3) / 3))); // troughs
  c.box(W - 0.6, 0.02, L - 0.6, M.water(), V(0, H - 0.35, 0));
  c.box(W, 0.1, 1.0, M.stainless(), V(0, H + 0.05, 0));                            // walkway
  c.cyl(r, r, 1.2, M.pipe('Steel'), V(-W / 2, 0.8), AX.nx); c.flange(V(-W / 2 - 1.2, 0.8), AX.nx, dn);
  c.cyl(r, r, 1.2, M.pipe('Steel'), V(W / 2, H - 0.8), AX.x); c.flange(V(W / 2 + 1.2, H - 0.8), AX.x, dn);
  c.port('Inlet', V(-W / 2 - 1.2, 0.8), AX.nx); c.port('Outlet', V(W / 2 + 1.2, H - 0.8), AX.x);
  return c.finish();
}

export function rapidSandFilter(o: BuildOptions) {
  const { c, dn, r } = base('RapidSandFilter', o, 400);
  const W = 7, L = 11, H = 4.6;
  c.box(W, 0.3, L, M.concrete(), V(0, 0.15, 0));
  for (const s of [-1, 1]) { c.box(0.3, H, L, M.concrete(), V(s * W / 2, H / 2, 0)); c.box(W, H, 0.3, M.concrete(), V(0, H / 2, s * L / 2)); }
  c.box(W - 0.6, 0.8, L - 0.6, M.tint(0x9c8b6a), V(0, 0.7, 0));                    // gravel
  c.box(W - 0.6, 1.0, L - 0.6, M.tint(0xd8c59a), V(0, 1.6, 0));                    // sand
  for (const x of [-W / 6, W / 6]) c.box(0.45, 0.45, L - 0.6, M.concreteDark(), V(x, H - 1.1, 0)); // wash troughs
  c.box(W - 0.6, 0.02, L - 0.6, M.water(), V(0, H - 0.6, 0));
  c.cyl(r, r, 1.5, M.pipe('Steel'), V(0, H - 0.8, L / 2), AX.z); c.flange(V(0, H - 0.8, L / 2 + 1.5), AX.z, dn);
  c.cyl(r, r, 1.5, M.pipe('Steel'), V(0, 0.5, -L / 2), AX.nz); c.flange(V(0, 0.5, -L / 2 - 1.5), AX.nz, dn);
  c.port('Inlet', V(0, H - 0.8, L / 2 + 1.5), AX.z); c.port('Outlet', V(0, 0.5, -L / 2 - 1.5), AX.nz);
  return c.finish();
}

export function dosingPump(o: BuildOptions) {
  const { c, dn, r } = base('DosingPump', o, 25);
  c.box(0.9, 0.06, 0.5, M.stainless(), V(0, 0.03, 0));
  c.cyl(0.12, 0.12, 0.34, M.tint(0x3a6e5c), V(0.12, 0.25), AX.x);                  // motor
  c.box(0.24, 0.26, 0.24, M.tint(0xd04a2a), V(-0.05, 0.19, 0));                    // gearbox
  c.cylC(0.11, 0.08, M.tint(0x2f5d9e), V(-0.23, 0.22, 0), AX.x);                   // diaphragm head
  c.box(0.12, 0.08, 0.01, M.glass(), V(-0.05, 0.28, 0.125));
  c.sphere(0.014, M.white(), V(0.04, 0.3, 0.12), 'status');
  c.cyl(r, r, 0.12, M.white(), V(-0.23, 0.11), AX.ny); c.cyl(r, r, 0.12, M.white(), V(-0.23, 0.33), AX.y);
  void dn;
  c.port('Suction', V(-0.23, -0.01), AX.ny); c.port('Discharge', V(-0.23, 0.45), AX.y);
  return c.finish();
}

export function chemicalTank(o: BuildOptions) {
  const { c, r } = base('ChemicalTank', o, 50);
  const R = 1.1, H = 2.3;
  c.cyl(R, R, H, M.white(), V(0, 0.1), AX.y, 28);
  c.cyl(R * 1.02, R * 1.02, 0.1, M.greyPlastic(), V(0, 0), AX.y, 28);
  c.box(R * 2.2, 0.12, 0.2, M.stainless(), V(0, H + 0.16, 0));                      // mixer bridge
  c.cyl(0.13, 0.13, 0.4, M.tint(0x3a6e5c), V(0, H + 0.22), AX.y);
  rotor(c, V(0, H, 0), () => {
    c.cyl(0.025, 0.025, H - 0.4, M.stainless(), V(0, 0), AX.ny, 8);
    for (let i = 0; i < 3; i++) { const b = c.box(0.5, 0.05, 0.1, M.stainless(), V(0, -H + 0.5, 0)); b.rotation.y = i * Math.PI * 2 / 3; b.translateX(0.22); }
  });
  c.box(0.05, H * 0.8, 0.05, M.white(), V(R + 0.03, H * 0.5, 0));                    // level gauge
  c.sphere(0.02, M.white(), V(R * 0.7, H + 0.12, R * 0.5), 'status');
  c.cyl(r, r, 0.4, M.white(), V(R, 0.25), AX.x);
  c.port('Outlet', V(R + 0.4, 0.25), AX.x);
  return c.finish();
}

export function chlorinator(o: BuildOptions) {
  const { c, r } = base('Chlorinator', o, 25);
  c.box(0.9, 1.4, 0.06, M.greyPlastic(), V(0, 0.7 + 0.6, -0.03));                   // wall board
  c.box(0.45, 0.65, 0.22, M.white(), V(-0.15, 1.35, 0.11));                         // vacuum regulator / rotameter
  c.cyl(0.04, 0.04, 0.4, M.tint(0xd8f0ff), V(-0.15, 1.15, 0.24), AX.y, 12);         // rotameter tube
  c.sphere(0.03, M.tint(0x8fc93a), V(-0.15, 1.3, 0.24));
  c.box(0.26, 0.2, 0.15, M.tint(0x3a6e5c), V(0.25, 1.6, 0.08));                    // servo
  c.box(0.12, 0.07, 0.01, M.glass(), V(0.25, 1.62, 0.16));
  c.sphere(0.016, M.white(), V(0.33, 1.68, 0.16), 'status');
  c.tube([V(0.25, 1.5, 0.08), V(0.25, 0.9, 0.08), V(0.4, 0.6, 0.06)], r, M.white());
  c.port('Outlet', V(0.4, 0.6, 0.06), AX.x);
  return c.finish();
}

export function chlorineContainer(o: BuildOptions) {
  const { c } = base('ChlorineContainer', o, 15);
  const R = 0.39, L = 2.07;
  for (const x of [-0.6, 0.6]) c.box(0.12, 0.35, 0.9, M.dark(), V(x, 0.175, 0));    // trunnions
  c.cyl(R, R, L, M.tint(0xe0b021), V(-L / 2, 0.35 + R), AX.x, 24);
  for (const s of [-1, 1]) { const d = c.sphere(R, M.tint(0xe0b021), V(s * L / 2, 0.35 + R)); d.scale.x = 0.25; }
  for (const s of [-1, 1]) c.cylC(R * 1.03, 0.08, M.tint(0x2e7d32), V(s * L * 0.3, 0.35 + R), AX.x);
  c.cyl(0.02, 0.02, 0.12, M.brass(), V(L / 2 + 0.08, 0.35 + R + 0.12), AX.x, 8);    // valves
  c.cyl(0.02, 0.02, 0.12, M.brass(), V(L / 2 + 0.08, 0.35 + R - 0.12), AX.x, 8);
  c.port('Outlet', V(L / 2 + 0.2, 0.35 + R + 0.12), AX.x);
  return c.finish();
}

export function scrubber(o: BuildOptions) {
  const { c, dn, r } = base('Scrubber', o, 200);
  c.box(2.6, 0.2, 2.0, M.concrete(), V(0.3, 0.1, 0));
  c.cyl(0.9, 0.9, 6.0, M.tint(0x9cb6c2), V(0, 0.2), AX.y, 24);                       // packed tower
  c.cyl(0.95, 0.95, 0.1, M.stainless(), V(0, 3.2), AX.y, 24);
  c.cyl(0.25, 0.1, 0.8, M.stainless(), V(0, 6.2), AX.y, 16);                        // stack
  c.box(1.0, 0.8, 0.9, M.tint(0x3a6e5c), V(1.4, 0.6, 0));                           // fan
  rotor(c, V(1.4, 1.05, 0), () => { c.cyl(0.25, 0.25, 0.05, M.dark(), V(), AX.y, 5); });
  c.cyl(0.7, 0.7, 0.9, M.white(), V(-1.5, 0.2, 0), AX.y, 20);                        // NaOH tank
  c.sphere(0.03, M.white(), V(0.9, 1.2, 0.46), 'status');
  c.cyl(r, r, 1.2, M.pipe('PVC'), V(0.9, 1.0, 0), AX.x);
  c.port('Inlet', V(2.1, 1.0, 0), AX.x, dn);
  return c.finish();
}

// ---------- electrical and automation ----------
function panelRow(code: string, o: BuildOptions, n: number, front: (c: Ctx, x: number, i: number) => void, color = 0xd5d9d2) {
  const { c } = base(code, o, 15);
  const w = 0.8, H = 2.0, D = 0.6;
  c.box(n * w + 0.1, 0.1, D + 0.1, M.dark(), V(0, 0.05, 0));                       // plinth
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * w;
    enclosure(c, w - 0.02, H, D, V(x, 0.1, 0), M.tint(color));
    c.box(0.03, 0.12, 0.03, M.dark(), V(x + w / 2 - 0.08, 1.1, D / 2 + 0.015));    // handle
    front(c, x, i);
  }
  c.port('Mount', V(), AX.ny);
  return c.finish();
}
export const vfdPanel = (o: BuildOptions) => panelRow('VFDPanel', o, 1, (c, x) => {
  c.box(0.24, 0.14, 0.01, M.glass(), V(x, 1.55, 0.305));                             // keypad display
  for (let k = 0; k < 4; k++) c.box(0.5, 0.04, 0.01, M.dark(), V(x, 0.5 + k * 0.08, 0.305)); // vents
  c.sphere(0.02, M.white(), V(x + 0.2, 1.75, 0.31), 'status');
});
export const mcc = (o: BuildOptions) => panelRow('MCC', o, 4, (c, x, i) => {
  for (let k = 0; k < 5; k++) c.box(0.62, 0.3, 0.01, M.tint(0xc2c7c0), V(x, 0.35 + k * 0.33, 0.305)); // drawers
  for (let k = 0; k < 5; k++) c.sphere(0.012, i === 0 && k === 0 ? M.white() : M.tint(k % 2 ? 0x2fb36b : 0xe0453a), V(x + 0.22, 0.42 + k * 0.33, 0.31), i === 0 && k === 0 ? 'status' : undefined);
});
export const plcPanel = (o: BuildOptions) => panelRow('PLCPanel', o, 2, (c, x, i) => {
  if (i === 0) {
    c.box(0.3, 0.22, 0.01, M.glass(), V(x, 1.5, 0.305));                               // panel HMI
    for (let k = 0; k < 3; k++) c.cylC(0.025, 0.02, M.tint([0x2fb36b, 0xe0453a, 0xf0b429][k]!), V(x - 0.12 + k * 0.12, 1.2, 0.31), AX.z);
    c.cylC(0.04, 0.03, M.hydrant(), V(x, 1.0, 0.31), AX.z);                          // e-stop
    c.sphere(0.018, M.white(), V(x + 0.25, 1.85, 0.31), 'status');
  } else {
    c.box(0.5, 0.06, 0.01, M.dark(), V(x, 1.6, 0.305));
    for (let k = 0; k < 6; k++) c.box(0.05, 0.12, 0.01, M.tint(0x2f5d9e), V(x - 0.15 + k * 0.06, 1.6, 0.31)); // I/O cards (behind glass)
  }
}, 0xcfd3cc);
export function hmiPanel(o: BuildOptions) {
  const { c } = base('HMIPanel', o, 15);
  c.box(0.5, 0.05, 0.4, M.dark(), V(0, 0.025, 0));
  c.box(0.12, 1.05, 0.12, M.stainless(), V(0, 0.55, 0));                             // pedestal
  const housing = c.box(0.62, 0.45, 0.1, M.tint(0xcfd3cc), V(0, 1.3, 0.02));
  housing.rotation.x = -0.25;
  const scr = c.box(0.52, 0.34, 0.01, M.glass(), V(0, 1.31, 0.08));
  scr.rotation.x = -0.25;
  c.cylC(0.035, 0.03, M.hydrant(), V(0.24, 1.0, 0.07), AX.z);                        // e-stop
  c.sphere(0.015, M.white(), V(-0.25, 1.55, 0.06), 'status');
  c.port('Mount', V(), AX.ny);
  return c.finish();
}
export function scadaWorkstation(o: BuildOptions) {
  const { c } = base('SCADAWorkstation', o, 15);
  c.box(3.2, 0.05, 0.9, M.tint(0x8b8f88), V(0, 0.75, 0));                            // desk
  for (const x of [-1.5, 1.5]) c.box(0.05, 0.75, 0.85, M.tint(0x6f7470), V(x, 0.375, 0));
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.95;
    c.box(0.06, 0.25, 0.06, M.dark(), V(x, 0.9, -0.25));
    const s = c.box(0.85, 0.5, 0.04, M.dark(), V(x, 1.25, -0.27));
    s.rotation.y = (1 - i) * 0.25;
    const g = c.box(0.8, 0.45, 0.01, M.glass(), V(x, 1.25, -0.245));
    g.rotation.y = (1 - i) * 0.25;
  }
  c.box(0.45, 0.02, 0.15, M.dark(), V(0, 0.79, 0.15));                               // keyboard
  c.box(4.0, 1.6, 0.08, M.dark(), V(0, 2.2, -1.4));                                  // video wall
  c.box(3.85, 1.45, 0.01, M.glass(), V(0, 2.2, -1.355));
  c.sphere(0.02, M.white(), V(1.4, 0.82, 0.3), 'status');
  c.port('Mount', V(), AX.ny);
  return c.finish();
}
export function transformer(o: BuildOptions) {
  const { c } = base('Transformer', o, 15);
  c.box(3.0, 0.3, 2.2, M.concrete(), V(0, 0.15, 0));
  c.box(2.0, 1.8, 1.3, M.tint(0x5d7066), V(0, 1.2, 0));
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) c.box(0.05, 1.4, 0.35, M.tint(0x50625a), V(-0.9 + i * 0.225, 1.2, s * 0.82));
  c.cyl(0.35, 0.35, 1.0, M.tint(0x5d7066), V(-0.6, 2.3, 0), AX.x, 16);                // conservator
  for (let i = 0; i < 3; i++) c.cyl(0.06, 0.09, 0.7, M.tint(0xc9b38a), V(-0.5 + i * 0.5, 2.1, 0.3), AX.y, 10); // HV bushings
  for (let i = 0; i < 4; i++) c.cyl(0.04, 0.05, 0.4, M.tint(0xc9b38a), V(-0.45 + i * 0.3, 2.1, -0.35), AX.y, 8);
  c.sphere(0.03, M.white(), V(0.95, 1.9, 0.66), 'status');
  c.port('Mount', V(), AX.ny);
  return c.finish();
}
