/** Procedural unit meshes for deck.gl's SimpleMeshLayer (plain attribute objects: no luma.gl import needed). */
export interface MeshData {
  attributes: {
    POSITION: { value: Float32Array; size: 3 };
    NORMAL: { value: Float32Array; size: 3 };
    TEXCOORD_0: { value: Float32Array; size: 2 };
  };
  indices: { value: Uint16Array; size: 1 };
}

function finish(pos: number[], nor: number[], idx: number[]): MeshData {
  return {
    attributes: {
      POSITION: { value: new Float32Array(pos), size: 3 },
      NORMAL: { value: new Float32Array(nor), size: 3 },
      TEXCOORD_0: { value: new Float32Array((pos.length / 3) * 2), size: 2 },
    },
    indices: { value: new Uint16Array(idx), size: 1 },
  };
}

/** Cylinder of radius 1 along +X from x=0 to x=1, with end caps. */
export function cylinderMesh(radial = 14): MeshData {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    const y = Math.cos(a);
    const z = Math.sin(a);
    pos.push(0, y, z, 1, y, z);
    nor.push(0, y, z, 0, y, z);
  }
  for (let i = 0; i < radial; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (const [x, nx] of [[0, -1], [1, 1]] as const) {
    const c = pos.length / 3;
    pos.push(x, 0, 0);
    nor.push(nx, 0, 0);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      pos.push(x, Math.cos(a), Math.sin(a));
      nor.push(nx, 0, 0);
    }
    for (let i = 0; i < radial; i++) idx.push(...(nx > 0 ? [c, c + 1 + i, c + 2 + i] : [c, c + 2 + i, c + 1 + i]));
  }
  return finish(pos, nor, idx);
}

/** Unit-radius sphere centred on the origin. */
export function sphereMesh(rings = 8, sectors = 14): MeshData {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const th = (s / sectors) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th);
      const y = Math.sin(phi) * Math.sin(th);
      const z = Math.cos(phi);
      pos.push(x, y, z);
      nor.push(x, y, z);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const a = r * (sectors + 1) + s;
      const b = a + sectors + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finish(pos, nor, idx);
}

/** Unit box: x,y in [-0.5, 0.5], z in [0, 1] (sits on the ground). */
export function boxMesh(): MeshData {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const faces: Array<{ n: [number, number, number]; v: number[][] }> = [
    { n: [0, 0, 1], v: [[-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]] },
    { n: [0, 0, -1], v: [[-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0]] },
    { n: [1, 0, 0], v: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]] },
    { n: [-1, 0, 0], v: [[-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]] },
    { n: [0, 1, 0], v: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]] },
  ];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const v of f.v) {
      pos.push(v[0]!, v[1]!, v[2]!);
      nor.push(...f.n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return finish(pos, nor, idx);
}

/**
 * Flow arrow lying on the +Z face of a unit-radius cylinder along +X: a shaft and a head, bent around
 * the surface (mesh y is the arc) and floating just above it. Spans x ∈ [-0.5, 0.5]; scale x by the
 * arrow length and y/z by the tube radius.
 */
export function arrowMesh(): MeshData {
  const R = 1.06;
  // outline in (x, arc) — shaft then head
  const shaftW = 0.16;
  const headW = 0.5;
  const neck = 0.05;
  const quads: Array<[number, number, number, number]> = [[-0.5, neck, -shaftW, shaftW]]; // x0, x1, w0, w1 strips
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const vert = (x: number, a: number) => {
    pos.push(x, Math.sin(a) * R, Math.cos(a) * R);
    nor.push(0, Math.sin(a), Math.cos(a));
    return pos.length / 3 - 1;
  };
  const STEPS = 4;
  // shaft: a curved strip
  for (const [x0, x1, w0, w1] of quads) {
    const first = pos.length / 3;
    for (let i = 0; i <= STEPS; i++) {
      const a = w0 + ((w1 - w0) * i) / STEPS;
      vert(x0, a);
      vert(x1, a);
    }
    for (let i = 0; i < STEPS; i++) {
      const v = first + i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  // head: fan from the tip over the curved base
  const tip = vert(0.5, 0);
  const baseFirst = pos.length / 3;
  for (let i = 0; i <= STEPS * 2; i++) vert(neck, -headW + (2 * headW * i) / (STEPS * 2));
  for (let i = 0; i < STEPS * 2; i++) idx.push(tip, baseFirst + i, baseFirst + i + 1);
  return finish(pos, nor, idx);
}
