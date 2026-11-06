import type { Pos3 } from './prepare-layer.js';

/** One animated pipe: particles travel along `path` in the flow direction. */
export interface FlowDatum {
  fid: string;
  path: Pos3[];
  /** Cumulative distance (m) at each path vertex; cum[0] = 0. */
  cum: number[];
  total: number;
  /** Relative speed (m/s of the pipe's water); drives the on-screen speed. */
  speedMps: number;
  /** +1 = along the path (start → end), -1 = against it. */
  dir: 1 | -1;
  color: [number, number, number, number];
  /** Colour of the direction arrows on a 3D tube. */
  arrowColor: [number, number, number, number];
  /** Tube radius (m) when drawn as a 3D tube, else 0: particles ride on the tube axis. */
  radiusM: number;
  bbox: [number, number, number, number];
  /** Stroke width (px) of the flat pipe; dashes are drawn narrower so they never exceed it. */
  widthPx: number;
}

export interface FlowParams {
  /** Seconds since the animation started. */
  time: number;
  /** Ground metres represented by one screen pixel at the current zoom. */
  metresPerPx: number;
  /** On-screen speed for speedMps = 1 (px/s). */
  pxPerSecPerMps: number;
  /** On-screen gap between particles (px). */
  spacingPx: number;
  /** Visible bbox [minLon, minLat, maxLon, maxLat]; pipes outside it are skipped. */
  view: [number, number, number, number] | null;
  /** Lift particles by the tube radius (tube mode). */
  solids: boolean;
  maxParticles: number;
  /** Comet tail: extra dots trailing each particle, as fractions of the spacing. */
  tail: number[];
}

export interface FlowParticles {
  count: number;
  positions: Float64Array; // xyz
  radii: Float32Array; // metres
  colors: Uint8ClampedArray; // rgba
}

/** Minimum gap between droplets inside a tube, in tube diameters. */
const DROP_GAP_DIAMETERS = 4;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
};

/** Spacing in metres, quantised to a power of two so it does not jitter while zooming. */
export function quantisedSpacing(spacingPx: number, metresPerPx: number): number {
  return 2 ** Math.round(Math.log2(Math.max(spacingPx * metresPerPx, 0.05)));
}

/** Position the point `s` metres along a flow path (cursor-based, s must be non-decreasing per call run). */
function pointAt(f: FlowDatum, s: number, from: number): { x: number; y: number; z: number; seg: number } {
  let i = Math.min(from, f.path.length - 2);
  while (i > 0 && f.cum[i]! > s) i--;
  while (i < f.path.length - 2 && f.cum[i + 1]! < s) i++;
  const a = f.path[i]!;
  const b = f.path[i + 1]!;
  const span = f.cum[i + 1]! - f.cum[i]!;
  const t = span > 0 ? (s - f.cum[i]!) / span : 0;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, seg: i };
}

const inView = (b: FlowDatum['bbox'], v: FlowParams['view']): boolean => !v || !(b[2] < v[0] || b[0] > v[2] || b[3] < v[1] || b[1] > v[3]);

/** Compute every particle for this frame. Pure: tested without WebGL. */
export function computeParticles(flows: FlowDatum[], p: FlowParams): FlowParticles {
  const baseSpacing = quantisedSpacing(p.spacingPx, p.metresPerPx);
  const radius = Math.max(p.metresPerPx * 2.2, 0.08);
  const cap = p.maxParticles;
  const positions = new Float64Array(cap * 3);
  const radii = new Float32Array(cap);
  const colors = new Uint8ClampedArray(cap * 4);
  let n = 0;
  for (const f of flows) {
    // Close-up tubes: keep droplets a few tube-diameters apart so they never merge into a chain.
    const spacing =
      p.solids && f.radiusM > 0 ? 2 ** Math.round(Math.log2(Math.max(baseSpacing, f.radiusM * 2 * DROP_GAP_DIAMETERS))) : baseSpacing;
    if (f.total < spacing * 0.25 || !inView(f.bbox, p.view)) continue;
    // screen-space speed → ground speed at this zoom
    const groundSpeed = f.speedMps * p.pxPerSecPerMps * p.metresPerPx;
    const phase = hash(f.fid) * spacing;
    const lift = p.solids ? f.radiusM : 0;
    const r = p.solids && f.radiusM > 0 ? f.radiusM * 0.55 : radius;
    const base = (p.time * groundSpeed + phase) % spacing;
    const count = Math.ceil(f.total / spacing);
    for (let k = 0; k < count; k++) {
      for (let ti = 0; ti < p.tail.length; ti++) {
        if (n >= cap) return { count: n, positions, radii, colors };
        // distance travelled along the flow direction; the tail trails behind it
        const along = k * spacing + base - p.tail[ti]! * spacing;
        if (along < 0 || along > f.total) continue;
        const s = f.dir === 1 ? along : f.total - along;
        const q = pointAt(f, s, 0);
        positions[n * 3] = q.x;
        positions[n * 3 + 1] = q.y;
        positions[n * 3 + 2] = q.z + lift;
        const fade = ti === 0 ? 1 : 0.5 / ti;
        radii[n] = r * (ti === 0 ? 1 : 0.8 - ti * 0.15);
        colors[n * 4] = f.color[0];
        colors[n * 4 + 1] = f.color[1];
        colors[n * 4 + 2] = f.color[2];
        colors[n * 4 + 3] = f.color[3] * fade;
        n++;
      }
    }
  }
  return { count: n, positions, radii, colors };
}

export function buildFlow(
  fid: string,
  path: Pos3[],
  speedMps: number,
  dir: 1 | -1,
  color: [number, number, number, number],
  radiusM: number,
  widthPx = 3,
  arrowColor: [number, number, number, number] = [244, 248, 252, 255],
): FlowDatum | null {
  if (path.length < 2) return null;
  const cum = [0];
  const M = 111_320;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    cum.push(cum[i - 1]! + Math.hypot((b[0] - a[0]) * Math.cos(lat) * M, (b[1] - a[1]) * M, b[2] - a[2]));
  }
  const xs = path.map((p) => p[0]);
  const ys = path.map((p) => p[1]);
  return { fid, path, cum, total: cum[cum.length - 1]!, speedMps, dir, color, arrowColor, radiusM, widthPx, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

export interface DashParams {
  time: number;
  metresPerPx: number;
  pxPerSecPerMps: number;
  /** Distance between dash starts (px). */
  periodPx: number;
  /** Dash length (px). */
  dashPx: number;
  view: [number, number, number, number] | null;
  maxSegments: number;
}

export interface FlowDashes {
  count: number;
  sources: Float64Array; // xyz
  targets: Float64Array; // xyz
  colors: Uint8ClampedArray; // rgba
  widths: Float32Array; // px
}

/**
 * Flat-map flow: short dashes sliding along each pipe. Dashes are as wide as the stroke (never wider),
 * with a faded tail and a bright head so the direction reads even when paused. Pure, like computeParticles.
 */
export function computeDashes(flows: FlowDatum[], p: DashParams): FlowDashes {
  const cap = p.maxSegments;
  const sources = new Float64Array(cap * 3);
  const targets = new Float64Array(cap * 3);
  const colors = new Uint8ClampedArray(cap * 4);
  const widths = new Float32Array(cap);
  let n = 0;
  const period = quantisedSpacing(p.periodPx, p.metresPerPx);
  const dashM = period * Math.min(p.dashPx / p.periodPx, 0.9);
  const half = dashM / 2;

  /** Emit the stretch [a, b] (metres along the flow) as straight sub-segments of the path. */
  const emit = (f: FlowDatum, a: number, b: number, alpha: number, w: number): void => {
    a = Math.max(a, 0);
    b = Math.min(b, f.total);
    if (b - a < 1e-6) return;
    const [sa, sb] = f.dir === 1 ? [a, b] : [f.total - b, f.total - a];
    const A = pointAt(f, sa, 0);
    const B = pointAt(f, sb, A.seg);
    const pts: [number, number, number][] = [[A.x, A.y, A.z]];
    for (let i = A.seg + 1; i <= B.seg; i++) pts.push(f.path[i]!);
    pts.push([B.x, B.y, B.z]);
    for (let i = 1; i < pts.length; i++) {
      if (n >= cap) return;
      const u = pts[i - 1]!;
      const v = pts[i]!;
      sources.set(u, n * 3);
      targets.set(v, n * 3);
      colors[n * 4] = f.color[0];
      colors[n * 4 + 1] = f.color[1];
      colors[n * 4 + 2] = f.color[2];
      colors[n * 4 + 3] = f.color[3] * alpha;
      widths[n] = w;
      n++;
    }
  };

  for (const f of flows) {
    if (f.total < period * 0.25 || !inView(f.bbox, p.view) || n >= cap) continue;
    const groundSpeed = f.speedMps * p.pxPerSecPerMps * p.metresPerPx;
    const base = (p.time * groundSpeed + hash(f.fid) * period) % period;
    const w = Math.max(1.5, f.widthPx * 0.6);
    const count = Math.ceil(f.total / period) + 1;
    for (let k = 0; k < count; k++) {
      const head = k * period + base; // leading end of the dash
      emit(f, head - dashM, head - half, 0.45, w); // fading tail
      emit(f, head - half, head, 1, w); // bright head
    }
  }
  return { count: n, sources, targets, colors, widths };
}

/** Arrows around a tube: top, right, bottom, left. */
export const ARROW_SIDES = 4;
/** Gap between arrow rings, in tube diameters (never less than ARROW_MIN_GAP_M). */
const ARROW_GAP_DIAMETERS = 6;
const ARROW_MIN_GAP_M = 4;
/** Arrow length along the pipe, in tube radii (the mesh spans x ∈ [-0.5, 0.5]). */
const ARROW_LENGTH_RADII = 2.2;
const M_PER_DEG = 111_320;

/** One arrow on a tube (see FlowArrowLayer): anchor at the upstream end of its segment, frame, and its phase. */
export interface ArrowInstance {
  position: [number, number, number];
  /** Column-major 4×4: maps the unit arrow mesh (pointing +X, on the +Z face of a unit cylinder) onto its side of the tube. */
  matrix: number[];
  color: [number, number, number, number];
  /** [offset at time 0 (m), loop length (m), relative speed, usable segment length (m)]. */
  flow: [number, number, number, number];
}

/** Bbox [minLon, minLat, maxLon, maxLat] overlap. */
const overlaps = (a: readonly number[], b: readonly number[] | null): boolean => !b || !(a[2]! < b[0]! || a[0]! > b[2]! || a[3]! < b[1]! || a[1]! > b[3]!);

/**
 * Arrow instances for every tubed flow (radiusM > 0), four per station (top, right, bottom, left),
 * stations spaced a few tube diameters apart along each straight segment. Built once per network or
 * view change; the motion is done on the GPU by advancing a time uniform (FlowArrowLayer), so the
 * arrows of a segment loop along it at `speedMps`. Only segments overlapping `cull` are kept. Pure.
 */
export function buildArrowInstances(flows: FlowDatum[], cull: readonly number[] | null = null): ArrowInstance[] {
  const out: ArrowInstance[] = [];
  for (const f of flows) {
    if (f.radiusM <= 0 || f.speedMps <= 0 || !overlaps(f.bbox, cull)) continue;
    const r = f.radiusM;
    const spacing = 2 ** Math.round(Math.log2(Math.max(r * 2 * ARROW_GAP_DIAMETERS, ARROW_MIN_GAP_M)));
    const len = r * ARROW_LENGTH_RADII;
    // keep clear of the flanges at both ends of the pipe
    const endGap = Math.max(r * 1.6, 0.2) + len / 2;
    const n = f.path.length;
    for (let j = 0; j < n - 1; j++) {
      // walk the segments in flow order
      const i = f.dir === 1 ? j : n - 2 - j;
      const a0 = f.dir === 1 ? f.path[i]! : f.path[i + 1]!;
      const b0 = f.dir === 1 ? f.path[i + 1]! : f.path[i]!;
      if (cull && (Math.max(a0[0], b0[0]) < cull[0]! || Math.min(a0[0], b0[0]) > cull[2]! || Math.max(a0[1], b0[1]) < cull[1]! || Math.min(a0[1], b0[1]) > cull[3]!)) continue;
      const lat = ((a0[1] + b0[1]) / 2) * (Math.PI / 180);
      const kx = Math.cos(lat) * M_PER_DEG;
      let dx = (b0[0] - a0[0]) * kx;
      let dy = (b0[1] - a0[1]) * M_PER_DEG;
      let dz = b0[2] - a0[2];
      const segLen = Math.hypot(dx, dy, dz);
      const startGap = j === 0 ? endGap : len / 2;
      const stopGap = j === n - 2 ? endGap : len / 2;
      const usable = segLen - startGap - stopGap;
      if (usable < len * 0.8) continue;
      dx /= segLen;
      dy /= segLen;
      dz /= segLen;
      // frame around the pipe: `up` (top of the tube) and `side` (right of the flow)
      let sx = dy, sy = -dx, sz = 0;
      const sl = Math.hypot(sx, sy);
      if (sl < 1e-3) [sx, sy, sz] = [1, 0, 0];
      else {
        sx /= sl;
        sy /= sl;
      }
      const ux = sy * dz - sz * dy;
      const uy = sz * dx - sx * dz;
      const uz = sx * dy - sy * dx;
      // anchor: the axis point where arrows enter the segment (tubes rest on the ground: axis one radius up)
      const position: [number, number, number] = [a0[0] + (dx * startGap) / kx, a0[1] + (dy * startGap) / M_PER_DEG, a0[2] + dz * startGap + r];
      const count = Math.max(1, Math.ceil(usable / spacing));
      const loop = count * spacing;
      const phase = hash(f.fid + i) * spacing;
      for (let k = 0; k < count; k++) {
        const flow: [number, number, number, number] = [k * spacing + phase, loop, f.speedMps, usable];
        for (let side = 0; side < ARROW_SIDES; side++) {
          const th = (side / ARROW_SIDES) * Math.PI * 2;
          const c = Math.cos(th);
          const sn = Math.sin(th);
          const rx = ux * c + sx * sn, ry = uy * c + sy * sn, rz = uz * c + sz * sn;
          const tx = -ux * sn + sx * c, ty = -uy * sn + sy * c, tz = -uz * sn + sz * c;
          out.push({ position, matrix: [dx * len, dy * len, dz * len, 0, tx * r, ty * r, tz * r, 0, rx * r, ry * r, rz * r, 0, 0, 0, 0, 1], color: f.arrowColor, flow });
        }
      }
    }
  }
  return out;
}
