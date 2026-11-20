/**
 * Distance-based level of detail for the pipe network on the map.
 *
 * The network is cut into 300 m chunks (long pipes are split into ≤ 120 m pieces, each piece goes to the chunk
 * of its midpoint). Every frame each chunk picks a level from the camera's distance to its bounding sphere, so a
 * tilted view draws near chunks in full detail and far chunks as lines in the same frame:
 *
 *   L0  far      fat screen-space lines (2 draw calls per chunk), no service lines, no devices
 *   L1  mid      low-poly tubes (6 sides, ×4 radius), service lines as thin lines, valve markers
 *   L2  near     smooth tubes (14 sides, joints, ×2.2 radius), service tubes, valves, fittings, meter boxes
 *
 * Levels are built lazily the first time a chunk needs them and kept; switching only flips visibility.
 * A 15 % hysteresis band stops chunks flickering on the threshold.
 */
import * as THREE from 'three'
import { NET, PIPE_BY_ID, type NetPipe } from '../data/network-model'
import { buildLines, buildTubes, flowMaterial, paintLines, paintTubes, type PipeInput, type Range } from '../three/pipe-mesh'
import type { XY } from '../data/geo'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'

export type LodLevel = 0 | 1 | 2
export const LOD_NAMES = ['L0 · đường', 'L1 · ống thô', 'L2 · ống chi tiết'] as const
export const LOD_COLORS = [0x6c8ebf, 0xf0a020, 0x2fb36a] as const
const CHUNK = 300
const PIECE = 120
export const LOD_DIST = { l2: 240, l1: 1200 }

interface Piece {
  id: string
  pipe: NetPipe
  path: XY[]
  d0: number
}
interface Built {
  root: THREE.Group
  tubes: Array<{ g: THREE.BufferGeometry; ranges: Range[] }>
  lines: Array<{ line: LineSegments2; ranges: Range[] }>
}
export interface Chunk {
  key: string
  center: THREE.Vector3
  radius: number
  pieces: Piece[]
  valves: typeof NET.valves
  fittings: typeof NET.fittings
  meters: XY[]
  level: LodLevel
  built: Partial<Record<LodLevel, Built>>
  box: THREE.Box3Helper
}

export const radiusOf = (p: NetPipe, level: LodLevel) => {
  const base = p.dn / 2000
  if (p.kind === 'service') return level === 2 ? 0.24 : 0.3
  return level === 2 ? Math.min(1.6, Math.max(0.3, base * 5)) : Math.min(2.8, Math.max(0.6, base * 7))
}

function splitPipe(p: NetPipe): Piece[] {
  const out: Piece[] = []
  let cur: XY[] = [p.path[0]!]
  let curLen = 0
  let d0 = 0
  let k = 0
  for (let i = 1; i < p.path.length; i++) {
    let a = p.path[i - 1]!
    const b = p.path[i]!
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (curLen + seg > PIECE) {
      const t = (PIECE - curLen) / seg
      const m: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      cur.push(m)
      out.push({ id: `${p.id}#${k++}`, pipe: p, path: cur, d0 })
      d0 += PIECE
      cur = [m]
      curLen = 0
      a = m
      seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    }
    cur.push(b)
    curLen += seg
  }
  if (cur.length > 1) out.push({ id: `${p.id}#${k}`, pipe: p, path: cur, d0 })
  return out
}

export class NetworkLod {
  readonly group = new THREE.Group()
  readonly chunks: Chunk[] = []
  readonly flow = [flowMaterial({ stripe: 0.45 }), flowMaterial({ stripe: 0.6 })] as const
  readonly lineMaterials: LineMaterial[] = []
  readonly valveMat = new THREE.MeshStandardMaterial({ color: 0x1f5fa8, roughness: 0.4, metalness: 0.4 })
  readonly valveClosedMat = new THREE.MeshStandardMaterial({ color: 0xd03b3b, roughness: 0.4, metalness: 0.3 })
  readonly fittingMat = new THREE.MeshStandardMaterial({ color: 0x5b6770, roughness: 0.5, metalness: 0.4 })
  readonly meterMat = new THREE.MeshStandardMaterial({ color: 0x2d7a4f, roughness: 0.6 })
  debug = false
  visible = { mains: true, dist: true, service: true }
  colorOf: (pipeId: string) => THREE.Color = () => new THREE.Color(0x3d8fd1)
  speedOf: (pipeId: string) => number = () => 0
  valveClosed: (code: string) => boolean = () => false
  #paintVersion = 0
  #painted = new WeakMap<Built, number>()
  #valveObjs: Array<{ code: string; mesh: THREE.Mesh }> = []

  constructor() {
    const by = new Map<string, Chunk>()
    const chunkAt = (x: number, y: number): Chunk => {
      const key = `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`
      let c = by.get(key)
      if (!c) {
        c = { key, center: new THREE.Vector3(), radius: 0, pieces: [], valves: [], fittings: [], meters: [], level: 0, built: {}, box: null! }
        by.set(key, c)
      }
      return c
    }
    for (const p of NET.pipes)
      for (const pc of splitPipe(p)) {
        const m = pc.path[Math.floor(pc.path.length / 2)]!
        const a = pc.path[0]!
        chunkAt((a[0] + m[0]) / 2, (a[1] + m[1]) / 2).pieces.push(pc)
      }
    for (const v of NET.valves) chunkAt(...v.at).valves.push(v)
    for (const f of NET.fittings) chunkAt(...f.at).fittings.push(f)
    for (const m of NET.meters) chunkAt(...m).meters.push(m)
    for (const c of by.values()) {
      const box = new THREE.Box3()
      for (const pc of c.pieces) for (const p of pc.path) box.expandByPoint(new THREE.Vector3(p[0], p[1], 0))
      for (const v of c.valves) box.expandByPoint(new THREE.Vector3(v.at[0], v.at[1], 0))
      for (const m of c.meters) box.expandByPoint(new THREE.Vector3(m[0], m[1], 0))
      if (box.isEmpty()) continue
      box.min.z = 0
      box.max.z = 4
      box.getCenter(c.center)
      c.radius = box.getSize(new THREE.Vector3()).length() / 2
      c.box = new THREE.Box3Helper(box, new THREE.Color(LOD_COLORS[0]))
      c.box.visible = false
      this.group.add(c.box)
      c.level = -1 as unknown as LodLevel
      this.chunks.push(c)
    }
  }

  /** mark colours / speeds dirty (network state or colour mode changed) */
  repaint() {
    this.#paintVersion++
  }

  setResolution(w: number, h: number) {
    for (const m of this.lineMaterials) m.resolution.set(w, h)
  }

  update(cam: THREE.Vector3, time: number) {
    for (const f of this.flow) f.uniforms.uTime.value = time
    const stats = { chunks: [0, 0, 0], drawn: 0 }
    for (const c of this.chunks) {
      const d = Math.max(0, cam.distanceTo(c.center) - c.radius)
      const cur = c.level as number
      const h = (lvl: number) => (cur === lvl ? 1.15 : 1)
      const lvl: LodLevel = d < LOD_DIST.l2 * h(2) ? 2 : d < LOD_DIST.l1 * h(1) * (cur === 2 ? 1 : 1) ? 1 : 0
      if (lvl !== cur) {
        for (const [k, b] of Object.entries(c.built)) if (b) b.root.visible = Number(k) === lvl
        c.level = lvl
      }
      const b = (c.built[lvl] ??= this.#build(c, lvl))
      b.root.visible = true
      if (this.#painted.get(b) !== this.#paintVersion) {
        this.#paint(c, b)
        this.#painted.set(b, this.#paintVersion)
      }
      c.box.visible = this.debug
      ;(c.box.material as THREE.LineBasicMaterial).color.setHex(LOD_COLORS[lvl])
      stats.chunks[lvl]!++
    }
    return stats
  }

  #filter(pc: Piece) {
    const k = pc.pipe.kind
    if (k === 'service') return this.visible.service
    if (k === 'dist') return this.visible.dist
    return this.visible.mains
  }

  /** rebuild everything (after a visibility toggle) */
  reset() {
    for (const c of this.chunks) {
      for (const b of Object.values(c.built)) {
        if (!b) continue
        this.group.remove(b.root)
        b.root.traverse(o => {
          const g = (o as THREE.Mesh).geometry
          if (g) g.dispose()
        })
      }
      c.built = {}
      c.level = -1 as unknown as LodLevel
    }
    this.#valveObjs = []
  }

  #build(c: Chunk, lvl: LodLevel): Built {
    const root = new THREE.Group()
    root.name = `chunk ${c.key} L${lvl}`
    const built: Built = { root, tubes: [], lines: [] }
    const pieces = c.pieces.filter(p => this.#filter(p))
    const mains = pieces.filter(p => p.pipe.kind !== 'service' && p.pipe.kind !== 'dist')
    const dist = pieces.filter(p => p.pipe.kind === 'dist')
    const service = pieces.filter(p => p.pipe.kind === 'service')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const addLines = (ps: Piece[], width: number, z: number) => {
      if (!ps.length) return
      const { line, ranges } = buildLines(
        ps.map(p => ({ id: p.id, path: p.path, z })),
        width * dpr,
      )
      line.renderOrder = 1
      this.lineMaterials.push(line.material)
      root.add(line)
      built.lines.push({ line, ranges })
    }
    const addTubes = (ps: Piece[], radial: number, joints: boolean, matIdx: 0 | 1) => {
      if (!ps.length) return
      const input: PipeInput[] = ps.map(p => {
        const r = radiusOf(p.pipe, lvl)
        return { id: p.id, path: p.path, radius: r, z: r + 0.35, d0: p.d0 }
      })
      const { geometry, ranges } = buildTubes(input, radial, joints)
      const mesh = new THREE.Mesh(geometry, this.flow[matIdx].material)
      mesh.castShadow = lvl === 2
      root.add(mesh)
      built.tubes.push({ g: geometry, ranges })
    }
    if (lvl === 0) {
      addLines(mains, 4.2, 0.6)
      addLines(dist, 2.4, 0.5)
    } else if (lvl === 1) {
      addTubes([...mains, ...dist], 6, false, 0)
      addLines(service, 1.3, 0.4)
      this.#valves(c, root, false)
    } else {
      addTubes([...mains, ...dist], 14, true, 1)
      addTubes(service, 6, false, 1)
      this.#valves(c, root, true)
      if (c.fittings.length && this.visible.dist) {
        const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), this.fittingMat, c.fittings.length)
        const m = new THREE.Matrix4()
        c.fittings.forEach((f, i) => {
          m.makeScale(0.42, 0.42, 0.42).setPosition(f.at[0], f.at[1], 0.62)
          im.setMatrixAt(i, m)
        })
        root.add(im)
      }
      if (c.meters.length && this.visible.service) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.7, 0.9), this.meterMat, c.meters.length)
        const m = new THREE.Matrix4()
        c.meters.forEach((p, i) => {
          m.makeTranslation(p[0], p[1], 0.45)
          im.setMatrixAt(i, m)
        })
        im.castShadow = true
        root.add(im)
      }
    }
    this.group.add(root)
    return built
  }

  #valves(c: Chunk, root: THREE.Group, detailed: boolean) {
    if (!c.valves.length || !this.visible.dist) return
    for (const v of c.valves) {
      const g = new THREE.Group()
      const pipe = PIPE_BY_ID[v.pipe]
      const r = pipe ? radiusOf(pipe, detailed ? 2 : 1) : 0.4
      const closed = this.valveClosed(v.code)
      const body = new THREE.Mesh(detailed ? new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 1.4, 18) : new THREE.OctahedronGeometry(r * 2.2), closed ? this.valveClosedMat : this.valveMat)
      body.rotation.x = Math.PI / 2
      body.position.z = r + 0.35
      g.add(body)
      if (detailed) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), this.fittingMat)
        stem.rotation.x = Math.PI / 2
        stem.position.z = r * 2 + 0.9
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 8, 20), closed ? this.valveClosedMat : this.valveMat)
        wheel.position.z = r * 2 + 1.5
        g.add(stem, wheel)
      }
      g.position.set(v.at[0], v.at[1], 0)
      g.userData.valve = v.code
      g.traverse(o => (o.userData.valve = v.code))
      root.add(g)
      this.#valveObjs.push({ code: v.code, mesh: body })
    }
  }

  /** valve open/closed colours, without a rebuild */
  refreshValves() {
    for (const { code, mesh } of this.#valveObjs) mesh.material = this.valveClosed(code) ? this.valveClosedMat : this.valveMat
  }

  #paint(c: Chunk, b: Built) {
    const pipeOf = (pieceId: string) => pieceId.slice(0, pieceId.indexOf('#'))
    const dbg = new THREE.Color(LOD_COLORS[c.level])
    const color = this.debug ? () => dbg : (id: string) => this.colorOf(pipeOf(id))
    for (const t of b.tubes) paintTubes(t.g, t.ranges, color, id => this.speedOf(pipeOf(id)))
    for (const l of b.lines) paintLines(l.line, l.ranges, color)
  }

  /** triangles of the levels currently shown */
  get triangleEstimate() {
    let n = 0
    for (const c of this.chunks) {
      const b = c.built[c.level]
      if (!b) continue
      for (const t of b.tubes) n += (t.g.index?.count ?? 0) / 3
    }
    return n
  }
}
