/**
 * Flow direction arrows, as the GIS map draws them (map-runtime-3d flow-arrow-layer / computeChevrons): small arrows
 * painted on the pipes, riding along in the direction the water flows.
 *
 * One instanced mesh per chunk and level. Each pipe carries one *train* of arrows, evenly spaced along its whole arc
 * length (pieces of one pipe share it through `key` and `d0`), so thinning (`uEvery`) keeps an even spacing across
 * segment and piece boundaries. An instance is one slot of the train on one straight *interval* of a path: the vertex
 * shader puts slot j at `u0 + mod(x − u0, P) + j·P` (P = spacing · thinning, x = phase + uDist · speed) and hides it
 * when that falls past the interval. Intervals end at real ends (caps, fitting ports, bends, blocked device bodies),
 * where arrows grow in / shrink out, or run on through where a pipe was merely cut into pieces.
 *
 * Uniform contract (set by the owner every frame, per level):
 *  - uDist (m): the distance a speed-1 arrow has travelled, integrated on the CPU (Σ clamp(dt) · K, K = metres per
 *    second at speed 1 for the level). Never time·K: a zoom then changes only the rate, not where the arrows are;
 *  - uScale: tubes, the shader's thickening of the tube (L1 midScale, 1 at L2); flat arrows, the line's half-width in
 *    CSS px per built metre of radius (= line width px / WIDTH_M_D50 of a D50, without the pixel ratio);
 *  - uEvery: thin to every n-th slot (a power of 2); the shader also thins on its own so arrows stay ≥ uGap lengths apart;
 *  - uMinPx: smallest arrow radius (CSS px), so arrows on thin lines / far tubes stay legible;
 *  - uRes: drawing buffer size (device px), uPxRatio: device px per CSS px; both needed for every px size;
 *  - uCam: camera position in the layer frame (w = 1), so arrows turning away to a tube's silhouette fade (no fins).
 * The per-instance speed (paint) is a signed relative factor: + along the path, − against it, 0 = no flow.
 */
import * as THREE from 'three'
import { TUBE_GROUND } from './pipe-mesh'
import type { XY } from '../data/geo'

/** a pipe path (one piece of a pipe) to put arrows on */
export interface ArrowPath {
  /** the piece's id: its speed comes from `paint(speedOf(id))` */
  id: string
  path: XY[]
  /** the pipe's drawn radius (m) as built */
  r: number
  /** paths with the same key ride one train (default: the id before '#', i.e. the pipe) */
  key?: string
  /** arc length of path[0] along the whole pipe (m): the train's coordinate and the origin of `blocked` */
  d0?: number
  /** each end: a real end (cap, fitting port; arrows keep clear and shrink out) or only where the pipe was split
   * into pieces (arrows run on through). Default [true, true] */
  ends?: [boolean, boolean]
  /** arc ranges [from, to] (m, same origin as d0) that carry no arrow: bodies of inline valves, meters, saddles… */
  blocked?: Array<[number, number]>
}
/** @deprecated the old name: a stretch is now a whole path */
export type ArrowStretch = ArrowPath
export interface ArrowOptions {
  /** distance between a train's arrows (m), from the pipe radius */
  spacing: (r: number) => number
  /** angles around the tube (rad from the top) that carry an arrow; with more than one, they fade at the silhouette */
  sides: number[]
  /** lie flat on a line at this height instead of wrapping a tube */
  flat?: number
  /** merge near-straight runs (Douglas–Peucker tolerance, m), so far arrows are not cut at every CAD vertex */
  simplify?: number
  /** clearance (m) kept at real ends and around blocked ranges, from the built radius (default r · 0.5) */
  clear?: (r: number) => number
}

/** arrow length along the pipe, in arrow radii */
const LENGTH_RADII = 3
/** the shape in arrow units: shaft half-width, head half-width (radii), neck position (x ∈ [−0.5, 0.5] lengths) */
const SHAFT = 0.18
const HEAD = 0.55
const NECK = 0.04
/** a turn sharper than this ends an interval (arrows shrink out before the bend) */
const BEND = (12 * Math.PI) / 180
const f = (v: number) => v.toFixed(3)

/**
 * The arrow's quad: x ∈ [−0.5, 0.5] (lengths), y ∈ [−HEAD, HEAD] (radii, an arc on a tube, so it bends round it),
 * plus `pad`, the direction its edge moves out to leave room for the antialiased rim. The shape itself is cut in
 * the fragment shader (a distance field), so its edge and rim stay crisp at any size.
 */
function arrowQuad(): THREE.BufferGeometry {
  const ROWS = 8
  const pos: number[] = []
  const pad: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= ROWS; i++)
    for (const x of [-0.5, 0.5]) {
      pos.push(x, -HEAD + (2 * HEAD * i) / ROWS, 0)
      pad.push(Math.sign(x), i === 0 ? -1 : i === ROWS ? 1 : 0)
    }
  for (let i = 0; i < ROWS; i++) {
    const v = i * 2
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('pad', new THREE.Float32BufferAttribute(pad, 2))
  g.setIndex(idx)
  return g
}
let QUAD: THREE.BufferGeometry | null = null

/**
 * The arrows' material: a white arrow with a thin dark rim of constant pixel width. The rim shows in full where the
 * arrow is wider than its line or tube (it must read on the base map), faintly where it fits inside (`uRimMin`).
 * Flat arrows (L0) get a large polygon offset: the screen-space lines keep their centreline depth across their
 * width, so in a tilted view they would otherwise eat the far half of each arrow.
 */
export function arrowMaterial(o: { color?: number; rim?: number; flat?: boolean } = {}) {
  const uniforms = {
    /** distance (m) a speed-1 arrow has travelled: integrated on the CPU, see the file header */
    uDist: { value: 0 },
    /** tubes: their thickening; flat: line half-width (CSS px) per built metre of radius */
    uScale: { value: 1 },
    /** show every n-th slot only (a power of 2) */
    uEvery: { value: 1 },
    /** arrows of one train stay at least this many arrow lengths apart (the shader thins further) */
    uGap: { value: 3 },
    /** smallest arrow radius (CSS px) */
    uMinPx: { value: 0 },
    /** rim width (CSS px), its opacity, and its weight where the arrow fits inside its pipe */
    uRimPx: { value: 1 },
    uRimOpacity: { value: 0.85 },
    uRimMin: { value: 0.35 },
    /** drawing buffer size (device px) and device px per CSS px */
    uRes: { value: new THREE.Vector2(0, 0) },
    uPxRatio: { value: 1 },
    /** camera position in the layer frame, w = 1 when known */
    uCam: { value: new THREE.Vector4(0, 0, 0, 0) },
    uColor: { value: new THREE.Color(o.color ?? 0xf6fbff) },
    uRimColor: { value: new THREE.Color(o.rim ?? 0x0d2a44) },
    uOpacity: { value: 0.96 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: o.flat ? -24 : -1,
    polygonOffsetUnits: o.flat ? -48 : -4,
    vertexShader: `
uniform float uDist;
uniform float uScale;
uniform float uEvery;
uniform float uGap;
uniform float uMinPx;
uniform float uRimPx;
uniform float uRimMin;
uniform vec2 uRes;
uniform float uPxRatio;
uniform vec4 uCam;
attribute vec2 pad;
attribute vec2 iA;
attribute vec2 iB;
attribute vec4 iS;
attribute vec4 iP;
attribute vec4 iM;
attribute float iR;
attribute float iSpeed;
varying vec4 vShape;
varying float vAlpha;
varying float vRim;
vec4 clip(vec3 q) { return projectionMatrix * modelViewMatrix * vec4(q, 1.0); }
vec2 toPx(vec4 c) { return c.xy / c.w * 0.5 * uRes; }
// CSS px per metre at q: the less foreshortened of the pipe's two ground directions
float ppmAt(vec3 q, vec3 t, vec3 s) {
  if (uRes.x < 1.0) return 1e6;
  vec4 c = clip(q);
  if (c.w <= 0.0) return -1.0;
  vec2 a = toPx(c);
  float l = max(length(toPx(clip(q + t * 10.0)) - a), length(toPx(clip(q + s * 10.0)) - a)) * 0.1;
  return max(l / max(uPxRatio, 1e-3), 1e-6);
}
void main() {
  vAlpha = 0.0;
  vRim = 0.0;
  vShape = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (abs(iSpeed) < 1e-4) return;
  float flatZ = iM.z;
  vec2 seg = iB - iA;
  vec2 d = seg / max(length(seg), 1e-6);
  vec3 t = vec3(iSpeed > 0.0 ? d : -d, 0.0);
  vec3 side = vec3(t.y, -t.x, 0.0);
  float axisZ = flatZ > 0.0 ? flatZ : ${f(TUBE_GROUND)} + iR * uScale;
  // thinning from the interval's middle, so a whole interval keeps one spacing (nested powers of 2: no jumps)
  float ppm = ppmAt(vec3(0.5 * (iA + iB), axisZ), t, side);
  if (ppm <= 0.0) return;
  float rt = flatZ > 0.0 ? iR * uScale / ppm : iR * uScale;
  float len = max(rt, uMinPx / ppm) * ${f(LENGTH_RADII)};
  float E = max(uEvery, exp2(ceil(log2(max(1.0, uGap * len / iP.y)))));
  float P = iP.y * E;
  float x = iP.x + uDist * iSpeed;
  float s = iS.z + mod(x - iS.z, P) + iP.z * P;
  if (s >= iS.w) return;
  vec3 c = vec3(mix(iA, iB, (s - iS.x) / max(iS.y - iS.x, 1e-6)), axisZ);
  // size at the arrow itself: from the drawn line / tube, never under uMinPx
  ppm = ppmAt(c, t, side);
  if (ppm <= 0.0) return;
  rt = flatZ > 0.0 ? iR * uScale / ppm : iR * uScale;
  float r = max(rt, uMinPx / ppm);
  len = r * ${f(LENGTH_RADII)};
  // grows in after a real end and shrinks out before the next, never reaching past it
  float U = iS.w - iS.z;
  float fA = mod(iP.w, 2.0);
  float fB = step(1.5, iP.w);
  float fl = min(max(U * 0.12, 0.25), len * 1.5);
  float eA = s - iS.z;
  float eB = iS.w - s;
  float vis = 1.0;
  if (fA > 0.5) vis = min(vis, min(eA / fl, 2.0 * eA / len));
  if (fB > 0.5) vis = min(vis, min(eB / fl, 2.0 * eB / len));
  vis = clamp(vis, 0.0, 1.0);
  // an interval too short for a whole arrow carries none (no specks)
  float ends = fA + fB;
  float shortK = ends > 1.5 ? smoothstep(0.6, 1.0, U / len) : ends > 0.5 ? smoothstep(0.3, 0.5, U / len) : 1.0;
  vAlpha = smoothstep(0.0, 0.35, vis) * shortK;
  // the rim in full where the arrow's head is wider than its pipe on screen
  vRim = max(uRimMin, clamp((${f(HEAD)} * r - rt) * ppm + 1.0, 0.0, 1.0));
  float m = (uRimPx + 1.5) / ppm;
  float X = position.x * len * vis + pad.x * m;
  float Y = position.y * r * vis + pad.y * m;
  vShape = vec4(X, Y, len * vis, r * vis);
  vec3 p;
  if (flatZ > 0.0) p = c + t * X + side * Y;
  else {
    // on the tube's surface (1 % out), around the side it is on; a side arrow only while it fits the tube
    float ca = cos(iM.x);
    float sa = sin(iM.x);
    vec3 up2 = vec3(0.0, 0.0, ca) + side * sa;
    vec3 side2 = vec3(0.0, 0.0, -sa) + side * ca;
    float sideK = iM.x == 0.0 ? 1.0 : 1.0 - smoothstep(1.0, 1.15, r / max(rt, 1e-6));
    float Rw = rt * 1.01 + 0.005;
    float Ry = max(Rw, r * 1.01);
    float th = Y / Ry;
    p = c + t * X + side2 * (sin(th) * Ry) + up2 * (cos(th) * Rw);
    // fade an arrow turning towards the silhouette (its head would stand out past it like a fin)
    if (uCam.w > 0.5) {
      vec3 v = uCam.xyz - (c + up2 * Rw);
      v -= t * dot(v, t);
      float face = dot(normalize(v), up2);
      float lo = iM.y > 0.5 && sideK > 0.5 ? 0.35 : 0.0;
      vAlpha *= smoothstep(lo, lo + 0.25, face);
    }
    vAlpha *= sideK;
  }
  if (vAlpha <= 0.0) return;
  gl_Position = clip(p);
}`,
    fragmentShader: `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uOpacity;
uniform float uRimOpacity;
uniform float uRimPx;
uniform float uPxRatio;
varying vec4 vShape;
varying float vAlpha;
varying float vRim;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
// isosceles triangle, tip at the origin, base half-width q.x at y = q.y (iq)
float sdTri(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  if (vAlpha <= 0.0 || vShape.z <= 0.0) discard;
  float L = vShape.z;
  float R = vShape.w;
  vec2 p = vShape.xy;
  float neck = ${f(NECK)} * L;
  float dd = min(
    sdBox(p - vec2((neck - 0.5 * L) * 0.5, 0.0), vec2((neck + 0.5 * L) * 0.5, ${f(SHAFT)} * R)),
    sdTri(vec2(p.y, 0.5 * L - p.x), vec2(${f(HEAD)} * R, 0.5 * L - neck))
  );
  // metres → device px, so the edge is antialiased and the rim keeps its pixel width
  float px = dd / max(length(vec2(dFdx(dd), dFdy(dd))), 1e-9);
  float aF = clamp(0.5 - px, 0.0, 1.0) * uOpacity;
  float aR = clamp(0.5 - (px - uRimPx * uPxRatio), 0.0, 1.0) * vRim * uRimOpacity * (1.0 - aF);
  float a = aF + aR;
  if (a <= 0.004) discard;
  gl_FragColor = vec4((uColor * aF + uRimColor * aR) / a, a * vAlpha);
}`,
  })
  return { material, uniforms }
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}

/** indices of the vertices Douglas–Peucker keeps at tolerance `tol` */
function simplified(path: XY[], tol: number): number[] {
  const n = path.length
  if (tol <= 0 || n < 3) return path.map((_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()!
    const a = path[i0]!
    const b = path[i1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy || 1e-12
    let best = -1
    let far = tol
    for (let i = i0 + 1; i < i1; i++) {
      const p = path[i]!
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
      const dist = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)
      if (dist > far) {
        far = dist
        best = i
      }
    }
    if (best > 0) {
      keep[best] = 1
      stack.push([i0, best], [best, i1])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/** [from, to] minus the blocked ranges; a cut edge is a real end (bit 0 = start, bit 1 = end) */
function subtract(from: number, to: number, ends: number, blocked: Array<[number, number]>): Array<[number, number, number]> {
  let out: Array<[number, number, number]> = [[from, to, ends]]
  for (const [b0, b1] of blocked) {
    const next: Array<[number, number, number]> = []
    for (const [a, b, e] of out) {
      if (b1 <= a || b0 >= b) {
        next.push([a, b, e])
        continue
      }
      if (b0 > a) next.push([a, b0, (e & 1) | 2])
      if (b1 < b) next.push([b1, b, 1 | (e & 2)])
    }
    out = next
  }
  return out
}

export interface FlowArrows {
  /** one mesh per material, sharing the instances */
  meshes: THREE.Mesh[]
  /** rewrite each path's speed (signed, by piece id) */
  paint: (speedOf: (id: string) => number) => void
}

/** the arrows of a set of pipe paths; null when none has room for one */
export function buildArrows(paths: ArrowPath[], materials: THREE.Material | THREE.Material[], o: ArrowOptions): FlowArrows | null {
  const Q = (QUAD ??= arrowQuad())
  const clear = o.clear ?? ((r: number) => r * 0.5)
  const many = o.sides.length > 1 ? 1 : 0
  const A: number[] = []
  const B: number[] = []
  const S: number[] = []
  const P: number[] = []
  const M: number[] = []
  const R: number[] = []
  const ids: string[] = []
  const box = new THREE.Box3()
  for (const pa of paths) {
    const path = pa.path
    if (path.length < 2) continue
    const r = pa.r
    const spacing = o.spacing(r)
    const phase = hash(pa.key ?? pa.id.split('#')[0]!) * spacing * 64
    const gap = clear(r)
    const [realA, realB] = pa.ends ?? [true, true]
    // arc length of every vertex along the pipe
    const arc = [pa.d0 ?? 0]
    for (let i = 1; i < path.length; i++) arc.push(arc[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]))
    const blocked = (pa.blocked ?? []).map(([a, b]): [number, number] => [Math.min(a, b) - gap, Math.max(a, b) + gap]).sort((x, y) => x[0] - y[0])
    const kept = simplified(path, o.simplify ?? 0).filter((i, k, all) => k === 0 || arc[i]! - arc[all[k - 1]!]! > 1e-3)
    const heading = (k: number) => {
      const p = path[kept[k]!]!
      const q = path[kept[k + 1]!]!
      return Math.atan2(q[1] - p[1], q[0] - p[0])
    }
    const turn = (k: number) => Math.abs(((heading(k) - heading(k - 1) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
    for (let k = 0; k + 1 < kept.length; k++) {
      const i0 = kept[k]!
      const i1 = kept[k + 1]!
      const sA = arc[i0]!
      const sB = arc[i1]!
      // ends of this straight run: the path's own ends, a bend (clear of its collar), or a gentle vertex (run on)
      const bentA = k > 0 && turn(k) > BEND
      const bentB = k + 2 < kept.length && turn(k + 1) > BEND
      const endA = k === 0 ? realA : bentA
      const endB = k + 2 === kept.length ? realB : bentB
      const gA = k === 0 ? (realA ? gap : 0) : bentA ? r * 0.3 : 0
      const gB = k + 2 === kept.length ? (realB ? gap : 0) : bentB ? r * 0.3 : 0
      const a = path[i0]!
      const b = path[i1]!
      for (const [u0, u1, ends] of subtract(sA + gA, sB - gB, (endA ? 1 : 0) | (endB ? 2 : 0), blocked)) {
        const U = u1 - u0
        if (U < 0.05) continue
        const count = Math.floor(U / spacing) + 1
        for (let j = 0; j < count; j++)
          for (const side of o.sides) {
            A.push(a[0], a[1])
            B.push(b[0], b[1])
            S.push(sA, sB, u0, u1)
            P.push(phase, spacing, j, ends)
            M.push(side, many, o.flat ?? 0, 0)
            R.push(r)
            ids.push(pa.id)
          }
        box.expandByPoint(new THREE.Vector3(a[0], a[1], 0))
        box.expandByPoint(new THREE.Vector3(b[0], b[1], 0))
      }
    }
  }
  if (!ids.length) return null
  const g = new THREE.InstancedBufferGeometry()
  g.index = Q.index
  g.setAttribute('position', Q.getAttribute('position'))
  g.setAttribute('pad', Q.getAttribute('pad'))
  const inst = (a: number[], size: number) => new THREE.InstancedBufferAttribute(new Float32Array(a), size)
  g.setAttribute('iA', inst(A, 2))
  g.setAttribute('iB', inst(B, 2))
  g.setAttribute('iS', inst(S, 4))
  g.setAttribute('iP', inst(P, 4))
  g.setAttribute('iM', inst(M, 4))
  g.setAttribute('iR', inst(R, 1))
  const speed = new THREE.InstancedBufferAttribute(new Float32Array(ids.length), 1)
  g.setAttribute('iSpeed', speed)
  g.instanceCount = ids.length
  // the arrows ride along their intervals: bound them by the intervals plus a far arrow's size
  box.min.z = 0
  box.max.z = 10
  box.expandByScalar(50)
  g.boundingBox = box
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
  const meshes = (Array.isArray(materials) ? materials : [materials]).map((m, i) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.renderOrder = 3 + i
    return mesh
  })
  return {
    meshes,
    paint: speedOf => {
      const arr = speed.array as Float32Array
      const memo = new Map<string, number>()
      ids.forEach((id, i) => {
        let v = memo.get(id)
        if (v === undefined) memo.set(id, (v = speedOf(id)))
        arr[i] = v
      })
      speed.needsUpdate = true
    },
  }
}

/** a pipe piece as an arrow path (kept for callers of the per-stretch API; `extra` adds d0, ends, blocked…) */
export function stretchesOf(id: string, path: XY[], r: number, extra: Partial<Omit<ArrowPath, 'id' | 'path' | 'r'>> = {}): ArrowPath[] {
  return [{ id, path, r, ...extra }]
}

/**
 * The arc range [s − half, s + half] (m, from `d0`) around the point of `path` nearest `at`: what an inline device
 * of half-length `half` blocks. Null when `at` is farther than `tol` from the path.
 */
export function arcRange(path: XY[], at: XY, half: number, d0 = 0, tol = Infinity): [number, number] | null {
  let best = Infinity
  let s = 0
  let run = d0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L = Math.hypot(dx, dy)
    const t = L > 0 ? Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (L * L))) : 0
    const dist = Math.hypot(a[0] + dx * t - at[0], a[1] + dy * t - at[1])
    if (dist < best) {
      best = dist
      s = run + L * t
    }
    run += L
  }
  return best <= tol ? [s - half, s + half] : null
}
