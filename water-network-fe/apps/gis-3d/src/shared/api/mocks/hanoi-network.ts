import { LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON, U2M } from '@wn/map-runtime-3d'

/**
 * Synthetic water network for central Hanoi, used by the mock backend.
 *
 * It is generated (deterministically) rather than surveyed: a trunk main ring fed by a treatment
 * plant on the Red River dyke, a reservoir and a booster pump, bridge crossings to Long Bien,
 * and a street-like distribution lattice per DMA that avoids the lakes. Positions are anchored to
 * real landmarks so the pipes sit over the right neighbourhoods on the basemap, but the pipes are
 * NOT the real utility's records.
 *
 * Output uses the legacy fixture's pixel plane (see `pixel-affine`): x/y in px, lenM in metres.
 */

export type P = [number, number] // local metres: x east, y north of the frame centre

export const LAT_C = 21.03
export const LON_C = 105.845
export const ll = (lat: number, lon: number): P => [(lon - LON_C) * M_PER_DEG_LON, (lat - LAT_C) * M_PER_DEG_LAT]
export const toPx = (p: P): [number, number] => {
  const lon = LON_C + p[0] / M_PER_DEG_LON
  const lat = LAT_C + p[1] / M_PER_DEG_LAT
  return [Math.round(((lon - LON0) * M_PER_DEG_LON) / U2M), Math.round(((LAT0 - lat) * M_PER_DEG_LAT) / U2M)]
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])
const perp = (a: P, b: P): P => {
  const l = dist(a, b) || 1
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
}

export function inPoly(p: P, poly: P[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

// ───────────────────────────── geography ─────────────────────────────

export const LANDMARKS = {
  PLANT: ll(21.051, 105.847), // Yen Phu, on the Red River dyke
  N1: ll(21.044, 105.842), // Quan Thanh
  N2: ll(21.0365, 105.8365), // Ba Dinh Square
  N4: ll(21.031, 105.853), // north of Hoan Kiem Lake
  N5: ll(21.0425, 105.8595), // Long Bien bridge head
  N6: ll(21.0275, 105.863), // Chuong Duong bridge head
  N7: ll(21.0295, 105.8345), // Van Mieu
  N8: ll(21.0275, 105.8275), // Cat Linh
  N9: ll(21.0245, 105.841), // Hanoi railway station
  N10: ll(21.0075, 105.847), // Dai Co Viet
  N11: ll(21.0035, 105.842), // Giai Phong
  N13: ll(21.04, 105.8185), // Hoang Hoa Tham
  RES: ll(21.0055, 105.8395), // Dai La reservoir
  PUMP: ll(21.0125, 105.8235), // Thai Ha booster
  E1: ll(21.0445, 105.8715), // Long Bien (east bank)
  E2: ll(21.0235, 105.8725), // Gia Lam side
  E3: ll(21.0335, 105.8825), // Long Bien east
} as const
type NodeName = keyof typeof LANDMARKS

const TRUNKS: Array<[NodeName, NodeName, number]> = [
  ['PLANT', 'N1', 600],
  ['N1', 'N2', 500],
  ['N1', 'N4', 400],
  ['N1', 'N5', 400],
  ['N5', 'N4', 300],
  ['N5', 'E1', 400], // Long Bien bridge
  ['E1', 'E3', 300],
  ['E3', 'E2', 300],
  ['N4', 'N9', 500],
  ['N4', 'N6', 400],
  ['N6', 'E2', 300], // Chuong Duong bridge
  ['N2', 'N7', 400],
  ['N2', 'N13', 300],
  ['N7', 'N8', 400],
  ['N7', 'N9', 400],
  ['N9', 'N10', 500],
  ['N10', 'N11', 400],
  ['N11', 'RES', 400],
  ['RES', 'PUMP', 400],
  ['PUMP', 'N8', 400],
  ['N10', 'N6', 300],
]

const rect = (lat0: number, lat1: number, lon0: number, lon1: number): P[] => [
  ll(lat0, lon0),
  ll(lat0, lon1),
  ll(lat1, lon1),
  ll(lat1, lon0),
]

export interface DmaDef {
  id: string
  name: string
  poly: P[]
  spacing: number
  angle: number
}
export const DMAS: DmaDef[] = [
  { id: 'DMA-01', name: 'Hoàn Kiếm', poly: rect(21.0225, 21.047, 105.846, 105.864), spacing: 165, angle: 22 },
  { id: 'DMA-02', name: 'Ba Đình', poly: rect(21.029, 21.047, 105.822, 105.846), spacing: 215, angle: -8 },
  { id: 'DMA-03', name: 'Tây Hồ - Yên Phụ', poly: rect(21.047, 21.056, 105.822, 105.864), spacing: 245, angle: 15 },
  { id: 'DMA-04', name: 'Đống Đa', poly: rect(21.009, 21.029, 105.815, 105.846), spacing: 225, angle: 5 },
  {
    id: 'DMA-05',
    name: 'Hai Bà Trưng',
    poly: [ll(21.0225, 105.846), ll(21.0225, 105.864), ll(21.002, 105.864), ll(21.002, 105.822), ll(21.009, 105.822), ll(21.009, 105.846)],
    spacing: 235,
    angle: -15,
  },
  { id: 'DMA-06', name: 'Long Biên', poly: rect(21.02, 21.048, 105.8685, 105.89), spacing: 290, angle: 0 },
]
const DMA_COLOURS = ['#0E7C86', '#0969DA', '#1A7F37', '#8250DF', '#9A6700', '#D86C1F']

/** Lakes the street lattice must go around: [centre, rx, ry] in metres. */
const LAKES: Array<[P, number, number]> = [
  [ll(21.0286, 105.8523), 165, 370], // Hoan Kiem
  [ll(21.0125, 105.8455), 190, 290], // Bay Mau
  [ll(21.06, 105.823), 2100, 1500], // West Lake
]
const inLake = (p: P): boolean => LAKES.some(([c, rx, ry]) => ((p[0] - c[0]) / rx) ** 2 + ((p[1] - c[1]) / ry) ** 2 < 1)

// ───────────────────────────── graph ─────────────────────────────

interface GNode {
  p: P
  dma: number // index into DMAS, -1 for trunk-only nodes
}
interface GEdge {
  a: number
  b: number
  mid: P[] // interior vertices
  dn: number
  trunk: boolean
  dma: number
  boundary?: boolean
}

/** Age-driven pipe attributes shared by the synthetic and the OSM-based generators. */
export function describePipe(rand: () => number, dn: number, trunk: boolean) {
  const crs: Record<string, string> = { HDPE: 'HD', uPVC: 'UP', 'Gang dẻo': 'GD', 'Gang xám': 'GX', Thép: 'TH' }
  const old = rand() < (trunk ? 0.5 : 0.35)
  const year = old ? 1985 + Math.floor(rand() * 20) : 2005 + Math.floor(rand() * 21)
  const material = dn >= 200 ? (old ? 'Gang xám' : 'Gang dẻo') : old ? 'Gang xám' : rand() < 0.5 ? 'HDPE' : 'uPVC'
  const age = 2026 - year
  const r = rand()
  const cond = age > 30 && r < 0.4 ? 'poor' : age > 15 && r < 0.45 ? 'fair' : 'good'
  return { year, material, cond, code: `ONG_${crs[material]}_DN${dn}`, status: rand() < 0.02 ? 'planned' : 'active' }
}

export interface HanoiNetwork {
  pipes: Array<Record<string, unknown> & { id: string; pts: Array<[number, number]> }>
  dmas: Array<{ id: string; name: string; col: string; poly: Array<[number, number]> }>
  plant: Record<string, unknown>
  reservoirs: Array<Record<string, unknown>>
  pumps: Array<Record<string, unknown>>
  /** Customer connection points (px), when derived from real buildings. */
  connDots?: Array<{ x: number; y: number; dma: string }>
}

export function buildHanoiNetwork(): HanoiNetwork {
  const rand = rng(20261028)
  const nodes: GNode[] = []
  const edges: GEdge[] = []
  const addNode = (p: P, dma = -1): number => nodes.push({ p, dma }) - 1
  const dmaOf = (p: P): number => DMAS.findIndex((d) => inPoly(p, d.poly))

  // ── trunk mains ──
  const named = new Map<NodeName, number>()
  for (const [name, p] of Object.entries(LANDMARKS) as Array<[NodeName, P]>) named.set(name, addNode(p))
  interface Trunk {
    a: number
    b: number
    dn: number
    pts: P[]
    cuts: Map<number, number> // vertex index -> node id
  }
  const trunks: Trunk[] = TRUNKS.map(([an, bn, dn]) => {
    const a = LANDMARKS[an]
    const b = LANDMARKS[bn]
    const len = dist(a, b)
    const n = Math.max(2, Math.round(len / 150))
    const sway = len * 0.05 * (rand() * 2 - 1)
    const nrm = perp(a, b)
    const pts: P[] = [a]
    for (let i = 1; i < n; i++) {
      const t = i / n
      const off = sway * Math.sin(Math.PI * t) + (rand() - 0.5) * 14
      pts.push([a[0] + (b[0] - a[0]) * t + nrm[0] * off, a[1] + (b[1] - a[1]) * t + nrm[1] * off])
    }
    pts.push(b)
    return { a: named.get(an)!, b: named.get(bn)!, dn, pts, cuts: new Map() }
  })

  // ── distribution lattices, one per DMA ──
  const lattice: Array<Map<string, number>> = DMAS.map(() => new Map())
  DMAS.forEach((d, di) => {
    const xs = d.poly.map((p) => p[0])
    const ys = d.poly.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const reach = Math.ceil(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / d.spacing / 2) + 1
    const th = (d.angle * Math.PI) / 180
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const u = (i + (rand() - 0.5) * 0.3) * d.spacing
        const v = (j + (rand() - 0.5) * 0.3) * d.spacing
        const p: P = [cx + u * cos - v * sin, cy + u * sin + v * cos]
        if (!inPoly(p, d.poly) || inLake(p)) continue
        lattice[di]!.set(`${i},${j}`, addNode(p, di))
      }
    }
    const edgeOk = (a: P, b: P) => !inLake([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) && !inLake([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]) && !inLake([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    const mids = (a: P, b: P): P[] => {
      const nrm = perp(a, b)
      const off = (rand() - 0.5) * 0.14 * dist(a, b)
      return [[(a[0] + b[0]) / 2 + nrm[0] * off, (a[1] + b[1]) / 2 + nrm[1] * off]]
    }
    const degree = new Map<number, number>()
    const cand: GEdge[] = []
    for (const [key, a] of lattice[di]!) {
      const [i, j] = key.split(',').map(Number) as [number, number]
      for (const [di2, dj2] of [[1, 0], [0, 1]] as const) {
        const b = lattice[di]!.get(`${i + di2},${j + dj2}`)
        if (b === undefined || !edgeOk(nodes[a]!.p, nodes[b]!.p)) continue
        const line = di2 === 1 ? j : i // grid line this street sits on
        const dn = line % 6 === 0 ? 200 : line % 3 === 0 ? 150 : 100
        cand.push({ a, b, mid: mids(nodes[a]!.p, nodes[b]!.p), dn, trunk: false, dma: di })
        degree.set(a, (degree.get(a) ?? 0) + 1)
        degree.set(b, (degree.get(b) ?? 0) + 1)
      }
    }
    // dead-end streets: drop some small pipes, but never leave a node with fewer than two connections
    for (const e of cand) {
      if (e.dn === 100 && rand() < 0.1 && (degree.get(e.a) ?? 0) > 2 && (degree.get(e.b) ?? 0) > 2) {
        degree.set(e.a, degree.get(e.a)! - 1)
        degree.set(e.b, degree.get(e.b)! - 1)
        continue
      }
      edges.push(e)
    }
  })

  // ── feeders: lattice ↔ trunk ──
  const trunkLinked = new Set<number>()
  const nearestLattice = (p: P, maxD: number): number | null => {
    let best: number | null = null
    let bestD = maxD
    nodes.forEach((n, id) => {
      if (n.dma < 0 || trunkLinked.has(id)) return
      const d = dist(n.p, p)
      if (d < bestD) {
        bestD = d
        best = id
      }
    })
    return best
  }
  const feeder = (a: number, b: number, dn: number, dma: number, boundary = false) => {
    const pa = nodes[a]!.p
    const pb = nodes[b]!.p
    const nrm = perp(pa, pb)
    const off = (rand() - 0.5) * 0.1 * dist(pa, pb)
    edges.push({ a, b, mid: [[(pa[0] + pb[0]) / 2 + nrm[0] * off, (pa[1] + pb[1]) / 2 + nrm[1] * off]], dn, trunk: false, dma, boundary })
  }
  for (const t of trunks) {
    for (let i = 0; i < t.pts.length; i += 2) {
      const vp = t.pts[i]!
      const ln = nearestLattice(vp, 230)
      if (ln === null) continue
      let id: number
      if (i === 0) id = t.a
      else if (i === t.pts.length - 1) id = t.b
      else {
        id = addNode(vp)
        t.cuts.set(i, id)
      }
      trunkLinked.add(ln)
      feeder(ln, id, t.dn >= 500 ? 300 : 200, nodes[ln]!.dma)
    }
  }
  // trunk pipes, split at every feeder junction
  for (const t of trunks) {
    const stops = [0, ...[...t.cuts.keys()].sort((x, y) => x - y), t.pts.length - 1]
    const ids = [t.a, ...stops.slice(1, -1).map((i) => t.cuts.get(i)!), t.b]
    for (let k = 0; k < stops.length - 1; k++) {
      edges.push({ a: ids[k]!, b: ids[k + 1]!, mid: t.pts.slice(stops[k]! + 1, stops[k + 1]!), dn: t.dn, trunk: true, dma: dmaOf(t.pts[Math.floor((stops[k]! + stops[k + 1]!) / 2)]!) })
    }
  }

  // ── DMA boundary links (closed boundary valves are added by the seed) ──
  const crossed = new Set<number>()
  for (const [a, na] of nodes.entries()) {
    if (na.dma < 0 || crossed.has(a)) continue
    let best = -1
    let bestD = DMAS[na.dma]!.spacing * 1.6
    for (const [b, nb] of nodes.entries()) {
      if (nb.dma < 0 || nb.dma === na.dma || crossed.has(b)) continue
      const d = dist(na.p, nb.p)
      if (d < bestD && !inLake([(na.p[0] + nb.p[0]) / 2, (na.p[1] + nb.p[1]) / 2])) {
        bestD = d
        best = b
      }
    }
    if (best >= 0 && rand() < 0.45) {
      crossed.add(a)
      crossed.add(best)
      feeder(a, best, 150, na.dma, true)
    }
  }

  // ── make sure everything is one connected network ──
  const parent = nodes.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)))
  for (const e of edges) parent[find(e.a)] = find(e.b)
  const root = find(named.get('PLANT')!)
  for (let guard = 0; guard < 200; guard++) {
    const loose = nodes.findIndex((_, i) => find(i) !== root)
    if (loose < 0) break
    const comp = find(loose)
    let ba = -1
    let bb = -1
    let bd = Infinity
    nodes.forEach((na, a) => {
      if (find(a) !== comp) return
      nodes.forEach((nb, b) => {
        if (find(b) !== root) return
        const d = dist(na.p, nb.p)
        if (d < bd) {
          bd = d
          ba = a
          bb = b
        }
      })
    })
    if (ba < 0) break
    feeder(ba, bb, 150, Math.max(nodes[ba]!.dma, nodes[bb]!.dma))
    parent[find(ba)] = find(bb)
  }

  // ── pipe attributes ──
  const pipes: HanoiNetwork['pipes'] = []
  const crs: Record<string, string> = { HDPE: 'HD', uPVC: 'UP', 'Gang dẻo': 'GD', 'Gang xám': 'GX', Thép: 'TH' }
  for (const e of edges) {
    const pa = nodes[e.a]!.p
    const pb = nodes[e.b]!.p
    const pts: P[] = [pa, ...e.mid, pb]
    let len = 0
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!)
    if (len < 8) continue
    const id = `P-${String(pipes.length + 1).padStart(4, '0')}`
    const old = rand() < (e.trunk ? 0.5 : 0.35)
    const year = old ? 1985 + Math.floor(rand() * 20) : 2005 + Math.floor(rand() * 21)
    const material = e.dn >= 300 ? (old ? 'Gang xám' : 'Gang dẻo') : e.dn >= 200 ? (old ? 'Gang xám' : 'Gang dẻo') : old ? 'Gang xám' : rand() < 0.5 ? 'HDPE' : 'uPVC'
    const age = 2026 - year
    const r = rand()
    const cond = age > 30 && r < 0.4 ? 'poor' : age > 15 && r < 0.45 ? 'fair' : 'good'
    const dma = e.dma >= 0 ? DMAS[e.dma]!.id : 'DMA-01'
    pipes.push({
      id,
      code: `ONG_${crs[material]}_DN${e.dn}`,
      from: `${id}-a`,
      to: `${id}-b`,
      dn: e.dn,
      trunk: e.trunk,
      material,
      year,
      cond,
      status: rand() < 0.02 ? 'planned' : 'active',
      lenM: Math.round(len),
      pts: pts.map(toPx),
      dma,
      ...(e.boundary ? { boundary: true } : {}),
    })
  }

  const at = (p: P) => toPx(p)
  const pick = (name: NodeName) => at(LANDMARKS[name])
  return {
    pipes,
    dmas: DMAS.map((d, i) => ({
      id: d.id,
      name: d.name,
      col: DMA_COLOURS[i]!,
      poly: [...d.poly, d.poly[0]!].map(toPx),
    })),
    plant: { id: 'PLANT-01', name: 'Nhà máy nước Yên Phụ', x: pick('PLANT')[0], y: pick('PLANT')[1], flow: 150000 },
    reservoirs: [{ id: 'RES-1', name: 'Bể chứa Đại La', x: pick('RES')[0], y: pick('RES')[1], cap: 20000, level: 72, dma: 'DMA-05' }],
    pumps: [
      { id: 'PUMP-1', name: 'Trạm tăng áp Thái Hà', x: pick('PUMP')[0], y: pick('PUMP')[1], pumps: 3, run: 2, dma: 'DMA-04' },
      { id: 'PUMP-2', name: 'Trạm tăng áp Long Biên', x: pick('E1')[0], y: pick('E1')[1], pumps: 2, run: 1, dma: 'DMA-06' },
    ],
  }
}
