// Hydrants, service connections, meters and sensors. Parts tagged 'status' are
// recoloured by setStatus() so the 3D scene can show live sensor state.
import { AX, Ctx, M, V, outerDiameter, flangeDiameter } from './core.js';
import type { BuildOptions } from './core.js';

const base = (code: string, o: BuildOptions, dnDefault: number) => {
  const dn = o.dn ?? dnDefault;
  return { c: new Ctx(code, dn, o.segments ?? 20), dn, od: outerDiameter(dn), r: outerDiameter(dn) / 2 };
};

export function hydrant(o: BuildOptions) {
  const { c, dn } = base('Hydrant', o, 100);
  const R = 0.085;
  c.flange(V(), AX.ny, dn);
  c.cyl(R * 1.25, R * 1.2, 0.08, M.hydrant(), V(), AX.y);                   // shoe / ground flange
  c.cyl(R * 1.45, R * 1.45, 0.03, M.hydrant(), V(0, 0.08), AX.y);
  c.cyl(R, R, 0.5, M.hydrant(), V(0, 0.11), AX.y);                          // barrel
  c.cyl(R * 1.15, R * 1.15, 0.16, M.hydrant(), V(0, 0.55), AX.y);           // nozzle section
  for (const s of [-1, 1]) {                                                 // hose outlets + caps
    c.cyl(0.032, 0.032, 0.08, M.hydrant(), V(0, 0.62, s * R), s > 0 ? AX.z : AX.nz);
    c.cyl(0.038, 0.038, 0.035, M.hydrant(), V(0, 0.62, s * (R + 0.08)), s > 0 ? AX.z : AX.nz, 6);
  }
  c.cyl(0.052, 0.052, 0.07, M.hydrant(), V(R, 0.62), AX.x);                  // pumper outlet
  c.cyl(0.06, 0.06, 0.04, M.hydrant(), V(R + 0.07, 0.62), AX.x, 6);
  c.cyl(R * 1.2, R * 1.2, 0.03, M.hydrant(), V(0, 0.71), AX.y, 20, 'status'); // status band
  const bonnet = c.sphere(R * 1.05, M.hydrant(), V(0, 0.74), undefined, Math.PI * 2, Math.PI / 2); bonnet.scale.y = 0.7;
  c.cyl(0.022, 0.022, 0.05, M.brass(), V(0, 0.79), AX.y, 5);                // pentagon operating nut
  c.port('A', V(), AX.ny);
  return c.finish();
}

export function serviceConnection(o: BuildOptions) {
  const { c, od, r } = base('ServiceConnection', o, 150);
  const L = Math.max(od * 2.4, 0.4), rs = outerDiameter(25) / 2;
  c.cyl(r, r, L, M.pipe('DuctileIron'), V(-L / 2), AX.x);
  c.cylC(r * 1.08, Math.max(od * 0.7, 0.1), M.epoxy(), V(), AX.x);           // saddle
  c.cyl(rs * 1.8, rs * 1.6, 0.06, M.brass(), V(0, r), AX.y);                  // ferrule
  const y = r + 0.06;
  c.tube([V(0, y), V(0, y + 0.12), V(0.02, y + 0.2, 0.06), V(0, y + 0.22, 0.25), V(0, y + 0.22, 0.6)], rs, M.pipe('HDPE'));
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x); c.port('Service', V(0, y + 0.22, 0.6), AX.z, 25);
  return c.finish();
}

export function serviceValve(o: BuildOptions) {
  const { c, r } = base('ServiceValve', o, 25);
  const L = 0.12;
  c.cyl(r * 1.3, r * 1.3, L, M.brass(), V(-L / 2), AX.x, 6);
  c.sphere(r * 1.8, M.brass(), V());
  c.cyl(r * 0.4, r * 0.4, 0.05, M.brass(), V(0, r), AX.y, 8);
  c.box(0.05, 0.012, 0.012, M.brass(), V(0, r + 0.05));                        // T-head
  c.cyl(0.05, 0.05, 0.7, M.greyPlastic(), V(0, r + 0.02), AX.y, 16, undefined, true); // curb box
  c.cyl(0.065, 0.065, 0.02, M.dark(), V(0, r + 0.72), AX.y);
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function customerMeter(o: BuildOptions) {
  const { c, r } = base('CustomerMeter', o, 20);
  const L = 0.19;
  c.cyl(r * 1.2, r * 1.2, L, M.brass(), V(-L / 2), AX.x, 6);
  c.cyl(0.045, 0.05, 0.06, M.brass(), V(0, 0), AX.y);
  c.cyl(0.047, 0.047, 0.012, M.glass(), V(0, 0.06), AX.y);                    // register
  const lid = c.cyl(0.05, 0.05, 0.012, M.tint(0x2a6fd6), V(0, 0.072), AX.y);
  lid.rotation.z = -0.9; lid.position.add(V(-0.02, 0.035));
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function samplingPoint(o: BuildOptions) {
  const { c } = base('SamplingPoint', o, 20);
  c.box(0.16, 1.0, 0.12, M.stainless(), V(0, 0.5, 0));
  c.box(0.18, 0.04, 0.14, M.stainless(), V(0, 1.02, 0));
  c.cyl(0.01, 0.01, 0.08, M.stainless(), V(0, 0.75, 0.06), AX.z, 8);
  c.cyl(0.01, 0.007, 0.06, M.stainless(), V(0, 0.75, 0.14), AX.ny, 8);
  c.box(0.03, 0.012, 0.012, M.hydrant(), V(0, 0.82, 0.1));
  c.port('A', V(), AX.ny);
  return c.finish();
}

// ---------- metering and monitoring ----------
export function bulkMeter(o: BuildOptions) {
  const { c, dn, od, r } = base('BulkMeter', o, 200);
  const L = od * 2 + 0.1, fd = flangeDiameter(dn);
  c.cyl(r * 1.05, r * 1.05, L, M.epoxy(), V(-L / 2), AX.x);
  c.cylC(r * 1.35, L * 0.55, M.epoxy(), V(), AX.x);
  c.flange(V(-L / 2), AX.nx, dn); c.flange(V(L / 2), AX.x, dn);
  const ny = r * 1.3, h = Math.max(0.12, od * 0.4);
  c.cyl(0.03, 0.03, h, M.epoxy(), V(0, ny), AX.y, 12);
  const hr = Math.max(0.08, fd * 0.32);
  c.cylC(hr, hr * 0.7, M.white(), V(0, ny + h + hr), AX.z);                     // converter head
  c.cylC(hr * 0.8, 0.004, M.glass(), V(0, ny + h + hr, hr * 0.35), AX.z);
  c.torus(hr * 0.86, hr * 0.06, M.white(), V(0, ny + h + hr, hr * 0.36), AX.z, Math.PI * 2, 'status');
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}

export function pressureSensor(o: BuildOptions) {
  const { c } = base('PressureSensor', o, 15);
  c.cyl(0.012, 0.012, 0.12, M.brass(), V(), AX.y, 8);                           // tapping riser
  c.sphere(0.02, M.brass(), V(0, 0.07));
  c.box(0.07, 0.008, 0.012, M.hydrant(), V(0.03, 0.095, 0));
  c.cyl(0.024, 0.024, 0.11, M.stainless(), V(0, 0.12), AX.y, 16);             // transmitter
  c.cyl(0.026, 0.026, 0.02, M.white(), V(0, 0.23), AX.y, 16, 'status');
  c.cyl(0.006, 0.006, 0.05, M.black(), V(0, 0.15, 0.024), AX.z, 6);           // cable gland
  c.port('A', V(), AX.ny);
  return c.finish();
}

export function levelSensor(o: BuildOptions) {
  const { c } = base('LevelSensor', o, 15);
  c.box(0.5, 0.04, 0.08, M.stainless(), V(0.25, 0.02, 0));                     // bracket arm
  c.cyl(0.05, 0.05, 0.12, M.white(), V(0.45, 0.04), AX.y);
  c.cyl(0.052, 0.052, 0.02, M.white(), V(0.45, 0.16), AX.y, 20, 'status');
  c.cyl(0.035, 0.07, 0.1, M.greyPlastic(), V(0.45, 0.04), AX.ny);              // radar horn
  c.port('Mount', V(), AX.ny);
  return c.finish();
}

export function qualitySensor(o: BuildOptions) {
  const { c } = base('QualitySensor', o, 15);
  c.cyl(0.03, 0.03, 0.9, M.stainless(), V(-0.2), AX.y, 8); c.cyl(0.03, 0.03, 0.9, M.stainless(), V(0.2), AX.y, 8);
  c.box(0.55, 0.7, 0.2, M.cabinet(), V(0, 1.2, 0));
  c.box(0.18, 0.12, 0.01, M.glass(), V(0, 1.38, 0.105));
  c.sphere(0.015, M.white(), V(0.2, 1.48, 0.1), 'status');
  for (const x of [-0.12, 0.12]) c.cyl(0.025, 0.025, 0.16, M.white(), V(x, 1.0, 0.1), AX.ny, 12);   // flow cells
  c.tube([V(-0.12, 0.84, 0.1), V(-0.12, 0.3, 0.1), V(0, 0.05, 0.05), V(0, 0, 0)], 0.006, M.white());
  c.port('A', V(), AX.ny);
  return c.finish();
}

export function acousticLogger(o: BuildOptions) {
  const { c } = base('AcousticLogger', o, 15);
  c.cyl(0.03, 0.03, 0.04, M.bolt(), V(), AX.y, 12);                           // magnet base on fitting
  c.cyl(0.042, 0.042, 0.08, M.tint(0xf0b429), V(0, 0.04), AX.y);
  c.cyl(0.044, 0.044, 0.012, M.white(), V(0, 0.12), AX.y, 20, 'status');
  c.cyl(0.004, 0.004, 0.08, M.black(), V(0.02, 0.12), AX.y, 6);
  c.port('A', V(), AX.ny);
  return c.finish();
}

export function rtu(o: BuildOptions) {
  const { c } = base('RTU', o, 15);
  c.cyl(0.035, 0.035, 1.1, M.greyPlastic(), V(), AX.y, 12);
  c.box(0.4, 0.5, 0.2, M.cabinet(), V(0, 1.1, 0.12));
  c.sphere(0.014, M.white(), V(0.14, 1.3, 0.225), 'status');
  c.cyl(0.006, 0.006, 0.35, M.black(), V(0.15, 1.35, 0.12), AX.y, 6);
  const panel = c.box(0.45, 0.02, 0.32, M.glass(), V(0, 1.55, 0));
  panel.rotation.x = 0.5;
  c.port('Mount', V(), AX.ny);
  return c.finish();
}

export function chlorinationPoint(o: BuildOptions) {
  const { c, od, r } = base('ChlorinationPoint', o, 200);
  const L = Math.max(od * 2.6, 0.6);
  c.cyl(r, r, L, M.pipe('DuctileIron'), V(-L / 2), AX.x);
  c.cyl(0.012, 0.012, r + 0.12, M.stainless(), V(0, 0), AX.y, 8);              // injection quill
  c.box(0.5, 0.9, 0.35, M.cabinet(), V(0.2, 0.45, -0.7));
  c.cyl(0.18, 0.18, 0.7, M.white(), V(-0.35, 0, -0.7), AX.y);                  // hypochlorite tank
  c.sphere(0.012, M.white(), V(0.35, 0.8, -0.52), 'status');
  c.tube([V(0.2, 0.3, -0.52), V(0.1, 0.2, -0.2), V(0, r + 0.12, 0)], 0.006, M.white());
  c.port('A', V(-L / 2), AX.nx); c.port('B', V(L / 2), AX.x);
  return c.finish();
}
