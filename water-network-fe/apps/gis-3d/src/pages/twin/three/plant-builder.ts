/**
 * 3D model of the Sông Hồng plant from its CAD footprints (plant frame: drawing axes, metres, z up).
 *
 *   level 1  massing: every structure as one prism + the pond — 1 merged mesh (far map LoD)
 *   level 2  + open basins with water, covered reservoir, building parapets, roads, fence, trees (mid LoD)
 *   level 3  + flocculation / lamella / filter cells, lamella plate packs, troughs, windows, roof units,
 *            process pipe racks, scrubber, transformer (near LoD)
 *   factory  level 3 without roofs (roofs on their own toggle), equipment models, interior floors
 *
 * Static parts are merged into a few vertex-coloured meshes per level so the map pays a handful of draw calls.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { equipmentModel } from './equipment'
import { EQUIPMENT, PLANT, R, rectOf, STRUCTURE_BY_ID, type Rect, type Structure } from '../data/plant-model'
import type { XY } from '../data/geo'

// ───────────── merged, vertex-coloured batches ─────────────
const tmpColor = new THREE.Color()
export class Batch {
  geos: THREE.BufferGeometry[] = []
  add(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
    let geo = g.index ? g.toNonIndexed() : g
    if (geo === g) geo = g.clone()
    geo.deleteAttribute('uv')
    if (!geo.getAttribute('normal')) geo.computeVertexNormals()
    if (m) geo.applyMatrix4(m)
    tmpColor.setHex(color)
    const n = geo.getAttribute('position').count
    const c = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      c[i * 3] = tmpColor.r
      c[i * 3 + 1] = tmpColor.g
      c[i * 3 + 2] = tmpColor.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
    this.geos.push(geo)
    g.dispose()
  }
  box(w: number, d: number, h: number, x: number, y: number, z: number, color: number, rotZ = 0) {
    const m = new THREE.Matrix4().makeRotationZ(rotZ).setPosition(x, y, z + h / 2)
    this.add(new THREE.BoxGeometry(w, d, h), color, m)
  }
  prism(poly: readonly (readonly number[])[], z0: number, z1: number, color: number, holes: XY[][] = []) {
    const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])))
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))))
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.02, z1 - z0), bevelEnabled: false, curveSegments: 1 })
    g.translate(0, 0, z0)
    this.add(g, color)
  }
  flat(poly: readonly (readonly number[])[], z: number, color: number) {
    const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1]))))
    g.translate(0, 0, z)
    this.add(g, color)
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: number, seg = 16) {
    const g = new THREE.CylinderGeometry(r, r, h, seg)
    g.rotateX(Math.PI / 2)
    g.translate(x, y, z + h / 2)
    this.add(g, color)
  }
  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.geos.length) return null
    const g = mergeGeometries(this.geos, false)
    this.geos.forEach(x => x.dispose())
    this.geos = []
    g.computeBoundingSphere()
    const m = new THREE.Mesh(g, material)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }
}

export const solidMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 })
export const waterMaterial = (color = 0x3d8fd1, opacity = 0.82) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.1, transparent: true, opacity, depthWrite: false })

// ───────────── geometry helpers ─────────────
function walls(b: Batch, r: Rect, h: number, t: number, color: number, z0 = 0) {
  b.box(r.w, t, h, r.cx, r.y0 + t / 2, z0, color)
  b.box(r.w, t, h, r.cx, r.y1 - t / 2, z0, color)
  b.box(t, r.h - 2 * t, h, r.x0 + t / 2, r.cy, z0, color)
  b.box(t, r.h - 2 * t, h, r.x1 - t / 2, r.cy, z0, color)
}
const shrink = (r: Rect, d: number): XY[] => [
  [r.x0 + d, r.y0 + d],
  [r.x1 - d, r.y0 + d],
  [r.x1 - d, r.y1 - d],
  [r.x0 + d, r.y1 - d],
]
/** inward offset of a simple polygon (miter, clamped) */
export function offsetPolygon(poly: XY[], d: number): XY[] {
  const n = poly.length
  let area = 0
  for (let i = 0; i < n; i++) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1]
  const sgn = area > 0 ? 1 : -1
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n]!
    const c = poly[(i + 1) % n]!
    const e1 = [p[0] - a[0], p[1] - a[1]]
    const e2 = [c[0] - p[0], c[1] - p[1]]
    const l1 = Math.hypot(e1[0]!, e1[1]!) || 1
    const l2 = Math.hypot(e2[0]!, e2[1]!) || 1
    const n1 = [(-e1[1]! / l1) * sgn, (e1[0]! / l1) * sgn]
    const n2 = [(-e2[1]! / l2) * sgn, (e2[0]! / l2) * sgn]
    const mx = n1[0]! + n2[0]!
    const my = n1[1]! + n2[1]!
    const ml = Math.hypot(mx, my) || 1
    const cos = (n1[0]! * n2[0]! + n1[1]! * n2[1]!) / 1
    const k = d / Math.max(0.35, Math.sqrt((1 + cos) / 2))
    return [p[0] + (mx / ml) * k, p[1] + (my / ml) * k] as XY
  })
}

// ───────────── process pipes (plant frame, assumed routes between the drawn units) ─────────────
export type Fluid = 'raw' | 'settled' | 'clean' | 'chem' | 'chlorine' | 'air' | 'waste' | 'wash'
export const FLUID_COLOR: Record<Fluid, number> = {
  raw: 0x9c7a4a,
  settled: 0x6ea7a0,
  clean: 0x2f86d6,
  chem: 0xd9a21b,
  chlorine: 0x8fc93a,
  air: 0xcfd8dc,
  waste: 0x7b6650,
  wash: 0x4fb3e8,
}
export interface ProcessPipe {
  id: string
  fluid: Fluid
  dn: number
  path: Array<[number, number, number]>
  /** which simulated flow drives its particles */
  flow: 'raw' | 'transfer' | 'filtered' | 'out' | 'backwash' | 'air' | 'pac' | 'cl' | 'waste'
}
function processPipes(): ProcessPipe[] {
  const s3 = R('S03')
  const s4 = rectOf(PLANT.parts.S04.mixing)
  const gal = rectOf(PLANT.parts.S05.gallery)
  const s6 = R('S06')
  const s7 = R('S07')
  const s7b = R('S07B')
  const s8 = R('S08')
  const s9 = R('S09')
  const s10 = R('S10')
  const inlet = PLANT.inletOutfall
  const bx = Math.min(...PLANT.boundary.map(p => p[0]))
  const p: ProcessPipe[] = [
    { id: 'pp-raw-in', fluid: 'raw', dn: 600, flow: 'raw', path: [[inlet[0], -112, 0.8], [inlet[0], inlet[1] - 2, 0.8], [inlet[0], inlet[1] + 3, 0.8]] },
    { id: 'pp-pond-ct', fluid: 'raw', dn: 600, flow: 'transfer', path: [[s3.cx, s3.y0 - 9, 0.6], [s3.cx, s3.y0, 0.6]] },
    { id: 'pp-ct-mix', fluid: 'raw', dn: 600, flow: 'transfer', path: [[s3.x0, s3.cy, 2.4], [s4.cx + 3.5, s3.cy, 2.4], [s4.cx, s3.cy, 2.4], [s4.cx, s4.y0 - 0.4, 2.4], [s4.cx, s4.y0 - 0.4, 5.6], [s4.cx, s4.cy, 5.6]] },
    { id: 'pp-filt-res', fluid: 'clean', dn: 800, flow: 'filtered', path: [[gal.cx, gal.cy, 1.0], [gal.cx, gal.y1 + 1, 1.0], [gal.cx, s6.y0 + 1.5, 1.0]] },
    ...[0, 1, 2].map((i): ProcessPipe => {
      const x = s7.x1 - 9 - i * 8.5 - 0.66
      return { id: `pp-suc-${i}`, fluid: 'clean', dn: 500, flow: 'out', path: [[x, s6.y1 - 1.5, 0.95], [x, s7.y0, 0.95], [x, s7.cy - 1.9, 0.95]] }
    }),
    { id: 'pp-out', fluid: 'clean', dn: 1000, flow: 'out', path: [[s7.x1 - 6, s7.cy + 2.6, 0.75], [s7.x0 + 1, s7.cy + 2.6, 0.75], [s7.x0 - 2, s7.cy + 2.6, 0.75], [bx - 2, s7.cy + 2.6, 0.75]] },
    { id: 'pp-bw', fluid: 'wash', dn: 500, flow: 'backwash', path: [[s7b.x0 + 4, s7b.y0, 0.9], [s7b.x0 + 4, s7b.y0 - 2, 0.9], [s6.x0 - 2.5, s7b.y0 - 2, 0.9], [s6.x0 - 2.5, gal.cy, 0.9], [gal.x0, gal.cy, 0.9]] },
    { id: 'pp-air', fluid: 'air', dn: 300, flow: 'air', path: [[s7b.x0 + 15, s7b.y0, 1.6], [s7b.x0 + 15, s7b.y0 - 3, 1.6], [s6.x0 - 4.2, s7b.y0 - 3, 1.6], [s6.x0 - 4.2, gal.cy + 1.2, 1.6], [gal.x0, gal.cy + 1.2, 1.6]] },
    { id: 'pp-pac', fluid: 'chem', dn: 80, flow: 'pac', path: [[s8.x1, s8.cy, 2.8], [s4.cx - 6, s8.cy, 2.8], [s4.cx - 6, s4.cy, 2.8], [s4.cx - 6, s4.cy, 5.9], [s4.cx - 1, s4.cy, 5.9]] },
    { id: 'pp-cl-pre', fluid: 'chlorine', dn: 50, flow: 'cl', path: [[s9.cx, s9.y1, 3.2], [s9.cx, s9.y1 + 3, 3.2], [s4.cx - 7, s9.y1 + 3, 3.2], [s4.cx - 7, s3.cy - 1, 3.2], [s4.cx + 2, s3.cy - 1, 3.2]] },
    { id: 'pp-cl-post', fluid: 'chlorine', dn: 50, flow: 'cl', path: [[s9.x0 + 2, s9.y1, 3.4], [s9.x0 + 2, s9.y1 + 5, 3.4], [s6.x0 - 6, s9.y1 + 5, 3.4], [s6.x0 - 6, s6.y0 + 2, 3.4], [gal.cx - 1, s6.y0 + 2, 3.4]] },
    { id: 'pp-waste', fluid: 'waste', dn: 400, flow: 'waste', path: [[gal.x0 + 1, gal.y0, 0.5], [gal.x0 - 3, gal.y0, 0.5], [s10.cx, gal.y0, 0.5], [s10.cx, s10.y1, 0.5]] },
  ]
  return p
}
export const PROCESS_PIPES = processPipes()

// ───────────── the plant ─────────────
export interface PlantModel {
  group: THREE.Group
  roofs: THREE.Object3D[]
  equipment: Map<string, THREE.Group>
  water: { pond?: THREE.Mesh; reservoir?: THREE.Mesh; filters: THREE.Mesh[]; lamella: THREE.Mesh[] }
  hitbox: THREE.Mesh
}

const ROOF = 0x8d6e5c
const ROOF_FLAT = 0x9aa7ad
const CONCRETE = 0xc4c2ba
const GROUND = 0xa9bf8f
const ROAD = 0x6b7075
const WATER = 0x3d8fd1
const RAW_WATER = 0x6e8c8e

function isBuilding(s: Structure) {
  return s.roof === 'flat'
}

export function buildPlant(level: 1 | 2 | 3 | 'factory'): PlantModel {
  const group = new THREE.Group()
  group.name = `plant-L${level}`
  const solid = new Batch()
  const roofB = new Batch()
  const detail = level === 3 || level === 'factory'
  const factory = level === 'factory'
  const water: PlantModel['water'] = { filters: [], lamella: [] }
  const waterB = new Batch()
  const roofs: THREE.Object3D[] = []

  // site pad + boundary
  if (level !== 1) {
    solid.flat(PLANT.boundary, 0.03, GROUND)
    for (let i = 0; i < PLANT.boundary.length; i++) {
      const a = PLANT.boundary[i]!
      const c = PLANT.boundary[(i + 1) % PLANT.boundary.length]!
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      solid.box(len, 0.25, detail ? 2.2 : 1.6, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0, 0xd8d4c8, Math.atan2(c[1] - a[1], c[0] - a[0]))
    }
    for (const r of PLANT.roads) {
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]!
        const c = r[i]!
        const len = Math.hypot(c[0] - a[0], c[1] - a[1])
        if (len < 0.5) continue
        solid.box(len + 1.8, 3.6, 0.06, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0.03, ROAD, Math.atan2(c[1] - a[1], c[0] - a[0]))
      }
    }
  } else {
    solid.prism(PLANT.boundary, 0, 0.15, 0xc7cfbf)
  }

  for (const s of PLANT.structures) {
    const r = rectOf(s.poly)
    if (s.kind === 'pond') {
      if (level === 1) {
        solid.flat(s.poly, 0.2, RAW_WATER)
        continue
      }
      const inner = offsetPolygon(s.poly, 4)
      solid.prism(s.poly, 0, 0.7, 0x9c9a83, [inner.slice().reverse()])
      const wm = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inner.map(p => new THREE.Vector2(p[0], p[1])))), waterMaterial(RAW_WATER, 0.9))
      wm.position.z = 0.1
      wm.userData.baseZ = -0.9
      group.add(wm)
      water.pond = wm
      continue
    }
    if (level === 1) {
      solid.prism(s.poly, 0, s.height, s.roof === 'open' ? CONCRETE : s.color)
      continue
    }
    switch (s.roof) {
      case 'open': {
        walls(solid, r, s.height, 0.45, CONCRETE)
        if (!detail) waterB.flat(shrink(r, 0.4), s.height - (s.water ?? 0.5), WATER)
        break
      }
      case 'covered': {
        if (s.kind === 'reservoir') {
          if (factory) {
            walls(solid, r, s.height + 0.2, 0.5, CONCRETE)
            const wm = new THREE.Mesh(new THREE.PlaneGeometry(r.w - 1, r.h - 1), waterMaterial(0x2f86d6, 0.8))
            wm.position.set(r.cx, r.cy, 1)
            water.reservoir = wm
            group.add(wm)
            roofB.prism(shrink(r, 0.0), s.height, s.height + 0.25, 0x8fa39a)
          } else {
            solid.prism(s.poly, 0, s.height, 0xb5c0b8)
            solid.prism(shrink(r, 0.6), s.height, s.height + 0.15, 0x8fa39a)
          }
          if (detail) for (let i = 0; i < 6; i++) roofB.cyl(0.35, 0.9, r.x0 + 5 + (i % 3) * 15, r.y0 + 10 + Math.floor(i / 3) * 26, s.height, 0xd9d6cc, 10)
        } else {
          // parking canopy
          for (const [x, y] of [
            [r.x0 + 0.3, r.y0 + 0.3],
            [r.x1 - 0.3, r.y0 + 0.3],
            [r.x0 + 0.3, r.y1 - 0.3],
            [r.x1 - 0.3, r.y1 - 0.3],
          ] as const)
            solid.box(0.2, 0.2, s.height, x, y, 0, 0x6f777a)
          ;(factory ? roofB : solid).prism(s.poly, s.height, s.height + 0.12, 0x5f7f8f)
        }
        break
      }
      case 'flat': {
        if (factory) {
          // interior visible: floor + walls with a window band, roof on its own toggle
          solid.prism(shrink(r, 0.2), 0, 0.15, 0xbfc3bd)
          walls(solid, r, s.height, 0.3, s.color)
          if (s.kind !== 'guard') {
            for (const side of [0, 1]) solid.box(r.w * 0.86, 0.05, 1.0, r.cx, side ? r.y1 + 0.01 : r.y0 - 0.01, s.height * 0.55, 0x3a4d5a)
          }
          roofB.prism(s.poly, s.height, s.height + 0.3, ROOF_FLAT)
          roofB.prism(s.poly.map(p => [p[0], p[1]] as XY), s.height + 0.3, s.height + 0.8, s.color, [shrink(r, 0.3).reverse()])
        } else {
          solid.prism(s.poly, 0, s.height, s.color)
          solid.prism(s.poly, s.height, s.height + 0.6, s.color, [shrink(r, 0.3).reverse()])
          solid.prism(shrink(r, 0.3), s.height, s.height + 0.08, s.kind === 'admin' ? ROOF : ROOF_FLAT)
          if (detail) {
            for (const side of [0, 1]) solid.box(r.w * 0.86, 0.05, 1.0, r.cx, side ? r.y1 + 0.01 : r.y0 - 0.01, s.height * 0.55, 0x3a4d5a)
            solid.box(2.2, 1.6, 1.2, r.x1 - 3, r.cy, s.height + 0.08, 0xb7bcbf)
          }
        }
        break
      }
      default:
        solid.prism(s.poly, 0, s.height, s.color)
    }
  }

  // treatment-train internals
  if (detail) {
    const S04 = PLANT.parts.S04
    const s4h = STRUCTURE_BY_ID.S04!.height
    for (const c of S04.floc) {
      const r = rectOf(c)
      walls(solid, r, s4h, 0.25, 0xb8b6ae)
      waterB.flat(shrink(r, 0.25), s4h - 0.45, 0x5d97b8)
    }
    const mix = rectOf(S04.mixing)
    walls(solid, mix, s4h, 0.25, 0xb8b6ae)
    waterB.flat(shrink(mix, 0.25), s4h - 0.4, 0x6d8f86)
    for (const c of S04.lamella) {
      const r = rectOf(c)
      walls(solid, r, s4h, 0.3, 0xb8b6ae)
      // plate packs: inclined slats across the tank
      const n = Math.floor((r.h - 2) / 0.55)
      for (let i = 0; i < n; i++) solid.box(r.w - 0.8, 0.04, 0.95, r.cx, r.y0 + 1 + i * 0.55, s4h - 1.6, 0xe8e6dc, 0)
      // collection troughs
      for (let i = 0; i < 4; i++) solid.box(r.w - 0.8, 0.25, 0.35, r.cx, r.y0 + 2.5 + i * ((r.h - 5) / 3), s4h - 0.5, 0x9aa3a8)
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(r.w - 0.6, r.h - 0.6), waterMaterial(0x4d93b5, 0.55))
      wm.position.set(r.cx, r.cy, s4h - 0.35)
      group.add(wm)
      water.lamella.push(wm)
      // walkway bridge
      solid.box(r.w, 1.0, 0.12, r.cx, r.cy, s4h + 0.05, 0x9aa3a8)
    }
    solid.box(rectOf(S04.channel).w, rectOf(S04.channel).h, 0.2, rectOf(S04.channel).cx, rectOf(S04.channel).cy, s4h - 0.6, 0x8fa3a8)

    const S05 = PLANT.parts.S05
    const s5h = STRUCTURE_BY_ID.S05!.height
    for (const c of S05.cells) {
      const r = rectOf(c)
      walls(solid, r, s5h, 0.3, 0xb8b6ae)
      solid.prism(shrink(r, 0.3), 0.6, 1.6, 0xd8c59a) // sand bed
      for (let i = 1; i <= 2; i++) solid.box(0.5, r.h - 0.6, 0.45, r.x0 + (r.w * i) / 3, r.cy, s5h - 1.1, 0x9aa3a8) // wash troughs
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(r.w - 0.6, r.h - 0.6), waterMaterial(0x4f9fd8, 0.7))
      wm.position.set(r.cx, r.cy, s5h - 0.6)
      wm.userData.full = s5h - 0.6
      group.add(wm)
      water.filters.push(wm)
    }
    const g = rectOf(S05.gallery)
    if (!factory) solid.prism(shrink(g, 0), 0, s5h + 1.8, 0xe2dccd)
    else {
      walls(solid, g, s5h + 1.8, 0.25, 0xe2dccd)
      roofB.prism(shrink(g, 0), s5h + 1.8, s5h + 2.0, ROOF_FLAT)
    }

    // process pipes (static colours)
    for (const pp of PROCESS_PIPES) {
      const pts = pp.path
      for (let i = 1; i < pts.length; i++) {
        const a = new THREE.Vector3(...pts[i - 1]!)
        const c = new THREE.Vector3(...pts[i]!)
        const len = a.distanceTo(c)
        if (len < 0.01) continue
        const cg = new THREE.CylinderGeometry(Math.max(0.06, pp.dn / 2000), Math.max(0.06, pp.dn / 2000), len, 12, 1, true)
        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize())
        m.compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))
        solid.add(cg, FLUID_COLOR[pp.fluid], m)
        if (i < pts.length - 1) {
          const sg = new THREE.SphereGeometry(Math.max(0.06, pp.dn / 2000) * 1.08, 10, 6)
          sg.translate(c.x, c.y, c.z)
          solid.add(sg, FLUID_COLOR[pp.fluid])
        }
      }
      // supports under raised runs
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!
        const c = pts[i]!
        if (Math.min(a[2], c[2]) < 1.4) continue
        const len = Math.hypot(c[0] - a[0], c[1] - a[1])
        for (let d = 3; d < len; d += 6) {
          const t = d / len
          solid.box(0.18, 0.18, a[2] - 0.1, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 0, 0x7d878c)
        }
      }
    }
    // yard equipment that reads from the map too
    if (!factory) {
      const s9 = R('S09')
      solid.cyl(0.9, 6.5, s9.x0 - 2.2, s9.cy, 0, 0x9cb6c2)
      const s11 = R('S11')
      solid.box(2.4, 1.6, 2.5, s11.x1 + 3.6, s11.cy, 0, 0x5d7066)
    }
    // inlet outfall (legend 1)
    solid.box(4, 4, 1.2, PLANT.inletOutfall[0], PLANT.inletOutfall[1], 0, CONCRETE)
    // gate posts + fountain
    for (const p of PLANT.gate) solid.box(0.8, 0.8, 2.6, p[0], p[1], 0, 0xd8d4c8)
    solid.prism(PLANT.fountain, 0, 0.5, 0xc9c5ba, [offsetPolygon(PLANT.fountain, 0.5).reverse()])
    waterB.flat(offsetPolygon(PLANT.fountain, 0.5), 0.35, 0x4fa3d8)
  }

  // trees (instanced)
  if (level !== 1) {
    const n = PLANT.trees.length
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, detail ? 1 : 0), new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 0.9, flatShading: true }), n)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 3.2, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 1 }), n)
    const m = new THREE.Matrix4()
    PLANT.trees.forEach(([x, y], i) => {
      const s = 0.85 + ((i * 37) % 10) / 25
      m.makeScale(s, s, s * 1.15).setPosition(x, y, 4.2 * s)
      crown.setMatrixAt(i, m)
      m.makeTranslation(x, y, 1.6)
      trunk.setMatrixAt(i, m)
    })
    crown.castShadow = true
    trunk.castShadow = true
    group.add(crown, trunk)
  }

  const sm = solid.mesh(solidMaterial())
  if (sm) group.add(sm)
  const wm = waterB.mesh(waterMaterial(WATER, 0.85))
  if (wm) {
    wm.castShadow = false
    group.add(wm)
  }
  const rm = roofB.mesh(solidMaterial())
  if (rm) {
    rm.name = 'roofs'
    roofs.push(rm)
    group.add(rm)
  }

  // equipment (factory only)
  const equipment = new Map<string, THREE.Group>()
  if (factory) {
    const pitch = rectOf(PLANT.parts.S04.floc[1]!).cx - rectOf(PLANT.parts.S04.floc[0]!).cx
    for (const e of EQUIPMENT) {
      if (e.unit === 'TB1') continue
      const g = equipmentModel(e, { flocPitch: pitch })
      if (e.kind === 'lamella' || e.kind === 'filter') {
        const part = e.kind === 'lamella' ? PLANT.parts.S04.lamella[Number(e.tag.slice(-1)) - 1]! : PLANT.parts.S05.cells[Number(e.tag.slice(-1)) - 1]!
        const r = rectOf(part)
        const hb = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, 0.6), new THREE.MeshBasicMaterial({ visible: false }))
        hb.position.set(0, 0, -0.3)
        hb.userData.tag = e.tag
        g.add(hb)
      }
      group.add(g)
      equipment.set(e.tag, g)
    }
  }

  // invisible hit box of the whole site (map picking)
  const b = rectOf(PLANT.boundary)
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 12), new THREE.MeshBasicMaterial({ visible: false }))
  hitbox.position.set(b.cx, b.cy, 6)
  hitbox.userData.pick = 'plant'
  group.add(hitbox)
  return { group, roofs, equipment, water, hitbox }
}

/** Isolation helper: buildings' footprint outlines for the factory minimap / labels. */
export const isBuildingStructure = isBuilding
