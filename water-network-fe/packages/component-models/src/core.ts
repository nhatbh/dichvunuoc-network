// Shared geometry helpers, dimensions and materials for water network components.
// Local frame: metres, +Y up, main pipe axis along X. Ports carry world-free local
// positions and outward unit directions so the GIS layer can snap pipes to them.
import * as THREE from 'three';

import type { MaterialCode, Joint, Status } from './types.js';
export type { MaterialCode, Joint, Status } from './types.js';

export interface BuildOptions {
  dn?: number;          // nominal diameter, mm
  dn2?: number;         // second DN (reducers, reducing tees, branches)
  material?: MaterialCode;
  joint?: Joint;
  angle?: number;       // bend angle, degrees
  length?: number;      // pipe length, m
  segments?: number;    // radial segments (LOD); 8 = far, 20 = near
  handwheel?: boolean;  // valves: handwheel (true) or buried operator nut (false)
}

export interface Port {
  id: string;
  position: THREE.Vector3;
  direction: THREE.Vector3; // outward
  dn: number;
}

export interface ComponentData {
  code: string;
  dn: number;
  ports: Port[];
  variablePorts?: boolean;
}

// ---------- dimensions (ISO 2531 ductile-iron outside diameters, mm) ----------
const OD: [number, number][] = [
  [15, 21], [20, 25], [25, 32], [32, 40], [40, 56], [50, 66], [65, 82], [80, 98], [100, 118],
  [125, 144], [150, 170], [200, 222], [250, 274], [300, 326], [350, 378], [400, 429], [450, 480],
  [500, 532], [600, 635], [700, 738], [800, 842], [900, 945], [1000, 1048], [1200, 1255],
];
export function outerDiameter(dn: number): number {
  if (dn <= OD[0]![0]) return OD[0]![1] / 1000;
  for (let i = 1; i < OD.length; i++) {
    const [d1, o1] = OD[i - 1]!, [d2, o2] = OD[i]!;
    if (dn <= d2) return (o1 + (o2 - o1) * (dn - d1) / (d2 - d1)) / 1000;
  }
  return (dn * 1.045) / 1000;
}
export const flangeDiameter = (dn: number) => (1.12 * dn + 110) / 1000;        // ~EN 1092 PN10
export const flangeThickness = (dn: number) => (16 + dn * 0.04) / 1000;
export const boltCount = (dn: number) => (dn <= 65 ? 4 : dn <= 150 ? 8 : dn <= 250 ? 12 : dn <= 400 ? 16 : dn <= 600 ? 20 : 24);
export const boltDiameter = (dn: number) => (dn <= 150 ? 16 : dn <= 400 ? 20 : 27) / 1000;

// ---------- materials (shared, so thousands of instances cost nothing extra) ----------
const cache = new Map<string, THREE.MeshStandardMaterial>();
function mat(key: string, color: number, roughness = 0.6, metalness = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }); m.name = key; cache.set(key, m); }
  return m;
}
export const M = {
  epoxy: () => mat('epoxy-blue', 0x2f5d9e, 0.5),           // ductile-iron fittings and valve bodies
  bolt: () => mat('bolt-steel', 0xb8bcc2, 0.35, 0.8),
  stainless: () => mat('stainless', 0xd3d8dc, 0.3, 0.85),
  brass: () => mat('brass', 0xc9a24a, 0.35, 0.75),
  copper: () => mat('copper', 0xb87333, 0.4, 0.7),
  dark: () => mat('handwheel', 0x2c3036, 0.55, 0.3),
  black: () => mat('black', 0x1c1e21, 0.7),
  rubber: () => mat('rubber', 0x26282b, 0.9),
  hydrant: () => mat('hydrant-red', 0xc8312b, 0.45),
  white: () => mat('plastic-white', 0xeef0f2, 0.5),
  greyPlastic: () => mat('plastic-grey', 0x8d949b, 0.6),
  cabinet: () => mat('cabinet', 0xc9cfc6, 0.55, 0.2),
  concrete: () => mat('concrete', 0xb5b2a8, 0.95),
  concreteDark: () => mat('concrete-dark', 0x8f8c83, 0.95),
  roof: () => mat('roof', 0x5f6f7c, 0.7, 0.2),
  glass: () => mat('display', 0x1b2a33, 0.2, 0.1, { emissive: 0x1d4f66, emissiveIntensity: 0.35 }),
  water: () => mat('water', 0x3f7fa8, 0.15, 0.0),
  tint: (hex: number) => mat('tint-' + hex.toString(16), hex, 0.45),
  pipe: (m: MaterialCode) => {
    switch (m) {
      case 'HDPE': return mat('pipe-hdpe', 0x1f2124, 0.65);
      case 'PVC': return mat('pipe-pvc', 0x9ea5ab, 0.5);
      case 'Steel': return mat('pipe-steel', 0x5b6168, 0.45, 0.6);
      case 'CastIron': return mat('pipe-castiron', 0x34312e, 0.8, 0.2);
      case 'Concrete': return mat('pipe-concrete', 0x9c9a92, 0.95);
      default: return mat('pipe-di', 0x3d4852, 0.6, 0.3);
    }
  },
  stripe: () => mat('hdpe-stripe', 0x2a6fd6, 0.5),
};
const STATUS_COLORS: Record<Status, number> = { normal: 0x2fb36b, warning: 0xe5a00d, critical: 0xe0453a, offline: 0x7d838a };
export const statusMaterial = (s: Status) => mat('status-' + s, STATUS_COLORS[s], 0.4, 0, { emissive: STATUS_COLORS[s], emissiveIntensity: 0.55 });

// ---------- builder context ----------
const Y = new THREE.Vector3(0, 1, 0);
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const AX = { x: V(1, 0, 0), nx: V(-1, 0, 0), y: V(0, 1, 0), ny: V(0, -1, 0), z: V(0, 0, 1), nz: V(0, 0, -1) };

export class Ctx {
  g = new THREE.Group();
  ports: Port[] = [];
  seg: number;
  constructor(public code: string, public dn: number, seg = 20) { this.seg = seg; }

  add(mesh: THREE.Mesh, part?: string) {
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (part) mesh.userData.part = part;
    this.g.add(mesh); return mesh;
  }
  /** Cylinder (or cone) from `start` along `dir`. r1 at start, r2 at end. */
  cyl(r1: number, r2: number, len: number, m: THREE.Material, start: THREE.Vector3, dir: THREE.Vector3, seg = this.seg, part?: string, open = false) {
    const geo = new THREE.CylinderGeometry(r2, r1, len, seg, 1, open);
    const mesh = new THREE.Mesh(geo, m);
    const d = dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(Y, d);
    mesh.position.copy(start).addScaledVector(d, len / 2);
    return this.add(mesh, part);
  }
  /** Cylinder centred on `c`. */
  cylC(r: number, len: number, m: THREE.Material, c: THREE.Vector3, dir: THREE.Vector3, seg = this.seg, part?: string) {
    return this.cyl(r, r, len, m, c.clone().addScaledVector(dir.clone().normalize(), -len / 2), dir, seg, part);
  }
  box(w: number, h: number, d: number, m: THREE.Material, c: THREE.Vector3, part?: string) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.copy(c); return this.add(mesh, part);
  }
  sphere(r: number, m: THREE.Material, c: THREE.Vector3, part?: string, phiLen = Math.PI * 2, thetaLen = Math.PI) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, this.seg, Math.max(6, this.seg >> 1), 0, phiLen, 0, thetaLen), m);
    mesh.position.copy(c); return this.add(mesh, part);
  }
  torus(R: number, r: number, m: THREE.Material, c: THREE.Vector3, normal: THREE.Vector3, arc = Math.PI * 2, part?: string) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(R, r, Math.max(6, this.seg >> 1), this.seg + 4, arc), m);
    mesh.quaternion.setFromUnitVectors(V(0, 0, 1), normal.clone().normalize());
    mesh.position.copy(c); return this.add(mesh, part);
  }
  tube(points: THREE.Vector3[], r: number, m: THREE.Material, part?: string) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 6), r, Math.max(6, this.seg >> 1), false), m);
    return this.add(mesh, part);
  }
  port(id: string, position: THREE.Vector3, direction: THREE.Vector3, dn = this.dn) {
    this.ports.push({ id, position: position.clone(), direction: direction.clone().normalize(), dn });
  }

  // ---------- end connections ----------
  /** Flange whose outer face sits at `p`, facing outward along `dir`. */
  flange(p: THREE.Vector3, dir: THREE.Vector3, dn: number, m: THREE.Material = M.epoxy(), bolts = true) {
    const fd = flangeDiameter(dn), t = flangeThickness(dn), d = dir.clone().normalize();
    this.cyl(fd / 2, fd / 2, t, m, p.clone().addScaledVector(d, -t), d);
    if (!bolts) return;
    const n = boltCount(dn), bc = (fd + outerDiameter(dn)) / 4, bd = boltDiameter(dn);
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? AX.x : AX.y).normalize();
    const w = new THREE.Vector3().crossVectors(d, u);
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2;
      const c = p.clone().addScaledVector(u, Math.cos(a) * bc).addScaledVector(w, Math.sin(a) * bc).addScaledVector(d, -t / 2);
      this.cylC(bd / 2, t * 2.2, M.bolt(), c, d, 6);
    }
  }
  socket(p: THREE.Vector3, dir: THREE.Vector3, dn: number, m: THREE.Material) {
    const od = outerDiameter(dn), d = dir.clone().normalize();
    this.cyl(od * 0.6, od * 0.64, Math.max(0.06, od * 0.55), m, p.clone().addScaledVector(d, -Math.max(0.06, od * 0.55)), d);
  }
  bead(p: THREE.Vector3, dir: THREE.Vector3, dn: number, m: THREE.Material) {
    const od = outerDiameter(dn);
    this.torus(od / 2, Math.max(0.003, od * 0.035), m, p.clone().addScaledVector(dir, -od * 0.04), dir);
  }
  end(p: THREE.Vector3, dir: THREE.Vector3, dn: number, joint: Joint, body: THREE.Material) {
    if (joint === 'flanged') this.flange(p, dir, dn);
    else if (joint === 'socket') this.socket(p, dir, dn, body);
    else if (joint === 'fused') this.bead(p, dir, dn, body);
  }

  handwheel(c: THREE.Vector3, normal: THREE.Vector3, R: number) {
    const n = normal.clone().normalize(), rr = Math.max(0.005, R * 0.08);
    this.torus(R, rr, M.dark(), c, n);
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? AX.x : AX.y).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2, dir = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      this.cyl(rr * 0.7, rr * 0.7, R, M.dark(), c, dir, 6);
    }
    this.cylC(rr * 2.2, rr * 3, M.dark(), c, n, 8);
  }
  operatorNut(c: THREE.Vector3, s: number) {
    this.box(s, s * 0.9, s, M.dark(), c.clone().add(V(0, s * 0.45, 0)));
  }

  finish(variablePorts = false): THREE.Group {
    const data: ComponentData = { code: this.code, dn: this.dn, ports: this.ports, variablePorts };
    this.g.userData = data;
    this.g.name = this.code;
    return this.g;
  }
}

/** Default joint for a body material: DI and steel fittings are socketed or flanged, plastics fused or socketed. */
export function defaultJoint(m: MaterialCode | undefined, valveLike = false): Joint {
  if (valveLike) return 'flanged';
  switch (m) { case 'HDPE': return 'fused'; case 'PVC': return 'socket'; case 'Steel': return 'flanged'; default: return 'socket'; }
}
export function bodyMaterial(m: MaterialCode | undefined): THREE.Material {
  if (m === 'HDPE') return M.pipe('HDPE');
  if (m === 'PVC') return M.pipe('PVC');
  if (m === 'Steel') return M.pipe('Steel');
  return M.epoxy();
}
export const nextSmallerDN = (dn: number) => {
  const list = [20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];
  const i = list.findIndex((d) => d >= dn);
  return list[Math.max(0, (i < 0 ? list.length : i) - 2)] ?? 20;
};
