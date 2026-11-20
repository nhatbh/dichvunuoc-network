/**
 * Pipe geometry for the map LoD tiers, written straight into typed arrays (no per-segment Geometry objects):
 *  - `buildTubes`: one merged mesh of open cylinders (+ optional joint spheres), with per-vertex colour,
 *    distance along the pipe and flow speed, so the flow stripes animate on the GPU (flowMaterial);
 *  - `buildLines`: fat screen-space lines (LineSegments2) for the far tier.
 * Each result keeps the vertex range of every pipe so colours / speeds are updated in place when the
 * network state changes.
 */
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { XY } from '../data/geo'

export interface PipeInput {
  id: string
  path: XY[]
  radius: number
  z: number
  /** distance along the full pipe at path[0] (pieces of a split pipe keep counting) */
  d0?: number
}
export interface Range {
  id: string
  start: number
  count: number
}

// ───────────── flow material: lit tubes with moving stripes ─────────────
export function flowMaterial(opts: { stripe?: number; opacity?: number } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uSpacing: { value: 14 },
    uStripe: { value: opts.stripe ?? 0.55 },
  }
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.15,
    transparent: (opts.opacity ?? 1) < 1,
    opacity: opts.opacity ?? 1,
  })
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDist;\nattribute float aSpeed;\nvarying float vDist;\nvarying float vSpeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;\nvSpeed = aSpeed;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSpacing;\nuniform float uStripe;\nvarying float vDist;\nvarying float vSpeed;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sp = vSpeed;
        float ph = fract((vDist - uTime * sp) / uSpacing);
        float band = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.28, 0.36, ph));
        float on = step(0.02, abs(sp)) * uStripe;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.55), band * on);`,
      )
  }
  m.customProgramCacheKey = () => 'flow-tube'
  return { material: m, uniforms }
}

// ───────────── tubes ─────────────
export function buildTubes(pipes: PipeInput[], radial: number, joints: boolean): { geometry: THREE.BufferGeometry; ranges: Range[] } {
  // count vertices / indices first
  let nv = 0
  let ni = 0
  const sphereV = joints ? (radial / 2 + 1) * (radial + 1) : 0
  const sphereI = joints ? (radial / 2) * radial * 6 : 0
  for (const p of pipes) {
    const segs = p.path.length - 1
    nv += segs * (radial + 1) * 2
    ni += segs * radial * 6
    if (joints) {
      nv += Math.max(0, p.path.length - 2) * sphereV
      ni += Math.max(0, p.path.length - 2) * sphereI
    }
  }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const col = new Float32Array(nv * 3).fill(0.7)
  const dst = new Float32Array(nv)
  const spd = new Float32Array(nv)
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
  let v = 0
  let k = 0
  const ranges: Range[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const n1 = new THREE.Vector3()
  const n2 = new THREE.Vector3()
  const up = new THREE.Vector3(0, 0, 1)
  for (const p of pipes) {
    const start = v
    let along = p.d0 ?? 0
    for (let s = 1; s < p.path.length; s++) {
      a.set(p.path[s - 1]![0], p.path[s - 1]![1], p.z)
      b.set(p.path[s]![0], p.path[s]![1], p.z)
      dir.subVectors(b, a)
      const len = dir.length()
      if (len < 1e-6) dir.set(1, 0, 0)
      dir.normalize()
      n1.crossVectors(dir, up)
      if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0)
      n1.normalize()
      n2.crossVectors(n1, dir).normalize()
      const base = v
      for (let i = 0; i <= radial; i++) {
        const ang = (i / radial) * Math.PI * 2
        const cx = Math.cos(ang)
        const sy = Math.sin(ang)
        const nx = n1.x * cx + n2.x * sy
        const ny = n1.y * cx + n2.y * sy
        const nz = n1.z * cx + n2.z * sy
        for (const [pt, d] of [
          [a, along],
          [b, along + len],
        ] as const) {
          pos[v * 3] = pt.x + nx * p.radius
          pos[v * 3 + 1] = pt.y + ny * p.radius
          pos[v * 3 + 2] = pt.z + nz * p.radius
          nor[v * 3] = nx
          nor[v * 3 + 1] = ny
          nor[v * 3 + 2] = nz
          dst[v] = d
          v++
        }
      }
      // counter-clockwise seen from outside (normals point out)
      for (let i = 0; i < radial; i++) {
        const q = base + i * 2
        idx[k++] = q
        idx[k++] = q + 1
        idx[k++] = q + 2
        idx[k++] = q + 1
        idx[k++] = q + 3
        idx[k++] = q + 2
      }
      along += len
    }
    if (joints) {
      let acc = p.d0 ?? 0
      for (let s = 1; s < p.path.length - 1; s++) {
        acc += Math.hypot(p.path[s]![0] - p.path[s - 1]![0], p.path[s]![1] - p.path[s - 1]![1])
        const cx = p.path[s]![0]
        const cy = p.path[s]![1]
        const rings = radial / 2
        const base = v
        for (let r = 0; r <= rings; r++) {
          const phi = (r / rings) * Math.PI
          for (let i = 0; i <= radial; i++) {
            const th = (i / radial) * Math.PI * 2
            const nx = Math.sin(phi) * Math.cos(th)
            const ny = Math.sin(phi) * Math.sin(th)
            const nz = Math.cos(phi)
            pos[v * 3] = cx + nx * p.radius * 1.12
            pos[v * 3 + 1] = cy + ny * p.radius * 1.12
            pos[v * 3 + 2] = p.z + nz * p.radius * 1.12
            nor[v * 3] = nx
            nor[v * 3 + 1] = ny
            nor[v * 3 + 2] = nz
            dst[v] = acc
            v++
          }
        }
        for (let r = 0; r < rings; r++)
          for (let i = 0; i < radial; i++) {
            const q = base + r * (radial + 1) + i
            const q2 = q + radial + 1
            idx[k++] = q
            idx[k++] = q2
            idx[k++] = q + 1
            idx[k++] = q + 1
            idx[k++] = q2
            idx[k++] = q2 + 1
          }
      }
    }
    ranges.push({ id: p.id, start, count: v - start })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aDist', new THREE.BufferAttribute(dst, 1))
  g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return { geometry: g, ranges }
}

/** Recolour / re-speed a merged tube geometry in place. */
export function paintTubes(g: THREE.BufferGeometry, ranges: Range[], colorOf: (id: string) => THREE.Color, speedOf: (id: string) => number) {
  const col = g.getAttribute('color') as THREE.BufferAttribute
  const spd = g.getAttribute('aSpeed') as THREE.BufferAttribute
  const c = col.array as Float32Array
  const s = spd.array as Float32Array
  for (const r of ranges) {
    const cc = colorOf(r.id)
    const sp = speedOf(r.id)
    for (let i = r.start; i < r.start + r.count; i++) {
      c[i * 3] = cc.r
      c[i * 3 + 1] = cc.g
      c[i * 3 + 2] = cc.b
      s[i] = sp
    }
  }
  col.needsUpdate = true
  spd.needsUpdate = true
}

// ───────────── fat lines ─────────────
export function buildLines(pipes: Array<{ id: string; path: XY[]; z: number }>, width: number): { line: LineSegments2; ranges: Range[] } {
  const seg: number[] = []
  const ranges: Range[] = []
  for (const p of pipes) {
    const start = seg.length / 6
    for (let i = 1; i < p.path.length; i++) seg.push(p.path[i - 1]![0], p.path[i - 1]![1], p.z, p.path[i]![0], p.path[i]![1], p.z)
    ranges.push({ id: p.id, start, count: seg.length / 6 - start })
  }
  const g = new LineSegmentsGeometry()
  g.setPositions(seg)
  g.setColors(new Array((seg.length / 6) * 6).fill(0.6))
  const m = new LineMaterial({ linewidth: width, vertexColors: true, worldUnits: false, transparent: false })
  const line = new LineSegments2(g, m)
  line.computeLineDistances()
  return { line, ranges }
}

export function paintLines(line: LineSegments2, ranges: Range[], colorOf: (id: string) => THREE.Color) {
  const g = line.geometry as LineSegmentsGeometry
  const attr = g.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute
  const arr = attr.data.array as Float32Array
  for (const r of ranges) {
    const c = colorOf(r.id)
    for (let i = r.start; i < r.start + r.count; i++) {
      arr[i * 6] = c.r
      arr[i * 6 + 1] = c.g
      arr[i * 6 + 2] = c.b
      arr[i * 6 + 3] = c.r
      arr[i * 6 + 4] = c.g
      arr[i * 6 + 5] = c.b
    }
  }
  attr.data.needsUpdate = true
}
