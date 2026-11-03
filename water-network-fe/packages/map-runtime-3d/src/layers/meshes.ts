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
