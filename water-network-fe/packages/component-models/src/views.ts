// Two display modes per component:
//   flat - a map symbol (2D renders, and the 3D scene when the camera is far away)
//   3d   - the procedural model (up close), with a low-poly level in between
// ComponentView / PipeView pick the level from the model's size on screen, so the switch
// works the same for a 0.3 m valve and a 20 m reservoir.
import * as THREE from 'three';
import { outerDiameter } from './core.js';
import type { BuildOptions, MaterialCode, Status } from './core.js';
import { drawSymbol, getSymbol } from './symbols.js';

const texCache = new Map<string, THREE.Texture>();
/** Shared canvas texture per (code, status, size). */
export function symbolTexture(code: string, status?: Status, px = 256): THREE.Texture {
  const key = `${code}|${status ?? ''}|${px}`;
  let t = texCache.get(key);
  if (!t) {
    const cv = document.createElement('canvas'); cv.width = cv.height = px;
    drawSymbol(cv.getContext('2d')!, code, px, status);
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

export type DisplayMode = 'auto' | '3d' | 'flat';
export type Level = 'near' | 'low' | 'flat';

export interface ViewOptions extends BuildOptions {
  status?: Status;
  mode?: DisplayMode;
  flatPx?: number;       // symbol size on screen, px (default 28)
  flatBelowPx?: number;  // auto: show the symbol when the model is smaller than this on screen (default 24)
  lowBelowPx?: number;   // auto: low-poly model below this size (default 140)
}

type Build = (code: string, o: BuildOptions) => THREE.Group;
let builder: Build | null = null;
/** Wired by index.ts to createComponent, avoiding a circular import. */
export const registerBuilder = (b: Build) => { builder = b; };

const _p = new THREE.Vector3();
/** World units per screen pixel at a point (perspective or orthographic camera). */
export function worldPerPixel(camera: THREE.Camera, at: THREE.Vector3, viewportHeightPx: number): number {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const c = camera as THREE.OrthographicCamera;
    return (c.top - c.bottom) / c.zoom / viewportHeightPx;
  }
  const c = camera as THREE.PerspectiveCamera;
  const d = _p.copy(at).applyMatrix4(c.matrixWorldInverse).z * -1;
  return (2 * Math.max(d, 1e-6) * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) / (c.zoom * viewportHeightPx);
}

function flatMaterial(map: THREE.Texture) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.05, depthTest: false, depthWrite: false, toneMapped: false });
}

export class ComponentView extends THREE.Group {
  readonly isComponentView = true;
  readonly code: string;
  level: Level = 'near';
  mode: DisplayMode;
  status?: Status;
  readonly radius: number;
  readonly near: THREE.Group;
  private low: THREE.Group | null = null;
  readonly flat: THREE.Object3D;
  private opts: ViewOptions;
  private hasStatusParts = false;
  private footprint: number;

  constructor(code: string, opts: ViewOptions = {}) {
    super();
    if (!builder) throw new Error('views: builder not registered');
    this.code = code; this.opts = opts; this.mode = opts.mode ?? 'auto'; this.status = opts.status;
    this.near = builder(code, opts);
    this.userData = this.near.userData;                       // ports, code, dn
    const box = new THREE.Box3().setFromObject(this.near), size = box.getSize(new THREE.Vector3());
    this.radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    this.footprint = Math.max(size.x, size.z);               // plan size: the symbol never draws smaller than the model
    this.near.traverse((o) => { if (o.userData.part === 'status') this.hasStatusParts = true; });
    const sym = getSymbol(code);
    const tex = symbolTexture(code, this.hasStatusParts ? this.status : undefined);
    if (sym.align === 'pipe') {
      // lies in the local XZ plane, so it turns with the pipe; glyph top = -Z (tee branch = +Z)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatMaterial(tex));
      m.rotation.x = -Math.PI / 2; this.flat = m;
    } else {
      this.flat = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, toneMapped: false }));
    }
    this.flat.renderOrder = 10; this.flat.userData.flatSymbol = true;
    this.flat.scale.setScalar(1e-4);                          // sized per frame; keep it out of bounding boxes
    this.add(this.near, this.flat);
    if (this.status) this.setStatus(this.status);
    this.apply('near');
  }

  setStatus(s: Status) {
    this.status = s;
    const tex = symbolTexture(this.code, this.hasStatusParts ? s : undefined);
    ((this.flat as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.SpriteMaterial).map = tex;
    for (const g of [this.near, this.low]) g?.traverse((o) => { if (o.userData.part === 'status') (o as THREE.Mesh).material = statusMat(s); });
  }
  setMode(m: DisplayMode) { this.mode = m; }

  private ensureLow() {
    if (!this.low) {
      this.low = builder!(this.code, { ...this.opts, segments: 8 });
      this.low.visible = false; this.add(this.low);
      if (this.status) this.setStatus(this.status);
    }
    return this.low;
  }
  private apply(l: Level) {
    this.level = l;
    this.near.visible = l === 'near';
    if (l === 'low') this.ensureLow();
    if (this.low) this.low.visible = l === 'low';
    this.flat.visible = l === 'flat';
  }

  /** Choose the level and size the symbol. Call once per frame (updateViews does this). */
  update(camera: THREE.Camera, viewportHeightPx: number) {
    const wpp = worldPerPixel(camera, this.getWorldPosition(_p), viewportHeightPx);
    const ws = this.getWorldScale(new THREE.Vector3()).x || 1;
    const px = (2 * this.radius * ws) / wpp;                  // model diameter on screen
    const flatBelow = this.opts.flatBelowPx ?? 24, lowBelow = this.opts.lowBelowPx ?? 140;
    const h = (lvl: Level, v: number) => (this.level === lvl ? v * 1.15 : v); // hysteresis
    let next: Level;
    if (this.mode === 'flat') next = 'flat';
    else if (this.mode === '3d') next = px < h('low', lowBelow) ? 'low' : 'near';
    else next = px < h('flat', flatBelow) ? 'flat' : px < h('low', lowBelow) ? 'low' : 'near';
    if (next !== this.level) this.apply(next);
    if (next === 'flat') {
      const s = Math.max((this.opts.flatPx ?? 28) * wpp / ws, this.footprint * 1.1);
      this.flat.scale.set(s, s, s);
    }
    return { level: this.level, px };
  }
}

const statusMats = new Map<Status, THREE.Material>();
function statusMat(s: Status) {
  let m = statusMats.get(s);
  if (!m) {
    const hex = { normal: 0x2fb36b, warning: 0xe5a00d, critical: 0xe0453a, offline: 0x7d838a }[s];
    m = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.55, roughness: 0.4 });
    statusMats.set(s, m);
  }
  return m;
}

const PIPE_FLAT: Record<MaterialCode, number> = { HDPE: 0x2a6fd6, PVC: 0x7d8790, DuctileIron: 0x2f5d9e, Steel: 0x5b6168, CastIron: 0x6b4b3a, Concrete: 0x9c9a92 };

/** A pipe segment between two points: a 3D tube up close, a flat ribbon of constant pixel width far away. */
export class PipeView extends THREE.Group {
  readonly isPipeView = true;
  level: Level = 'near';
  mode: DisplayMode;
  readonly near: THREE.Group;
  readonly flat: THREE.Mesh;
  readonly od: number;
  private ribbonPx: number;

  constructor(from: THREE.Vector3, to: THREE.Vector3, opts: { dn?: number; material?: MaterialCode; mode?: DisplayMode; ribbonPx?: number; segments?: number } = {}) {
    super();
    const dn = opts.dn ?? 150, material = opts.material ?? 'DuctileIron', L = from.distanceTo(to);
    this.mode = opts.mode ?? 'auto'; this.od = outerDiameter(dn); this.ribbonPx = opts.ribbonPx ?? Math.max(2, Math.min(8, dn / 60));
    this.near = builder!('Pipe', { dn, material, length: L, segments: opts.segments ?? 16 });
    this.flat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: PIPE_FLAT[material], depthTest: false, depthWrite: false, toneMapped: false }));
    this.flat.rotation.x = -Math.PI / 2; this.flat.scale.set(L, 1e-4, 1); this.flat.renderOrder = 9; this.flat.visible = false;
    this.add(this.near, this.flat);
    // orient: local X along from->to, centred
    const x = to.clone().sub(from).normalize();
    let z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0));
    if (z.lengthSq() < 1e-8) z = new THREE.Vector3(0, 0, 1);
    z.normalize();
    this.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(z, x), z));
    this.position.copy(from).add(to).multiplyScalar(0.5);
    this.userData = { code: 'Pipe', dn, material, ports: (this.near.userData as { ports: unknown }).ports };
  }
  setMode(m: DisplayMode) { this.mode = m; }

  update(camera: THREE.Camera, viewportHeightPx: number) {
    const wpp = worldPerPixel(camera, this.getWorldPosition(_p), viewportHeightPx);
    const px = this.od / wpp;
    const next: Level = this.mode === 'flat' || (this.mode === 'auto' && px < (this.level === 'flat' ? 4 * 1.15 : 4)) ? 'flat' : 'near';
    this.level = next; this.near.visible = next === 'near'; this.flat.visible = next === 'flat';
    if (next === 'flat') this.flat.scale.y = Math.max(this.od, this.ribbonPx * wpp);
    return { level: this.level, px };
  }
}

/** Update every ComponentView and PipeView under `root`. Call before renderer.render each frame. */
export function updateViews(root: THREE.Object3D, camera: THREE.Camera, viewportHeightPx: number) {
  camera.updateMatrixWorld();
  root.traverse((o) => {
    if ((o as ComponentView).isComponentView || (o as PipeView).isPipeView) (o as ComponentView).update(camera, viewportHeightPx);
  });
}

/** Switch every view under `root` to one mode, e.g. 'flat' for a 2D render. */
export function setDisplayMode(root: THREE.Object3D, mode: DisplayMode) {
  root.traverse((o) => { if ((o as ComponentView).isComponentView || (o as PipeView).isPipeView) (o as ComponentView).setMode(mode); });
}
