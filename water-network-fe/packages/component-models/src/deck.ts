// deck.gl adapter for @wn/map-runtime-3d: plain mesh data for SimpleMeshLayer and
// helpers for IconLayer. No deck.gl or luma.gl import: the output is plain attribute
// objects, the same shape as map-runtime-3d's own `meshes.ts`.
//
// Frame: deck metre offsets, x east, y north, z up. A model is built with its main pipe
// axis along +x (port A west, port B east), branches (tee C) to the south, and devices
// standing on +z. Turn it onto a pipe with `alongMatrix`, or `headingMatrix` for points.
import * as THREE from 'three';
import { createComponent, getEntry } from './index.js';
import type { BuildOptions, Port } from './core.js';
import { drawSymbol, getSymbol } from './symbols.js';
import type { Status } from './types.js';

export interface DeckMeshData {
  attributes: {
    POSITION: { value: Float32Array; size: 3 };
    NORMAL: { value: Float32Array; size: 3 };
    TEXCOORD_0: { value: Float32Array; size: 2 };
    /** Baked part colours (0..1), multiplied by the layer's getColor; use white [255,255,255] to keep them. */
    COLOR_0?: { value: Float32Array; size: 3 };
  };
  indices: { value: Uint16Array | Uint32Array; size: 1 };
}

export interface DeckPort { id: string; position: [number, number, number]; direction: [number, number, number]; dn: number }

export interface DeckComponentMesh {
  code: string;
  dn: number;
  /** Every part except the status part, with baked colours. One SimpleMeshLayer per (code, dn, lod). */
  body: DeckMeshData;
  /** The live-status part (sensor ring, hydrant band, meter LED), uncoloured: draw it with getColor = status colour. */
  status: DeckMeshData | null;
  ports: DeckPort[];
  /** Bounding-sphere radius (m), for the on-screen size test that picks flat vs 3D. */
  radius: number;
  /** Largest plan dimension (m). */
  footprint: number;
  triangles: number;
}

/** three local frame (Y up, Z = branch side) to deck (Z up, -Y = branch side). */
const TO_DECK = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const toDeckVec = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];

const cache = new Map<string, DeckComponentMesh>();

/** Mesh data for one component at one size and level of detail (cached). */
export function componentMesh(code: string, opts: BuildOptions = {}): DeckComponentMesh {
  const key = `${code}|${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = createComponent(code, opts);
  g.updateMatrixWorld(true);
  const body: Part[] = [], status: Part[] = [];
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    const color = new THREE.Color();
    m.color.getRGB(color, THREE.SRGBColorSpace);
    (mesh.userData.part === 'status' ? status : body).push({ geometry: mesh.geometry, matrix: mesh.matrixWorld, color });
  });
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
  const ports: Port[] = (g.userData as { ports: Port[] }).ports;
  const result: DeckComponentMesh = {
    code, dn: (g.userData as { dn: number }).dn,
    body: merge(body, true),
    status: status.length ? merge(status, false) : null,
    ports: ports.map((p) => ({ id: p.id, position: toDeckVec(p.position), direction: toDeckVec(p.direction), dn: p.dn })),
    radius: box.getBoundingSphere(new THREE.Sphere()).radius,
    footprint: Math.max(size.x, size.z),
    triangles: 0,
  };
  result.triangles = (result.body.indices.value.length + (result.status?.indices.value.length ?? 0)) / 3;
  cache.set(key, result);
  return result;
}

/** Drop cached meshes (e.g. after a theme change that recolours materials). */
export const clearMeshCache = () => cache.clear();

interface Part { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: THREE.Color }

function merge(parts: Part[], withColor: boolean): DeckMeshData {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    const n = p.geometry.attributes.position!.count;
    vCount += n; iCount += p.geometry.index ? p.geometry.index.count : n;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), full = new THREE.Matrix4();
  let vo = 0, io = 0;
  for (const p of parts) {
    full.multiplyMatrices(TO_DECK, p.matrix);
    nm.getNormalMatrix(full);
    const P = p.geometry.attributes.position!, N = p.geometry.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(full);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (N) {
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
      }
      col[(vo + i) * 3] = p.color.r; col[(vo + i) * 3 + 1] = p.color.g; col[(vo + i) * 3 + 2] = p.color.b;
    }
    const I = p.geometry.index;
    if (I) for (let k = 0; k < I.count; k++) idx[io + k] = I.getX(k) + vo;
    else for (let k = 0; k < P.count; k++) idx[io + k] = k + vo;
    io += I ? I.count : P.count; vo += P.count;
  }
  const attributes: DeckMeshData['attributes'] = {
    POSITION: { value: pos, size: 3 },
    NORMAL: { value: nor, size: 3 },
    TEXCOORD_0: { value: new Float32Array(vCount * 2), size: 2 },
  };
  if (withColor) attributes.COLOR_0 = { value: col, size: 3 };
  return { attributes, indices: { value: idx, size: 1 } };
}

// ---------- placement (4x4 column-major, for SimpleMeshLayer getTransformMatrix) ----------
type V3 = readonly [number, number, number];

/** Rotate a model so its +x axis (port A to B) follows `dir` (metres east, north, up), keeping it upright. */
export function alongMatrix(dir: V3, scale = 1): number[] {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const x = [dir[0] / l, dir[1] / l, dir[2] / l] as const;
  // y = up x X (horizontal, left of the pipe); fall back to north for a vertical pipe
  let y = [-x[1], x[0], 0];
  const yl = Math.hypot(y[0]!, y[1]!) ;
  y = yl < 1e-6 ? [0, 1, 0] : [y[0]! / yl, y[1]! / yl, 0];
  const z = [x[1] * y[2]! - x[2] * y[1]!, x[2] * y[0]! - x[0] * y[2]!, x[0] * y[1]! - x[1] * y[0]!];
  return [x[0] * scale, x[1] * scale, x[2] * scale, 0, y[0]! * scale, y[1]! * scale, y[2]! * scale, 0, z[0]! * scale, z[1]! * scale, z[2]! * scale, 0, 0, 0, 0, 1];
}

/** Rotate a model about the vertical by a compass bearing (degrees clockwise from north) of its A to B axis. */
export function headingMatrix(bearingDeg: number, scale = 1): number[] {
  const t = (bearingDeg * Math.PI) / 180;
  return alongMatrix([Math.sin(t), Math.cos(t), 0], scale);
}

/** IconLayer getAngle (degrees counter-clockwise) for a pipe-aligned symbol on a pipe heading `dir`. */
export const symbolAngle = (dir: V3): number => (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;

/** True when the component's flat symbol should turn with its pipe (IconLayer billboard: false + getAngle). */
export const symbolFollowsPipe = (code: string): boolean => getSymbol(code).align === 'pipe';

// ---------- icons ----------
/** Draw a symbol into an icon-atlas cell at (x, y), `px` CSS pixels square, at `scale` device pixels per px. */
export function drawSymbolCell(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, px: number, status?: Status, scale = 2) {
  ctx.save();
  ctx.translate(x * scale, y * scale);
  drawSymbol(ctx, code, px * scale, status);
  ctx.restore();
}

/** Whether a code exists in the catalog and has a status part. */
export const hasStatusPart = (code: string): boolean => !!getEntry(code)?.hasStatus;

/** Model diameter in pixels for a given metres-per-pixel; compare with 24 px to choose flat vs 3D. */
export const screenSizePx = (mesh: Pick<DeckComponentMesh, 'radius'>, metresPerPixel: number) => (2 * mesh.radius) / metresPerPixel;
