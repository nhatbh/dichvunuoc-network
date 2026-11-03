/** 4x4 column-major matrices for deck's SimpleMeshLayer `getTransformMatrix` (metre offsets: x east, y north, z up). */
export type V3 = [number, number, number];

const M_PER_DEG = 111_320;

/** East/north/up offset in metres from a to b (small-distance equirectangular). */
export function enuDelta(a: readonly number[], b: readonly number[]): V3 {
  const lat = ((a[1]! + b[1]!) / 2) * (Math.PI / 180);
  return [(b[0]! - a[0]!) * Math.cos(lat) * M_PER_DEG, (b[1]! - a[1]!) * M_PER_DEG, (b[2] ?? 0) - (a[2] ?? 0)];
}

const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: V3): V3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Matrix mapping the unit +X cylinder (radius 1, x∈[0,1]) onto a cylinder starting at the anchor, along `vec` (metres), with `radius`. */
export function alongMatrix(vec: V3, radius: number): number[] {
  const d = norm(vec);
  const ref: V3 = Math.abs(d[2]) > 0.98 ? [1, 0, 0] : [0, 0, 1];
  const p1 = norm(cross(d, ref));
  const p2 = cross(d, p1);
  const l = len(vec);
  return [d[0] * l, d[1] * l, d[2] * l, 0, p1[0] * radius, p1[1] * radius, p1[2] * radius, 0, p2[0] * radius, p2[1] * radius, p2[2] * radius, 0, 0, 0, 0, 1];
}

export const scaleMatrix = (x: number, y: number, z: number): number[] => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

/** Angle in degrees between two direction vectors. */
export function angleBetween(a: V3, b: V3): number {
  const na = norm(a);
  const nb = norm(b);
  const dot = Math.max(-1, Math.min(1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}
export { len as vecLen };
