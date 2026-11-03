import { DMAS, LANDMARKS, describePipe, dist, ll, inPoly, rng, toPx, type HanoiNetwork, type P } from './hanoi-network'

/**
 * Builds the mock water network from OpenStreetMap data (see `scripts/fetch-osm-hanoi.mjs`):
 * pipes are laid along the real street centrelines, sized by road class, and customer connections
 * sit at real building centroids. Still a *demo* network (OSM has no utility data): which streets
 * carry a main, DMA membership, ages and hydraulics are generated.
 */

export type RoadClass = 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'unclassified' | 'living_street'
export interface OsmData {
  bbox?: [number, number, number, number]
  fetchedAt?: string
  /** `i` = OSM node ids, `p` = lon/lat × 1e5 as a flat [lon, lat, lon, lat…] array. */
  roads: Array<{ c: RoadClass; i: number[]; p: number[]; b?: 1 }>
  water?: Array<{ p: number[] }>
  /** Building centroids, flat [lon, lat…] × 1e5. */
  buildings?: number[]
}

const DN: Record<RoadClass, number> = { trunk: 600, primary: 500, secondary: 300, tertiary: 200, residential: 150, unclassified: 100, living_street: 100 }
/** Share of streets (whole OSM ways) that get a pipe; mains are always laid. */
const KEEP: Record<RoadClass, number> = { trunk: 1, primary: 1, secondary: 1, tertiary: 0.9, residential: 0.65, unclassified: 0.4, living_street: 0.35 }
const MAX_PIPE_M = 380 // chains of same-size pipes are merged up to this length
const MIN_SPUR_M = 70 // dead-end stubs shorter than this are dropped
const MAX_CONNECTIONS = 4000
const CONN_REACH_M = 45

interface Edge {
  a: number
  b: number
  pts: P[]
  cls: RoadClass
  dn: number
  len: number
  way: number
  bridge: boolean
}

/** The Red River strip between the west-bank DMAs and Long Bien; its banks and approach roads still carry pipes. */
const RIVER_GAP = [ll(21.019, 105.8635), ll(21.049, 105.8695)]
const inRiverGap = (p: P) => p[0] >= RIVER_GAP[0]![0] && p[0] <= RIVER_GAP[1]![0] && p[1] >= RIVER_GAP[0]![1] && p[1] <= RIVER_GAP[1]![1]

const hash01 = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761)
  h ^= h >>> 15
  h = Math.imul(h, 2246822519)
  h ^= h >>> 13
  return ((h >>> 0) % 100003) / 100003
}
const polyLen = (pts: P[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1]!, p) : 0), 0)

export function buildOsmNetwork(osm: OsmData): HanoiNetwork {
  const rand = rng(20261029)
  const dmaOf = (p: P): number => DMAS.findIndex((d) => inPoly(p, d.poly))

  // ── 1. street graph: split ways at junctions ──
  const uses = new Map<number, number>()
  for (const w of osm.roads) for (const id of w.i) uses.set(id, (uses.get(id) ?? 0) + 1)
  const coord = new Map<number, P>()
  const edges: Edge[] = []
  osm.roads.forEach((w) => {
    const pts: P[] = []
    for (let k = 0; k < w.i.length; k++) {
      const p = ll(w.p[2 * k + 1]! / 1e5, w.p[2 * k]! / 1e5)
      pts.push(p)
      coord.set(w.i[k]!, p)
    }
    let start = 0
    for (let k = 1; k < w.i.length; k++) {
      const junction = (uses.get(w.i[k]!) ?? 0) > 1 || k === w.i.length - 1
      if (!junction) continue
      const seg = pts.slice(start, k + 1)
      const a = w.i[start]!
      const b = w.i[k]!
      start = k
      if (a === b && seg.length < 4) continue
      const len = polyLen(seg)
      if (len < 1) continue
      edges.push({ a, b, pts: seg, cls: w.c, dn: DN[w.c], len, way: w.i[0]!, bridge: !!w.b })
    }
  })

  // ── 2. choose which streets carry a pipe; keep only the DMA area ──
  let kept = edges.filter((e) => {
    if (hash01(e.way) >= KEEP[e.cls]) return false
    const mid = e.pts[Math.floor(e.pts.length / 2)]!
    // bridges carry mains across the river, between the DMA polygons
    return e.bridge || inRiverGap(mid) || dmaOf(mid) >= 0
  })

  const adjacency = (es: Edge[]) => {
    const adj = new Map<number, number[]>()
    es.forEach((e, i) => {
      for (const n of [e.a, e.b]) (adj.get(n) ?? adj.set(n, []).get(n)!).push(i)
    })
    return adj
  }
  // drop short dead-end stubs (two passes), then keep the largest connected component
  for (let pass = 0; pass < 2; pass++) {
    const adj = adjacency(kept)
    kept = kept.filter((e) => {
      const spur = (n: number) => (adj.get(n)?.length ?? 0) === 1
      return !(e.len < MIN_SPUR_M && (spur(e.a) || spur(e.b)) && e.a !== e.b)
    })
  }
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  for (const e of kept) parent.set(find(e.a), find(e.b))
  const weight = new Map<number, number>()
  for (const e of kept) weight.set(find(e.a), (weight.get(find(e.a)) ?? 0) + e.len)
  let main = -1
  let best = 0
  for (const [r, w] of weight) {
    if (w > best) {
      best = w
      main = r
    }
  }
  kept = kept.filter((e) => find(e.a) === main)
  if (kept.length === 0) throw new Error('OSM data produced no usable street network')

  // ── 3. merge chains of same-size pipes through degree-2 junctions ──
  const adj = adjacency(kept)
  const used = new Set<number>()
  interface Pipe {
    a: number
    b: number
    pts: P[]
    dn: number
    cls: RoadClass
  }
  const pipes: Pipe[] = []
  const farEnd = (e: Edge, from: number) => (e.a === from ? e.b : e.a)
  const oriented = (e: Edge, from: number): P[] => (e.a === from ? e.pts : e.pts.slice().reverse())
  kept.forEach((seed, si) => {
    if (used.has(si)) return
    used.add(si)
    let pts = seed.pts.slice()
    let a = seed.a
    let b = seed.b
    let len = seed.len
    const extend = (atEnd: boolean) => {
      for (;;) {
        const node = atEnd ? b : a
        const around = adj.get(node) ?? []
        if (around.length !== 2 || a === b) return
        const next = around.find((i) => kept[i] !== seed && !used.has(i))
        if (next === undefined) return
        const e = kept[next]!
        if (e.dn !== seed.dn || len + e.len > MAX_PIPE_M || e.a === e.b) return
        used.add(next)
        len += e.len
        if (atEnd) {
          pts = pts.concat(oriented(e, node).slice(1))
          b = farEnd(e, node)
        } else {
          pts = oriented(e, node).slice().reverse().slice(0, -1).concat(pts)
          a = farEnd(e, node)
        }
      }
    }
    extend(true)
    extend(false)
    pipes.push({ a, b, pts, dn: seed.dn, cls: seed.cls })
  })

  // ── 4. sources snap to the nearest main/trunk junction ──
  const junctions = new Set<number>()
  for (const p of pipes) {
    junctions.add(p.a)
    junctions.add(p.b)
  }
  const snap = (target: P, minDn = 0): { id: number; p: P } => {
    const eligible = new Set<number>()
    for (const p of pipes) {
      if (p.dn >= minDn) {
        eligible.add(p.a)
        eligible.add(p.b)
      }
    }
    let bestId = -1
    let bestD = Infinity
    for (const id of eligible.size ? eligible : junctions) {
      const d = dist(coord.get(id)!, target)
      if (d < bestD) {
        bestD = d
        bestId = id
      }
    }
    return { id: bestId, p: coord.get(bestId)! }
  }
  const plant = snap(LANDMARKS.PLANT, 400)
  const reservoir = snap(LANDMARKS.RES, 300)
  const pump1 = snap(LANDMARKS.PUMP, 300)
  const pump2 = snap(LANDMARKS.E1, 200)

  // ── 5. DMAs, boundary links and closed valves ──
  const nodeDma = (id: number) => dmaOf(coord.get(id)!)
  const dmaOfPipe = (p: Pipe) => {
    const d = dmaOf(p.pts[Math.floor(p.pts.length / 2)]!)
    return d >= 0 ? d : Math.max(0, nodeDma(p.a))
  }
  const isBoundary = (p: Pipe) => p.dn <= 200 && nodeDma(p.a) >= 0 && nodeDma(p.b) >= 0 && nodeDma(p.a) !== nodeDma(p.b)
  const cand = pipes.filter(isBoundary)
  // a boundary valve may only be closed if every junction stays supplied without it
  const par2 = new Map<number, number>()
  const f2 = (x: number): number => {
    const p = par2.get(x) ?? x
    if (p === x) return x
    const r = f2(p)
    par2.set(x, r)
    return r
  }
  for (const p of pipes) if (!cand.includes(p)) par2.set(f2(p.a), f2(p.b))
  const mustStayOpen = new Set<Pipe>()
  for (const p of cand) {
    if (f2(p.a) !== f2(p.b)) {
      mustStayOpen.add(p)
      par2.set(f2(p.a), f2(p.b))
    }
  }

  // ── 6. emit pipes ──
  const out: HanoiNetwork['pipes'] = []
  for (const p of pipes) {
    const id = `P-${String(out.length + 1).padStart(4, '0')}`
    const trunk = p.dn >= 300
    const dn = p.cls === 'residential' && hash01(p.a + 7) < 0.4 ? 100 : p.dn
    const d = describePipe(rand, dn, trunk)
    const dma = DMAS[dmaOfPipe(p)]!.id
    const boundary = cand.includes(p)
    out.push({
      id,
      code: d.code,
      from: `${id}-a`,
      to: `${id}-b`,
      dn,
      trunk,
      material: d.material,
      year: d.year,
      cond: d.cond,
      status: d.status,
      lenM: Math.round(polyLen(p.pts)),
      pts: p.pts.map(toPx),
      dma,
      ...(boundary ? { boundary: true, boundaryClosed: !mustStayOpen.has(p) && hash01(p.a ^ p.b) < 0.8 } : {}),
    })
  }

  // ── 7. customer connections at real buildings ──
  const connDots: NonNullable<HanoiNetwork['connDots']> = []
  if (osm.buildings?.length) {
    const CELL = 60
    const grid = new Map<string, Array<{ p: P; dma: string }>>()
    const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
    pipes.forEach((p, i) => {
      if (p.dn > 200) return
      const dma = out[i]!.dma as string
      for (let k = 1; k < p.pts.length; k++) {
        const a = p.pts[k - 1]!
        const b = p.pts[k]!
        const n = Math.max(1, Math.ceil(dist(a, b) / 15))
        for (let s = 0; s < n; s++) {
          const q: P = [a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]
          const kk = key(q[0], q[1])
          ;(grid.get(kk) ?? grid.set(kk, []).get(kk)!).push({ p: q, dma })
        }
      }
    })
    const taken = new Set<string>()
    for (let k = 0; k + 1 < osm.buildings.length && connDots.length < MAX_CONNECTIONS; k += 2) {
      const bp = ll(osm.buildings[k + 1]! / 1e5, osm.buildings[k]! / 1e5)
      const cx = Math.floor(bp[0] / CELL)
      const cy = Math.floor(bp[1] / CELL)
      let bestD = CONN_REACH_M
      let hit: { p: P; dma: string } | undefined
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const c of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = dist(c.p, bp)
            if (d < bestD) {
              bestD = d
              hit = c
            }
          }
      if (!hit) continue
      const tag = `${Math.round(hit.p[0] / 12)},${Math.round(hit.p[1] / 12)}` // at most one meter per ~12 m of pipe
      if (taken.has(tag)) continue
      taken.add(tag)
      const t = Math.min(1, 3 / (bestD || 1)) // meter box 3 m from the pipe, towards the building
      const [x, y] = toPx([hit.p[0] + (bp[0] - hit.p[0]) * t, hit.p[1] + (bp[1] - hit.p[1]) * t])
      connDots.push({ x, y, dma: hit.dma })
    }
  }

  const at = (n: { p: P }) => toPx(n.p)
  return {
    pipes: out,
    dmas: DMAS.map((d, i) => ({ id: d.id, name: d.name, col: ['#0E7C86', '#0969DA', '#1A7F37', '#8250DF', '#9A6700', '#D86C1F'][i]!, poly: [...d.poly, d.poly[0]!].map(toPx) })),
    plant: { id: 'PLANT-01', name: 'Nhà máy nước Yên Phụ', x: at(plant)[0], y: at(plant)[1], flow: 150000 },
    reservoirs: [{ id: 'RES-1', name: 'Bể chứa Đại La', x: at(reservoir)[0], y: at(reservoir)[1], cap: 20000, level: 72, dma: 'DMA-05' }],
    pumps: [
      { id: 'PUMP-1', name: 'Trạm tăng áp Thái Hà', x: at(pump1)[0], y: at(pump1)[1], pumps: 3, run: 2, dma: 'DMA-04' },
      { id: 'PUMP-2', name: 'Trạm tăng áp Long Biên', x: at(pump2)[0], y: at(pump2)[1], pumps: 2, run: 1, dma: 'DMA-06' },
    ],
    connDots,
  }
}
