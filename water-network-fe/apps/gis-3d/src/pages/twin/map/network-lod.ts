/**
 * Level of detail for the pipe network on the map, chosen from the map's zoom: one level for the whole view, so a
 * tilted view draws its near and far parts the same way (a level per chunk by camera distance mixed tubes and lines
 * in one picture). The one exception: at L2, chunks farther than L2_REACH from the camera stay at L1 (also tubes, at
 * the same width there), since a tilted view at zoom 17.5 would otherwise build the whole town at full detail.
 *
 * The network is cut into 300 m chunks (long pipes are split into ≤ 120 m pieces, each piece goes to the chunk of its
 * midpoint). Chunks build a level lazily, only when they are in view and a few per frame; off-screen chunks catch up
 * when they come into view.
 *
 *   L0  far      screen-space lines in four width classes (service, small and large distribution, mains), shaded
 *                like a tube over a dark casing; the components show as MapLibre symbols (far-overlay.ts)
 *   L1  mid      low-poly tubes (6 sides), service pipes included, and the component catalog's flat symbols
 *   L2  near     smooth tubes (14 sides, joints), and every network component as its 3D catalog model
 *                (valves, fittings, saddles, hydrants, sensors, RTUs …), instanced per code
 *
 * Pipe widths are drawn for reading the map, like roads, not to scale (`pipeWidth`):
 *  - a pipe's width grows with the square root of its outside diameter, so a D50 service pipe stays visible and the
 *    mains still lead (D50 : D110 : D315 : D1000 ≈ 1 : 1.5 : 2.5 : 4.5);
 *  - from afar (L0, L1) widths are set in screen pixels and grow with zoom (WIDTH_PX_D50), updated every frame:
 *    L0 lines through their line width, L1 tubes through the tube material's uScale;
 *  - up close (L2) widths are fixed in metres (WIDTH_M_D50), matching L1 at the switch, and the catalog parts on a
 *    pipe are built at its nominal DN and scaled to the pipe's drawn width, so they fit the pipes they join.
 *
 * Pipe ends get a half ball only where they show (`bareEnds`): at a dead end, or on the largest pipe of a junction
 * without a fitting. Ends cut back into a fitting's socket stay open.
 *
 * The flow direction shows as arrows on the pipes (flow-arrows.ts), as on the GIS map: wrapped around the tubes up
 * close, flat on the lines from afar, sized from the drawn width, and moving at a steady screen speed at every level
 * (the distance travelled is integrated here, so a zoom changes the rate, never where the arrows are). They keep clear
 * of the inline parts (valves, meters, saddles) the pipe runs through.
 *
 * Built levels are kept; switching only flips visibility. A hysteresis band of 0.15 zoom stops flicker on a threshold.
 */
import { getCatalogItem, getSymbol, type Status } from '@wn/component-models'
import * as THREE from 'three'
import { cutPath, SEATED, seatFittings } from './fitting-seats'
import { isServiceDevice, NET_DEVICES, SYMBOLISED, type NetDevice } from '../data/network-devices'
import { NET, nominalDn, PIPE_BY_ID, type NetPipe } from '../data/network-model'
import { catalogParts, catalogPorts, instancedDevices, PART_SEGMENTS, symbolInstances, type InstancedDevices } from '../three/catalog-mesh'
import { arcRange, arrowMaterial, buildArrows, type ArrowOptions, type ArrowPath, type FlowArrows } from '../three/flow-arrows'
import { buildLines, buildTubes, paintLines, paintTubes, tubeMaterial, TUBE_GROUND, type PipeInput, type Range } from '../three/pipe-mesh'
import type { XY } from '../data/geo'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'

export type LodLevel = 0 | 1 | 2
export const LOD_NAMES = ['L0 · đường', 'L1 · ống thô', 'L2 · ống chi tiết'] as const
export const LOD_COLORS = [0x6c8ebf, 0xf0a020, 0x2fb36a] as const
const CHUNK = 300
const PIECE = 120
/** map zoom from which the view uses each level */
export const LOD_ZOOM = { l2: 17.5, l1: 15.5 }
export const LOD_HYSTERESIS = 0.15
const BUILDS_PER_FRAME = 8
/** at L2, chunks farther than this from the camera (m, to their nearest edge) show L1: full detail there is sub-pixel */
export const L2_REACH = 1200

/** the level for a map zoom, staying on the current level inside the hysteresis band */
export function zoomLevel(zoom: number, current: number): LodLevel {
  const reach = (threshold: number, level: number) => zoom >= threshold - (current >= level ? LOD_HYSTERESIS : 0)
  return reach(LOD_ZOOM.l2, 2) ? 2 : reach(LOD_ZOOM.l1, 1) ? 1 : 0
}

interface Piece {
  id: string
  pipe: NetPipe
  path: XY[]
  d0: number
  /** the piece holds the part's start / end (a pipe end or a fitting's socket), not a split of a long pipe */
  head: boolean
  tail: boolean
  /** …and that end is closed with a half ball */
  first: boolean
  last: boolean
}
interface Built {
  root: THREE.Group
  tubes: Array<{ g: THREE.BufferGeometry; ranges: Range[] }>
  lines: Array<{ line: LineSegments2; ranges: Range[] }>
  devices?: InstancedDevices
  symbols?: { group: THREE.Group; signature: string }
  arrows: FlowArrows[]
}
export interface Chunk {
  key: string
  center: THREE.Vector3
  radius: number
  pieces: Piece[]
  /** the pieces up close (L2): cut back where they go into fittings */
  near: Piece[]
  devices: NetDevice[]
  level: LodLevel
  built: Partial<Record<LodLevel, Built>>
  box: THREE.Box3Helper
}

/** drawn width relative to a D50 pipe: the square root of the outside diameter (HDPE `dn`), steel ≈ nominal size */
export const sizeFactor = (dn: number) => Math.sqrt(dn / 50)
/** width (m) of a D50 pipe up close (L2) */
export const WIDTH_M_D50 = 1.4
/** screen width (px) of a D50 pipe by map zoom, from afar: thin over the whole town, road-like close in */
export const WIDTH_PX_D50: Array<[number, number]> = [
  [11, 0.8],
  [12, 1.1],
  [13, 1.5],
  [14, 2],
  [15, 2.5],
  [16, 3],
  [17, 3.4],
  [LOD_ZOOM.l2, 3.6],
]
const LAT0 = 21.19
/** base distance between flow arrow stations (m) on L0 and L1; every 2^n-th shows, by zoom */
const ARROW_STEP = [40, 24] as const
/**
 * Screen speed of the arrows (CSS px/s) per unit of `speedOf`, the same at every level. speedOf gives 16 per m/s of
 * water (3 to 28), so arrows move 7 to 63 px/s: three times the GIS map's 12 px/s per m/s, which looked idle here.
 */
export const FLOW_PX_PER_S = 36 / 16
/** a pipe end ramps to its fitting's axis height over this many metres per metre of height */
const RAMP_PER_M = 4
/** smallest arrow radius (CSS px) per level: legible on thin lines and far tubes */
const ARROW_MIN_PX = [4, 3.5, 3] as const
/** metres per screen pixel at a map zoom (MapLibre's 512 px tiles) */
export const metresPerPx = (zoom: number) => (40_075_016.686 * Math.cos((LAT0 * Math.PI) / 180)) / (512 * 2 ** zoom)
export function widthPxD50(zoom: number): number {
  const t = WIDTH_PX_D50
  if (zoom <= t[0]![0]) return t[0]![1]
  for (let i = 1; i < t.length; i++) if (zoom <= t[i]![0]) return t[i - 1]![1] + ((t[i]![1] - t[i - 1]![1]) * (zoom - t[i - 1]![0])) / (t[i]![0] - t[i - 1]![0])
  return t[t.length - 1]![1]
}
/** a pipe's drawn width in metres up close, or in screen pixels at a far zoom */
export const pipeWidth = (dn: number, zoom?: number) => (zoom === undefined ? WIDTH_M_D50 : widthPxD50(zoom)) * sizeFactor(dn)
/** how much the L1 tubes (built at the L2 width) are thickened at a zoom, so they keep their pixel width */
export const midScale = (zoom: number) => Math.max(1, (widthPxD50(zoom) * metresPerPx(zoom)) / WIDTH_M_D50)
/** drawn radius of a tube (m), as built; L1 tubes are thickened further by `midScale` in the shader */
export const radiusOf = (p: NetPipe) => pipeWidth(p.dn) / 2
/** the L0 line classes and the size each draws at */
const LINE_CLASS = [
  { id: 'service', dn: 50, z: 0.4, of: (p: NetPipe) => p.kind === 'service' },
  { id: 'small', dn: 100, z: 0.5, of: (p: NetPipe) => (p.kind === 'dist' || p.kind === 'trunk') && p.dn <= 110 },
  { id: 'large', dn: 225, z: 0.55, of: (p: NetPipe) => (p.kind === 'dist' || p.kind === 'trunk') && p.dn > 110 },
  { id: 'mains', dn: 800, z: 0.6, of: (p: NetPipe) => p.kind === 'transmission' || p.kind === 'raw' },
] as const

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** distance from a point to a polyline */
function toPath(q: XY, path: XY[]) {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0
    best = Math.min(best, Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]))
  }
  return best
}

/**
 * Which pipe ends get a half ball ([start, end] per pipe id). Only ends that show: a dead end (no other pipe within
 * `tol`), or at a junction without a fitting the largest pipe's end alone (one of equal ones), whose ball covers the
 * smaller open ends. A pipe running on through the node, at least as wide, hides the end itself. Several balls of
 * different sizes on one node read as a knot.
 */
export function bareEnds(pipes: NetPipe[], radius: (p: NetPipe) => number, tol = 1): Map<string, [boolean, boolean]> {
  const CELL = 50
  const grid = new Map<string, NetPipe[]>()
  for (const p of pipes) {
    const keys = new Set<string>()
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1]!
      const b = p.path[i]!
      // every cell a segment's box touches: a long segment passes cells without a vertex in them
      for (let x = Math.floor((Math.min(a[0], b[0]) - tol) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + tol) / CELL); x++)
        for (let y = Math.floor((Math.min(a[1], b[1]) - tol) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + tol) / CELL); y++) keys.add(`${x}:${y}`)
    }
    for (const k of keys) (grid.get(k) ?? grid.set(k, []).get(k)!).push(p)
  }
  const capped = (p: NetPipe, e: XY) => {
    const rp = radius(p)
    for (const q of grid.get(`${Math.floor(e[0] / CELL)}:${Math.floor(e[1] / CELL)}`) ?? []) {
      if (q === p || toPath(e, q.path) > tol) continue
      const rq = radius(q)
      const atEnd = Math.min(dist(e, q.path[0]!), dist(e, q.path[q.path.length - 1]!)) <= tol
      if (rq > rp + 1e-6 || (!atEnd && rq >= rp - 1e-6) || (atEnd && Math.abs(rq - rp) <= 1e-6 && q.id < p.id)) return false
    }
    return true
  }
  const out = new Map<string, [boolean, boolean]>()
  for (const p of pipes) out.set(p.id, [capped(p, p.path[0]!), capped(p, p.path[p.path.length - 1]!)])
  return out
}

/**
 * A pipe (or one part of it, between fittings) cut into ≤ PIECE m pieces. `capStart` / `capEnd` say whether the
 * part's ends are closed with a half ball; `k0` numbers the pieces on from earlier parts.
 */
function splitPipe(p: NetPipe, path: XY[] = p.path, opts: { d0?: number; capStart?: boolean; capEnd?: boolean; k0?: number } = {}): Piece[] {
  const out: Piece[] = []
  let cur: XY[] = [path[0]!]
  let curLen = 0
  const start = opts.d0 ?? 0
  let d0 = start
  let k = opts.k0 ?? 0
  const piece = (path: XY[]): Piece => {
    const head = d0 === start
    return { id: `${p.id}#${k}`, pipe: p, path, d0, head, tail: false, first: head && (opts.capStart ?? true), last: false }
  }
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1]!
    const b = path[i]!
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (curLen + seg > PIECE) {
      const t = (PIECE - curLen) / seg
      const m: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      cur.push(m)
      out.push(piece(cur))
      k++
      d0 += PIECE
      cur = [m]
      curLen = 0
      a = m
      seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    }
    cur.push(b)
    curLen += seg
  }
  if (cur.length > 1) out.push(piece(cur))
  const end = out[out.length - 1]
  if (end) {
    end.tail = true
    end.last = opts.capEnd ?? true
  }
  return out
}

/**
 * Size (m, as built) of a part's flat symbol at L1: never narrower than about twice its pipe's drawn width, so a valve
 * on the D1000 reads as big as the main it sits on; the L1 shader scale then grows it with the tubes.
 */
function symbolSize(d: NetDevice) {
  const base = d.code === 'CustomerMeter' || d.code === 'AcousticLogger' ? 9 : getCatalogItem(d.code)?.role === 'inline' ? 14 : 12
  const pipe = d.onPipe && d.pipe ? PIPE_BY_ID[d.pipe] : undefined
  return pipe ? Math.max(base, 2.2 * pipeWidth(pipe.dn)) : base
}

/** the scale a catalog part is drawn at: its pipe's drawn width over the real outside diameter */
const partScale = (d: NetDevice) => {
  const pipe = d.pipe ? PIPE_BY_ID[d.pipe] : undefined
  return d.onPipe && pipe ? (2 * radiusOf(pipe)) / (pipe.dn / 1000) : d.code === 'CustomerMeter' ? 6 : 3.4
}
const halfCache = new Map<string, number>()
/** half the length of a catalog part along its run (+X), at unit scale: what it covers of the pipe it sits on */
function halfLength(d: NetDevice) {
  const key = `${d.code}|${d.dn}|${d.dn2 ?? ''}|${d.angle ?? ''}`
  let h = halfCache.get(key)
  if (h === undefined) {
    const box = new THREE.Box3()
    for (const part of catalogParts(d.code, d.dn, d.dn2, PART_SEGMENTS, d.angle)) {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox()
      box.union(part.geometry.boundingBox!)
    }
    h = box.isEmpty() ? d.dn / 1000 : Math.max(-box.min.x, box.max.x)
    halfCache.set(key, h)
  }
  return h
}

/**
 * A path with its ends raised by `dz` = [start, end] (m of axis height): held for `hold` m from the end (the length
 * inside the fitting, up to its socket), then ramped down over `run` m. The vertices where a hold or ramp ends are
 * added, and `zs` is the axis height at every vertex.
 */
export function rampPath(path: XY[], z: number, dz: [number, number], hold: [number, number], run: [number, number]): { path: XY[]; zs: number[] } {
  const out: XY[] = [path[0]!]
  const at: number[] = [0]
  let total = 0
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1]!, path[i]!)
  const marks = [hold[0], hold[0] + run[0], total - hold[1], total - hold[1] - run[1]].filter(m => m > 1e-3 && m < total - 1e-3).sort((a, b) => a - b)
  let d = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const l = dist(a, b)
    for (const m of marks)
      if (m > d + 1e-3 && m < d + l - 1e-3) {
        out.push([a[0] + ((b[0] - a[0]) * (m - d)) / l, a[1] + ((b[1] - a[1]) * (m - d)) / l])
        at.push(m)
      }
    d += l
    out.push(b)
    at.push(d)
  }
  /** share of the rise left at u m from the end */
  const rise = (u: number, h: number, r: number) => (u <= h ? 1 : r > 0 ? Math.max(0, 1 - (u - h) / r) : 0)
  const zs = at.map(s => z + dz[0] * rise(s, hold[0], run[0]) + dz[1] * rise(total - s, hold[1], run[1]))
  return { path: out, zs }
}

/** where a pipe bridges over another it is not joined to: at `s` m along it, raised by `lift` over ±`half` m */
export interface Crossing {
  s: number
  lift: number
  half: number
  run: number
}

/**
 * Every place two pipes cross without being joined (no shared node there): the thinner one (as drawn) bridges over the
 * thicker one, so tubes do not run through each other. Its axis rises by the lower pipe's drawn diameter plus a gap,
 * held over the lower pipe (wider at a shallow angle) and ramped back over a few metres on each side.
 */
export function findCrossings(pipes: NetPipe[], radius: (p: NetPipe) => number): Map<string, Crossing[]> {
  const out = new Map<string, Crossing[]>()
  const CELL = 100
  type Seg = { p: NetPipe; i: number; a: XY; b: XY; s0: number }
  const grid = new Map<string, Seg[]>()
  const ends = new Map<string, [XY, XY]>()
  for (const p of pipes) {
    ends.set(p.id, [p.path[0]!, p.path[p.path.length - 1]!])
    let s0 = 0
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1]!
      const b = p.path[i]!
      const seg: Seg = { p, i, a, b, s0 }
      const keys = new Set<string>()
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) keys.add(`${x}:${y}`)
      for (const k of keys) (grid.get(k) ?? grid.set(k, []).get(k)!).push(seg)
      s0 += dist(a, b)
    }
  }
  const seen = new Set<string>()
  const nearEnd = (p: NetPipe, x: XY) => ends.get(p.id)!.some(e => dist(e, x) < 2)
  for (const cell of grid.values())
    for (let m = 0; m < cell.length; m++)
      for (let n = m + 1; n < cell.length; n++) {
        const A = cell[m]!
        const B = cell[n]!
        if (A.p === B.p) continue
        const key = A.p.id < B.p.id ? `${A.p.id}|${A.i}|${B.p.id}|${B.i}` : `${B.p.id}|${B.i}|${A.p.id}|${A.i}`
        if (seen.has(key)) continue
        seen.add(key)
        const r = [A.b[0] - A.a[0], A.b[1] - A.a[1]]
        const q = [B.b[0] - B.a[0], B.b[1] - B.a[1]]
        const den = r[0]! * q[1]! - r[1]! * q[0]!
        if (Math.abs(den) < 1e-9) continue
        const t = ((B.a[0] - A.a[0]) * q[1]! - (B.a[1] - A.a[1]) * q[0]!) / den
        const u = ((B.a[0] - A.a[0]) * r[1]! - (B.a[1] - A.a[1]) * r[0]!) / den
        if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue
        const x: XY = [A.a[0] + r[0]! * t, A.a[1] + r[1]! * t]
        // joined there (a pipe ends on the other): not a crossing
        if (nearEnd(A.p, x) || nearEnd(B.p, x)) continue
        const ra = radius(A.p)
        const rb = radius(B.p)
        // the thinner pipe goes over: [its segment, where along it, the radius under it, its own radius]
        const [over, so, ru, ro] = ra < rb || (ra === rb && A.p.id > B.p.id) ? [A, A.s0 + dist(A.a, A.b) * t, rb, ra] : [B, B.s0 + dist(B.a, B.b) * u, ra, rb]
        const sin = Math.abs(den) / (Math.hypot(r[0]!, r[1]!) * Math.hypot(q[0]!, q[1]!))
        const lift = 2 * ru + 0.25
        const c: Crossing = { s: so, lift, half: ru / Math.max(0.3, sin) + ro + 0.4, run: Math.max(4, lift * 3) }
        ;(out.get(over.p.id) ?? out.set(over.p.id, []).get(over.p.id)!).push(c)
      }
  return out
}

/**
 * A piece's path raised where it bridges over other pipes: vertices are added where each rise starts and ends, and the
 * rise is added to `zs` (the axis heights from rampPath, or `z` everywhere). `d0` is the piece's start along its pipe.
 */
export function bridgePath(path: XY[], zs: number[] | undefined, z: number, d0: number, crossings: Crossing[]): { path: XY[]; zs: number[] } {
  const at: number[] = [0]
  for (let i = 1; i < path.length; i++) at.push(at[i - 1]! + dist(path[i - 1]!, path[i]!))
  const total = at[at.length - 1]!
  const marks = crossings
    .flatMap(c => [c.s - c.half - c.run, c.s - c.half, c.s + c.half, c.s + c.half + c.run].map(m => m - d0))
    .filter(m => m > 1e-3 && m < total - 1e-3)
  const pts = path.map((pt, i) => ({ pt, s: at[i]!, z: zs?.[i] ?? z }))
  for (const m of marks) {
    const i = pts.findIndex(q => q.s > m)
    if (i <= 0 || Math.abs(pts[i]!.s - m) < 1e-3 || Math.abs(pts[i - 1]!.s - m) < 1e-3) continue
    const a = pts[i - 1]!
    const b = pts[i]!
    const f = (m - a.s) / (b.s - a.s)
    pts.splice(i, 0, { pt: [a.pt[0] + (b.pt[0] - a.pt[0]) * f, a.pt[1] + (b.pt[1] - a.pt[1]) * f], s: m, z: a.z + (b.z - a.z) * f })
  }
  const rise = (s: number) => {
    let h = 0
    for (const c of crossings) {
      const u = Math.abs(s + d0 - c.s)
      const k = u <= c.half ? 1 : u >= c.half + c.run ? 0 : 1 - (u - c.half) / c.run
      // a smooth step, not a kink, where the bridge meets the ramps
      h = Math.max(h, c.lift * k * k * (3 - 2 * k))
    }
    return h
  }
  return { path: pts.map(q => q.pt), zs: pts.map(q => q.z + rise(q.s)) }
}

/** free a symbol group: its plane, materials and instance buffers (the textures are the catalog's cache) */
function disposeSymbols(g: THREE.Group) {
  g.removeFromParent()
  g.traverse(o => {
    const m = o as THREE.InstancedMesh
    if (!m.isInstancedMesh) return
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose()
    m.dispose()
  })
}

export class NetworkLod {
  readonly group = new THREE.Group()
  readonly chunks: Chunk[] = []
  /** tube materials of L1 (thickened with the zoom) and L2 */
  readonly tubes = [tubeMaterial(), tubeMaterial()] as const
  /** flow arrow materials of L0 (flat on the lines), L1 and L2 (on the tubes); the rim is drawn in the same pass */
  readonly arrows = [arrowMaterial({ flat: true }), arrowMaterial(), arrowMaterial()] as const
  /** L0 line materials and the size class each draws, re-sized with the zoom */
  readonly lineMaterials: Array<{ m: LineMaterial; dn: number }> = []
  debug = false
  visible = { mains: true, dist: true, service: true }
  colorOf: (pipeId: string) => THREE.Color = () => new THREE.Color(0x3d8fd1)
  speedOf: (pipeId: string) => number = () => 0
  /** live state of a network component (catalog status colours) */
  deviceStatus: (id: string) => Status = () => 'normal'
  /** body tint of a component (closed valves), null = catalog colours */
  deviceTint: (id: string) => THREE.Color | null = () => null
  #paintVersion = 0
  #painted = new WeakMap<Built, number>()
  /** where each fitting sits up close, seated on its pipes' axes */
  readonly seat: Map<string, XY>
  /** parts a pipe runs through (valves, meters, saddles, unseated fittings), by pipe: no arrows over their bodies */
  #inline = new Map<string, NetDevice[]>()
  /**
   * Near pieces whose end goes into a fitting at another axis height (a fitting sits at its own pipe's height, so a
   * reducing tee's branch socket is above a thinner branch pipe): the end ramps to the fitting's height over `run` m.
   */
  #ramp = new Map<Piece, { dz: [number, number]; hold: [number, number]; run: [number, number] }>()
  /** L1 symbols grow with the L1 tubes (same factor, every frame) */
  #symbolScale = { value: 1 }
  /** where each pipe bridges over pipes it crosses without a joint */
  #cross: Map<string, Crossing[]>
  /** materials shared by every chunk: never disposed with one */
  #shared: Set<THREE.Material>
  /** frame state the builds need: new L0 lines get their width at once (#19) */
  #zoom = LOD_ZOOM.l1
  #pxRatio = 1
  #res = new THREE.Vector2(1, 1)
  /** distance (m) a speed-1 arrow has travelled; one for all levels, so a level switch keeps the arrows in place */
  #flow = 0
  #time: number | null = null

  constructor() {
    this.#shared = new Set<THREE.Material>([...this.tubes.map(t => t.material), ...this.arrows.map(a => a.material)])
    const by = new Map<string, Chunk>()
    const chunkAt = (x: number, y: number): Chunk => {
      const key = `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`
      let c = by.get(key)
      if (!c) {
        c = { key, center: new THREE.Vector3(), radius: 0, pieces: [], near: [], devices: [], level: 0, built: {}, box: null! }
        by.set(key, c)
      }
      return c
    }
    const place = (pc: Piece, list: 'pieces' | 'near') => {
      const m = pc.path[Math.floor(pc.path.length / 2)]!
      const a = pc.path[0]!
      chunkAt((a[0] + m[0]) / 2, (a[1] + m[1]) / 2)[list].push(pc)
    }
    this.#cross = findCrossings(NET.pipes, radiusOf)
    const caps = bareEnds(NET.pipes, radiusOf)
    for (const p of NET.pipes) {
      const [capStart, capEnd] = caps.get(p.id)!
      for (const pc of splitPipe(p, p.path, { capStart, capEnd })) place(pc, 'pieces')
    }
    // up close the fittings are drawn: seat them on the pipe axes and cut the pipes back to their ports
    const { seat, cuts } = seatFittings(NET_DEVICES, NET.pipes, partScale, radiusOf)
    this.seat = seat
    const near: Piece[] = []
    for (const p of NET.pipes) {
      const [capStart, capEnd] = caps.get(p.id)!
      const parts = cutPath(p.path, cuts.get(p.id))
      // a pipe's own end that was not cut into a fitting: capped only where it shows
      parts[0]!.capStart &&= capStart
      parts[parts.length - 1]!.capEnd &&= capEnd
      let k = 0
      for (const part of parts) {
        const pcs = splitPipe(p, part.path, { d0: part.d0, capStart: part.capStart, capEnd: part.capEnd, k0: k })
        k += pcs.length
        for (const pc of pcs) place(pc, 'near')
        near.push(...pcs)
      }
    }
    // the height a piece end must meet: the nearest fitting at a node within reach of it (its sockets' distance)
    const FC = 10
    const fitGrid = new Map<string, Array<{ at: XY; reach: number; z: number }>>()
    for (const d of NET_DEVICES) {
      const pipe = d.pipe ? PIPE_BY_ID[d.pipe] : undefined
      if (!d.onPipe || !pipe || !SEATED.has(d.code)) continue
      const at = seat.get(d.id) ?? d.at
      const key = `${Math.floor(at[0] / FC)}:${Math.floor(at[1] / FC)}`
      ;(fitGrid.get(key) ?? fitGrid.set(key, []).get(key)!).push({ at, reach: Math.max(0, ...catalogPorts(d.code, d.dn, d.dn2, d.angle).map(q => Math.hypot(q.pos.x, q.pos.y))) * partScale(d), z: radiusOf(pipe) + TUBE_GROUND })
    }
    /** [height to add, length inside the fitting] at a piece end */
    const fitAt = (e: XY, own: number): [number, number] => {
      let best = Infinity
      let out: [number, number] = [0, 0]
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const f of fitGrid.get(`${Math.floor(e[0] / FC) + i}:${Math.floor(e[1] / FC) + j}`) ?? []) {
            const dd = dist(e, f.at)
            if (dd <= f.reach + 0.3 && dd < best) {
              best = dd
              // an end that runs on to the node (not cut at a socket) stays raised up to the sockets; one cut at its
              // socket ramps from there
              out = Math.abs(f.z - own) > 0.01 ? [f.z - own, dd < 0.5 ? f.reach : 0] : [0, 0]
            }
          }
      return out
    }
    for (const pc of near) {
      const own = radiusOf(pc.pipe) + TUBE_GROUND
      const [s0, h0] = pc.head ? fitAt(pc.path[0]!, own) : [0, 0]
      const [s1, h1] = pc.tail ? fitAt(pc.path[pc.path.length - 1]!, own) : [0, 0]
      if (!s0 && !s1) continue
      let len = 0
      for (let i = 1; i < pc.path.length; i++) len += dist(pc.path[i - 1]!, pc.path[i]!)
      // both ends ramping share the piece
      const room = s0 && s1 ? len / 2 : len
      const fit = (h: number, dz: number): [number, number] => [Math.min(h, room), Math.max(0, Math.min(Math.abs(dz) * RAMP_PER_M, room - h))]
      const [hold0, run0] = s0 ? fit(h0, s0) : [0, 0]
      const [hold1, run1] = s1 ? fit(h1, s1) : [0, 0]
      this.#ramp.set(pc, { dz: [s0, s1], hold: [hold0, hold1], run: [run0, run1] })
    }
    for (const d of NET_DEVICES) {
      chunkAt(...d.at).devices.push(d)
      if (d.onPipe && d.pipe && !seat.has(d.id)) (this.#inline.get(d.pipe) ?? this.#inline.set(d.pipe, []).get(d.pipe)!).push(d)
    }
    for (const c of by.values()) {
      const box = new THREE.Box3()
      for (const pc of [...c.pieces, ...c.near]) for (const p of pc.path) box.expandByPoint(new THREE.Vector3(p[0], p[1], 0))
      for (const d of c.devices) box.expandByPoint(new THREE.Vector3(d.at[0], d.at[1], 0))
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

  /** mark colours / speeds / component states dirty (network state or colour mode changed) */
  repaint() {
    this.#paintVersion++
  }

  /** drawing buffer size (device px), every frame */
  setResolution(w: number, h: number) {
    this.#res.set(w, h)
    for (const l of this.lineMaterials) l.m.resolution.set(w, h)
  }

  /** the level the view uses (from the zoom) */
  level: LodLevel = 0
  #sphere = new THREE.Sphere()

  /**
   * Pick the view's level from the map zoom and bring the chunks in view to it. `time` is in seconds, `pixelRatio` the
   * map canvas's device px per CSS px, `camGround` the camera position in the layer frame (x, y ground, z height).
   */
  update(time: number, zoom: number, frustum?: THREE.Frustum, pixelRatio = 1, camGround?: THREE.Vector3) {
    this.level = zoomLevel(zoom, this.level)
    this.#zoom = zoom
    this.#pxRatio = pixelRatio
    // widths that follow the zoom: L0 lines in pixels, L1 tubes thickened about their axis
    for (const l of this.lineMaterials) l.m.linewidth = pipeWidth(l.dn, zoom) * pixelRatio
    this.tubes[0].uniforms.uScale.value = midScale(zoom)
    this.#symbolScale.value = midScale(zoom)
    // flow arrows: the distance travelled at a steady screen speed, integrated (a long stall or hidden tab is clamped)
    const mpp = metresPerPx(zoom)
    const dt = this.#time === null ? 0 : Math.min(0.25, Math.max(0, time - this.#time))
    this.#time = time
    this.#flow += dt * FLOW_PX_PER_S * mpp
    const every = (basePx: number, baseM: number) => 2 ** Math.max(0, Math.round(Math.log2((basePx * mpp) / baseM)))
    const set = (lvl: LodLevel, uScale: number, uEvery: number) => {
      const u = this.arrows[lvl].uniforms
      u.uDist.value = this.#flow
      u.uScale.value = uScale
      u.uEvery.value = uEvery
      u.uMinPx.value = ARROW_MIN_PX[lvl]
      u.uRes.value.copy(this.#res)
      u.uPxRatio.value = pixelRatio
      if (camGround) u.uCam.value.set(camGround.x, camGround.y, camGround.z, 1)
      else u.uCam.value.set(0, 0, 0, 0)
    }
    set(0, widthPxD50(zoom) / WIDTH_M_D50, every(150, ARROW_STEP[0]))
    set(1, midScale(zoom), every(130, ARROW_STEP[1]))
    set(2, 1, 1)
    /** `pending`: chunks in view still waiting for their level; the caller must draw another frame for them */
    const stats = { chunks: [0, 0, 0], devices: 0, pending: 0 }
    let builds = 0
    for (const c of this.chunks) {
      const seen = !frustum || frustum.intersectsSphere(this.#sphere.set(c.center, c.radius))
      // the view's level, but L1 for chunks far out in a tilted near view
      const want: LodLevel =
        this.level === 2 && camGround && Math.hypot(c.center.x - camGround.x, c.center.y - camGround.y, camGround.z) - c.radius > L2_REACH ? 1 : this.level
      let lvl: number = want
      if (!c.built[want]) {
        if (seen && builds < BUILDS_PER_FRAME) {
          c.built[want] = this.#build(c, want)
          builds++
        } else {
          lvl = c.level // keep what it shows until it is in view (or its turn to build comes)
          if (seen) stats.pending++
        }
      }
      const b = lvl >= 0 ? c.built[lvl as LodLevel] : undefined
      if (lvl !== c.level || !b) {
        for (const [k, o] of Object.entries(c.built)) if (o) o.root.visible = Number(k) === lvl
        c.level = (b ? lvl : -1) as LodLevel
      }
      if (!b) continue
      b.root.visible = true
      if (seen && this.#painted.get(b) !== this.#paintVersion) {
        this.#paint(c, b)
        this.#painted.set(b, this.#paintVersion)
      }
      c.box.visible = this.debug
      ;(c.box.material as THREE.LineBasicMaterial).color.setHex(LOD_COLORS[c.level])
      stats.chunks[c.level]!++
      if (c.level === 2) stats.devices += c.devices.length
    }
    return stats
  }

  #filter(pc: Piece) {
    const k = pc.pipe.kind
    if (k === 'service') return this.visible.service
    if (k === 'dist') return this.visible.dist
    return this.visible.mains
  }
  #showDevice(d: NetDevice) {
    if (isServiceDevice(d)) return this.visible.service
    const p = d.pipe ? PIPE_BY_ID[d.pipe] : undefined
    return p && (p.kind === 'transmission' || p.kind === 'raw' || p.kind === 'trunk') && d.onPipe ? this.visible.mains : this.visible.dist
  }

  /** rebuild everything (after a visibility toggle) */
  reset() {
    for (const c of this.chunks) {
      for (const b of Object.values(c.built)) if (b) this.#dispose(b)
      c.built = {}
      c.level = -1 as unknown as LodLevel
    }
    // their materials went with the lines (fill and casing)
    this.lineMaterials.length = 0
  }

  /** free a built level: its own geometries, materials and instance buffers, not the shared ones */
  #dispose(b: Built) {
    this.group.remove(b.root)
    if (b.symbols) disposeSymbols(b.symbols.group)
    b.root.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const g = mesh.geometry as THREE.BufferGeometry
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose() // catalog geometry is cached
      else if (g.getAttribute('iA')) {
        // arrows: the quad's index and attributes are shared by every chunk; free only the instance buffers
        g.setIndex(null)
        g.deleteAttribute('position')
        g.deleteAttribute('pad')
        g.dispose()
      } else g.dispose() // tubes; a line and its casing share theirs (disposing twice is harmless)
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!this.#shared.has(m)) m.dispose()
    })
  }

  #build(c: Chunk, lvl: LodLevel): Built {
    const root = new THREE.Group()
    root.name = `chunk ${c.key} L${lvl}`
    const built: Built = { root, tubes: [], lines: [], arrows: [] }
    const pieces = (lvl === 2 ? c.near : c.pieces).filter(p => this.#filter(p))
    const pipes = pieces.filter(p => p.pipe.kind !== 'service')
    const service = pieces.filter(p => p.pipe.kind === 'service')
    const addLines = (ps: Piece[], dn: number, z: number) => {
      if (!ps.length) return
      const { line, ranges } = buildLines(
        ps.map(p => ({ id: p.id, path: p.path, z })),
        pipeWidth(dn, this.#zoom) * this.#pxRatio,
      )
      line.material.resolution.copy(this.#res)
      this.lineMaterials.push({ m: line.material, dn })
      root.add(line) // its casing is a child
      built.lines.push({ line, ranges })
    }
    const addTubes = (ps: Piece[], radial: number, joints: boolean, matIdx: 0 | 1) => {
      if (!ps.length) return
      const input: PipeInput[] = ps.map(p => {
        const r = radiusOf(p.pipe)
        const ramp = this.#ramp.get(p)
        const rp = ramp ? rampPath(p.path, r + TUBE_GROUND, ramp.dz, ramp.hold, ramp.run) : null
        const cross = this.#cross.get(p.pipe.id)
        const bp = cross ? bridgePath(rp?.path ?? p.path, rp?.zs, r + TUBE_GROUND, p.d0, cross) : null
        return { id: p.id, path: bp?.path ?? rp?.path ?? p.path, zs: bp?.zs ?? rp?.zs, radius: r, z: r + TUBE_GROUND, capStart: p.first, capEnd: p.last }
      })
      const { geometry, ranges } = buildTubes(input, radial, joints)
      const mesh = new THREE.Mesh(geometry, this.tubes[matIdx].material)
      mesh.castShadow = lvl === 2
      root.add(mesh)
      built.tubes.push({ g: geometry, ranges })
    }
    /** flow arrows on pieces: a train per pipe (key = pipe, d0 along it), ends where the part really ends */
    const addArrows = (ps: Piece[], r: (p: Piece) => number, o: ArrowOptions, blocked?: (p: Piece, r: number) => Array<[number, number]>) => {
      const paths: ArrowPath[] = ps.map(p => {
        const rr = r(p)
        return { id: p.id, path: p.path, r: rr, d0: p.d0, ends: [p.head, p.tail], blocked: blocked?.(p, rr) }
      })
      const a = paths.length ? buildArrows(paths, this.arrows[lvl].material, o) : null
      if (!a) return
      built.arrows.push(a)
      root.add(...a.meshes)
    }
    const devices = c.devices.filter(d => this.#showDevice(d))
    if (lvl === 0) {
      for (const k of LINE_CLASS) {
        const ps = pieces.filter(p => k.of(p.pipe))
        addLines(ps, k.dn, k.z)
        // flat on the line, sized from the class's drawn width; one train per pipe, not cut at every CAD jog
        addArrows(ps, () => pipeWidth(k.dn) / 2, { spacing: () => ARROW_STEP[0], sides: [0], flat: 0.9, simplify: 3, clear: () => 0 })
      }
    } else if (lvl === 1) {
      addTubes(pipes, 6, false, 0)
      addTubes(service, 6, false, 0)
      addArrows(pieces, p => radiusOf(p.pipe), { spacing: () => ARROW_STEP[1], sides: [0], simplify: 1 }, p => this.#bridges(p))
    } else {
      addTubes(pipes, 14, true, 1)
      addTubes(service, 8, false, 1)
      // no arrows over the parts a pipe runs through (their bodies would carry white shards)
      // nor on a ramp into a fitting (the arrows ride the pipe's own height)
      const blocked = (p: Piece, r: number) => {
        const out = (this.#inline.get(p.pipe.id) ?? [])
          .filter(d => this.#showDevice(d))
          .flatMap(d => {
            const range = arcRange(p.path, d.at, halfLength(d) * partScale(d), p.d0, r * 2)
            return range ? [range] : []
          })
        out.push(...this.#bridges(p))
        const ramp = this.#ramp.get(p)
        if (ramp) {
          let len = 0
          for (let i = 1; i < p.path.length; i++) len += dist(p.path[i - 1]!, p.path[i]!)
          if (ramp.dz[0]) out.push([p.d0, p.d0 + ramp.hold[0] + ramp.run[0]])
          if (ramp.dz[1]) out.push([p.d0 + len - ramp.hold[1] - ramp.run[1], p.d0 + len])
        }
        return out
      }
      const spacing = (r: number) => 2 ** Math.round(Math.log2(Math.max(r * 12, 6)))
      // three arrows round a distribution pipe or main, one on top of a service pipe (thin, and most of the length)
      addArrows(pipes, p => radiusOf(p.pipe), { spacing, sides: [0, Math.PI / 3, -Math.PI / 3] }, blocked)
      addArrows(service, p => radiusOf(p.pipe), { spacing, sides: [0] }, blocked)
      if (devices.length) {
        // catalog models at map scale: a part on a pipe is built at its DN and scaled to the pipe's drawn width
        built.devices = instancedDevices(
          devices.flatMap(d => {
            const pipe = d.pipe ? PIPE_BY_ID[d.pipe] : undefined
            const onPipe = !!(d.onPipe && pipe)
            const r = pipe ? radiusOf(pipe) : 0.3
            const at = this.seat.get(d.id) ?? d.at
            const k = partScale(d)
            // parts standing on a pipe (air valves, washouts) are mounted as on a real main: a tapping saddle clamps the
            // pipe and its branch rises to the part's flange, so the part is joined to the pipe, not set on top of it
            if (onPipe && getCatalogItem(d.code)?.role === 'nodeDevice') {
              const main = nominalDn(pipe!.dn, pipe!.mat)
              const c = catalogPorts('TappingSaddle', main, d.dn).find(p => p.id === 'C')
              const rise = c ? c.pos.z * k : r
              return [
                { id: `${d.id}#saddle`, code: 'TappingSaddle', dn: main, dn2: d.dn, at, heading: d.heading, z: r + TUBE_GROUND, scale: k },
                { id: d.id, code: d.code, dn: d.dn, dn2: d.dn2, angle: d.angle, at, heading: d.heading, z: r + TUBE_GROUND + rise, scale: k },
              ]
            }
            return [{ id: d.id, code: d.code, dn: d.dn, dn2: d.dn2, angle: d.angle, at, heading: d.heading, z: onPipe ? r + TUBE_GROUND : 0.05, scale: k }]
          }),
        )
        root.add(built.devices.group)
      }
    }
    this.group.add(root)
    return built
  }

  /** no arrows where a pipe bridges over another (they ride the pipe's ground height) */
  #bridges(p: Piece): Array<[number, number]> {
    return (this.#cross.get(p.pipe.id) ?? []).map(c => [c.s - c.half - c.run, c.s + c.half + c.run] as [number, number])
  }

  #paint(c: Chunk, b: Built) {
    const pipeOf = (pieceId: string) => pieceId.slice(0, pieceId.indexOf('#'))
    const dbg = new THREE.Color(LOD_COLORS[c.level])
    const color = this.debug ? () => dbg : (id: string) => this.colorOf(pipeOf(id))
    for (const t of b.tubes) paintTubes(t.g, t.ranges, color)
    for (const a of b.arrows) a.paint(id => this.speedOf(pipeOf(id)))
    for (const l of b.lines) paintLines(l.line, l.ranges, color)
    // a mounting saddle (`id#saddle`) takes its part's tint and state
    b.devices?.paint(
      id => this.deviceTint(id.split('#')[0]!),
      id => this.deviceStatus(id.split('#')[0]!),
    )
    if (c.level === 1) {
      // flat catalog symbols: the state is baked into the texture, so rebuild when any state changed
      const list = c.devices.filter(d => SYMBOLISED.has(d.code) && this.#showDevice(d))
      const states = list.map(d => this.deviceStatus(d.id))
      const signature = states.join(',')
      if (b.symbols?.signature !== signature) {
        if (b.symbols) disposeSymbols(b.symbols.group)
        const group = symbolInstances(
          list.map((d, i) => ({
            id: d.id,
            code: d.code,
            at: d.at,
            heading: d.heading,
            status: states[i]!,
            size: symbolSize(d),
            align: getSymbol(d.code).align === 'pipe',
          })),
          2.4,
          this.#symbolScale,
        )
        // the L1 tubes are thickened in the shader (a D110's crown reaches ~5 m at zoom 16): the symbols are drawn over
        // them and over the arrows, not depth-tested into them
        group.traverse(o => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          ;(m.material as THREE.Material).depthTest = false
          m.renderOrder = 7
        })
        b.root.add(group)
        b.symbols = { group, signature }
      }
    }
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
