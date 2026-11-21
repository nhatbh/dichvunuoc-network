/**
 * Pipe geometry for the map LoD tiers, written straight into typed arrays (no per-segment Geometry objects):
 *  - `buildTubes`: one merged mesh of continuous tubes (mitred at bends, closed at pipe ends), with per-vertex colour
 *    and the axis point of every vertex, so the tubes can be thickened in the shader (tubeMaterial);
 *  - `buildLines`: screen-space lines (LineSegments2) for the far tier, shaded across their width like a pipe, over a
 *    separate dark casing pass.
 * Each result keeps the vertex range of every pipe so colours are updated in place when the network state changes.
 * The flow direction is shown by arrows (flow-arrows.ts).
 */
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { XY } from '../data/geo'

/** tubes lie on the ground: their axis is this high plus their radius */
export const TUBE_GROUND = 0.35

export interface PipeInput {
  id: string
  path: XY[]
  radius: number
  z: number
  /** axis height per vertex, instead of `z` (a pipe end ramping to the height of the fitting it goes into) */
  zs?: number[]
  /**
   * Close this end with a half ball. Pass true only where the end shows: a dead end (a node no other pipe or fitting
   * touches), or at a bare junction (pipes meeting without a fitting) on the largest pipe there only, whose ball then
   * covers the smaller pipes' open ends; several half balls of different sizes on one node read as a knot.
   * Pass false where a long pipe was cut into pieces and where the end sits in a fitting's socket.
   */
  capStart?: boolean
  capEnd?: boolean
}
export interface Range {
  id: string
  start: number
  count: number
}

// ───────────── tube material: lit, thickened about the axis by uScale ─────────────
export function tubeMaterial() {
  const uniforms = {
    /** tubes are thickened by this about their axis, staying on the ground (aAxis.z = ground + base radius) */
    uScale: { value: 1 },
  }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 })
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aAxis;\nuniform float uScale;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
transformed = aAxis + (transformed - aAxis) * uScale;
transformed.z += (uScale - 1.0) * (aAxis.z - ${TUBE_GROUND.toFixed(2)});`,
    )
  }
  m.customProgramCacheKey = () => 'scaled-tube'
  return { material: m, uniforms }
}

// ───────────── tubes ─────────────
/** a mitre may stretch a ring this much at most (a turn of ~135°); sharper turns are bevelled and get a ball */
const MITRE_MAX = 2.6
/** collars only where the pipe visibly turns (cos 20°): a ball at every vertex of a curved CAD line reads as beads */
const COLLAR_COS = Math.cos((20 * Math.PI) / 180)
/** a collar stands just proud of the tube: at 1.0 it would z-fight the tube surface it touches */
const COLLAR_R = 1.04

/**
 * One merged mesh of tubes. Each pipe is one continuous tube: a ring at every vertex, mitred on the bisector of the
 * turn, so a polyline has no gaps at its bends. A turn too sharp to mitre gets two perpendicular rings (a bevel) and a
 * ball of the pipe's radius that fills the wedge between them. `capStart` / `capEnd` close a pipe end with a half ball
 * (see PipeInput). `joints` adds a slim collar where the pipe turns more than 20° (the near tier).
 */
export function buildTubes(pipes: PipeInput[], radial: number, joints: boolean): { geometry: THREE.BufferGeometry; ranges: Range[] } {
  const bandsHalf = Math.max(2, Math.round(radial / 4)) // latitude bands of a half ball
  const capV = (bandsHalf + 1) * (radial + 1)
  const capI = bandsHalf * radial * 6
  const ballV = (radial / 2 + 1) * (radial + 1)
  const ballI = (radial / 2) * radial * 6
  const clean = pipes
    .map(p => {
      const keep = p.path.map((q, i) => i === 0 || Math.hypot(q[0] - p.path[i - 1]![0], q[1] - p.path[i - 1]![1]) > 1e-4)
      const zs = p.path.map((_, i) => p.zs?.[i] ?? p.z).filter((_, i) => keep[i])
      return { ...p, path: p.path.filter((_, i) => keep[i]), zs }
    })
    .filter(p => p.path.length >= 2)
    .map(p => ({ ...p, seg: dirs(p.path) }))
  /** what an inner vertex gets: bevel = two rings instead of a mitred one, ball = its radius factor (0 = none) */
  const joint = (a: [number, number], b: [number, number]) => {
    const bevel = isSharp(a, b)
    const ball = joints && a[0] * b[0] + a[1] * b[1] < COLLAR_COS ? COLLAR_R : bevel ? 1 : 0
    return { bevel, ball }
  }
  let nv = 0
  let ni = 0
  for (const p of clean) {
    let rings = p.path.length
    let balls = 0
    for (let s = 1; s < p.path.length - 1; s++) {
      const j = joint(p.seg[s - 1]!, p.seg[s]!)
      if (j.bevel) rings++
      if (j.ball) balls++
    }
    nv += rings * (radial + 1)
    ni += (rings - 1) * radial * 6
    const caps = (p.capStart ? 1 : 0) + (p.capEnd ? 1 : 0)
    nv += caps * capV
    ni += caps * capI
    nv += balls * ballV
    ni += balls * ballI
  }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const col = new Float32Array(nv * 3).fill(0.7)
  const axis = new Float32Array(nv * 3)
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
  let v = 0
  let k = 0
  const ranges: Range[] = []
  /** a vertex, its normal, and the point on the pipe axis it belongs to */
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, ax: number, ay: number, az: number) => {
    axis[v * 3] = ax
    axis[v * 3 + 1] = ay
    axis[v * 3 + 2] = az
    pos[v * 3] = x
    pos[v * 3 + 1] = y
    pos[v * 3 + 2] = z
    nor[v * 3] = nx
    nor[v * 3 + 1] = ny
    nor[v * 3 + 2] = nz
    v++
  }
  /** triangles between consecutive rings of radial + 1 vertices, counter-clockwise seen from outside */
  const quads = (base: number, bands: number) => {
    for (let b = 0; b < bands; b++)
      for (let i = 0; i < radial; i++) {
        const q = base + b * (radial + 1) + i
        const q2 = q + radial + 1
        idx[k++] = q
        idx[k++] = q2
        idx[k++] = q + 1
        idx[k++] = q + 1
        idx[k++] = q2
        idx[k++] = q2 + 1
      }
  }
  /** a full ball around (cx, cy, z), or the half of it facing `dir` (a pipe end) */
  const ball = (cx: number, cy: number, z: number, r: number, dir: [number, number] | null) => {
    const base = v
    if (dir) {
      // from the tip on the pipe axis (φ = 0) back to the rim (φ = π/2), which meets the tube's end ring
      const [ax, ay] = dir
      for (let b = 0; b <= bandsHalf; b++) {
        const phi = (b / bandsHalf) * (Math.PI / 2)
        const c = Math.cos(phi)
        const sn = Math.sin(phi)
        for (let i = 0; i <= radial; i++) {
          const th = (i / radial) * Math.PI * 2
          const nx = ax * c - ay * sn * Math.cos(th)
          const ny = ay * c + ax * sn * Math.cos(th)
          const nz = sn * Math.sin(th)
          put(cx + nx * r, cy + ny * r, z + nz * r, nx, ny, nz, cx, cy, z)
        }
      }
      quads(base, bandsHalf)
    } else {
      const bands = radial / 2
      for (let b = 0; b <= bands; b++) {
        const phi = (b / bands) * Math.PI
        for (let i = 0; i <= radial; i++) {
          const th = (i / radial) * Math.PI * 2
          const nx = Math.sin(phi) * Math.cos(th)
          const ny = Math.sin(phi) * Math.sin(th)
          const nz = Math.cos(phi)
          put(cx + nx * r, cy + ny * r, z + nz * r, nx, ny, nz, cx, cy, z)
        }
      }
      quads(base, bands)
    }
  }
  for (const p of clean) {
    const start = v
    const n = p.path.length
    const seg = p.seg
    /** a ring around (x, y) whose side vector (sx, sy) points right of the pipe, stretched by m across the pipe */
    const ring = (x: number, y: number, z: number, sx: number, sy: number, m: number) => {
      // rings start on the right-hand side and turn up, so the triangles face outwards
      for (let i = 0; i <= radial; i++) {
        const ang = (i / radial) * Math.PI * 2
        const c = Math.cos(ang)
        const sn = Math.sin(ang)
        put(x + sx * c * p.radius * m, y + sy * c * p.radius * m, z + sn * p.radius, sx * c, sy * c, sn, x, y, z)
      }
    }
    const base = v
    let rings = 0
    for (let s = 0; s < n; s++) {
      const a = seg[Math.max(0, s - 1)]!
      const b = seg[Math.min(n - 2, s)]!
      const x = p.path[s]![0]
      const y = p.path[s]![1]
      const z = p.zs[s]!
      if (s > 0 && s < n - 1 && isSharp(a, b)) {
        // bevel: a clamped mitre ring would still reach ~2.5 r past the apex; perpendicular rings stay within r of the
        // vertex, so the band between them (chords of the ball) and the ends hide inside the ball added below
        ring(x, y, z, a[1], -a[0], 1)
        ring(x, y, z, b[1], -b[0], 1)
        rings += 2
        continue
      }
      // one ring on the bisector of the turn (mitre): the side vector is stretched by 1 / cos(half turn)
      let sx = -a[1] - b[1]
      let sy = a[0] + b[0]
      const sl = Math.hypot(sx, sy) // > 0: a turn that doubles back is sharp, handled above
      sx /= sl
      sy /= sl
      ring(x, y, z, -sx, -sy, Math.min(MITRE_MAX, 1 / Math.max(1e-3, -sx * b[1] + sy * b[0])))
      rings++
    }
    quads(base, rings - 1)
    // a ball fills each bevel, a slim collar marks a visible bend on the near tier
    for (let s = 1; s < n - 1; s++) {
      const j = joint(seg[s - 1]!, seg[s]!)
      if (j.ball) ball(p.path[s]![0], p.path[s]![1], p.zs[s]!, p.radius * j.ball, null)
    }
    if (p.capStart) ball(p.path[0]![0], p.path[0]![1], p.zs[0]!, p.radius, [-seg[0]![0], -seg[0]![1]])
    if (p.capEnd) ball(p.path[n - 1]![0], p.path[n - 1]![1], p.zs[n - 1]!, p.radius, seg[n - 2]!)
    ranges.push({ id: p.id, start, count: v - start })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return { geometry: g, ranges }
}

/** a turn the mitre cannot cover: its ring would stretch past MITRE_MAX (stretch = √(2 / (1 + cos turn))) */
const isSharp = (a: [number, number], b: [number, number]) => Math.sqrt(2 / Math.max(1e-6, 1 + a[0] * b[0] + a[1] * b[1])) > MITRE_MAX
/** unit direction of every segment of a path without zero-length segments */
function dirs(path: XY[]) {
  const seg: Array<[number, number]> = []
  for (let s = 1; s < path.length; s++) {
    const dx = path[s]![0] - path[s - 1]![0]
    const dy = path[s]![1] - path[s - 1]![1]
    const l = Math.hypot(dx, dy) || 1e-6
    seg.push([dx / l, dy / l])
  }
  return seg
}

/** Recolour a merged tube geometry in place. */
export function paintTubes(g: THREE.BufferGeometry, ranges: Range[], colorOf: (id: string) => THREE.Color) {
  const col = g.getAttribute('color') as THREE.BufferAttribute
  const c = col.array as Float32Array
  for (const r of ranges) {
    const cc = colorOf(r.id)
    for (let i = r.start; i < r.start + r.count; i++) {
      c[i * 3] = cc.r
      c[i * 3 + 1] = cc.g
      c[i * 3 + 2] = cc.b
    }
  }
  col.needsUpdate = true
}

// ───────────── fat lines ─────────────
/** the dark casing around a line, in device px: none below 3 px (a thin line is all colour), 1.2 px from 6 px */
const CASE_GLSL = 'float casePx = clamp((linewidth - 3.0) * 0.4, 0.0, 1.2);'
/** fixed screen direction of the light (up-left), so the highlight sits on one side of every pipe, however digitised */
const LIGHT_GLSL = 'const vec2 LIGHT = vec2(-0.6, 0.8);'

/**
 * Screen-space lines drawn as two passes over one geometry: a dark casing (renderOrder 0, child of `line`, so adding
 * `line` adds both) under the shaded fill (renderOrder 1). Every casing draws before every fill, so fills cover the
 * casings at bends and junctions instead of a casing cutting across a neighbouring segment's fill.
 * The casing shares the fill's `linewidth` and `resolution` uniforms: set them on `line.material` only. `linewidth` is
 * the whole visible width (casing included); the fill is drawn 2·casePx narrower. The casing runs `line`'s
 * onBeforeRender, so whatever that is set to applies to both.
 */
export function buildLines(
  pipes: Array<{ id: string; path: XY[]; z: number }>,
  width: number,
): { line: LineSegments2; casing: LineSegments2; ranges: Range[] } {
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
  // a pipe, not a flat stroke: lit across its width like a cylinder (brighter crown, darker flanks, a highlight on the
  // light side); the casing pass below holds it off the base map
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying float vSide;\n${LIGHT_GLSL}`)
      // vUv.x = +1 is the side `offset` points to; vSide turns it to the lit side
      .replace('vec2 offset = vec2( dir.y, - dir.x );', 'vec2 offset = vec2( dir.y, - dir.x );\nvSide = dot(offset, LIGHT) < 0.0 ? -1.0 : 1.0;')
      .replace('offset *= linewidth;', `${CASE_GLSL}\noffset *= linewidth - 2.0 * casePx;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSide;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      // distance from the axis, radial in the round ends so overlapping segments shade alike at a joint
      float w = abs(vUv.y) > 1.0 ? length(vec2(vUv.x, abs(vUv.y) - 1.0)) : abs(vUv.x);
      float t = (vUv.x * vSide - 0.32) / 0.2;
      // a line of a few pixels cannot show a cross-section (it would shimmer): it fades to its flat colour
      float k = smoothstep(2.0, 5.0, linewidth);
      float shade = mix(1.0, 0.6 + 0.4 * sqrt(max(0.0, 1.0 - w * w)), k);
      diffuseColor.rgb = diffuseColor.rgb * shade + exp(-t * t) * 0.32 * k;`,
    )
  }
  m.customProgramCacheKey = () => 'pipe-line'
  const line = new LineSegments2(g, m)
  line.computeLineDistances()
  line.renderOrder = 1

  // the casing: the status colour darkened, full width; collapsed off screen where a line is too thin for one
  const cm = new LineMaterial({ linewidth: width, vertexColors: true, worldUnits: false, transparent: false, depthWrite: false })
  cm.uniforms.linewidth = m.uniforms.linewidth!
  cm.uniforms.resolution = m.uniforms.resolution!
  cm.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('offset *= linewidth;', `${CASE_GLSL}\noffset *= linewidth;`)
      .replace('clip.xy += offset;', 'clip.xy += offset;\nif (casePx <= 0.0) clip = vec4(0.0, 0.0, 2.0, 1.0);')
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.32;')
  }
  cm.customProgramCacheKey = () => 'pipe-line-casing'
  const casing = new LineSegments2(g, cm)
  casing.renderOrder = 0
  casing.raycast = () => {} // picking hits the fill only
  casing.onBeforeRender = (...a) => line.onBeforeRender(...a)
  line.add(casing)
  return { line, casing, ranges }
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
