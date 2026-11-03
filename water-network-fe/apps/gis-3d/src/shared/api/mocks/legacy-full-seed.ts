import { LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON, U2M } from '@wn/map-runtime-3d'
import legacySeed from './gis-full.json'
import { buildHanoiNetwork, type HanoiNetwork } from './hanoi-network'
import { buildOsmNetwork, type OsmData } from './osm-network'

// Optional: produced by `node scripts/fetch-osm-hanoi.mjs`. Absent → the synthetic grid is used.
const osmFiles = import.meta.glob<OsmData>('./osm-hanoi.json', { eager: true, import: 'default' })

const INSET = 40

type Pt = [number, number]
interface Seed {
  world: { w: number; h: number }
  pipes: Array<{ pts: Pt[] } & Record<string, unknown>>
  pipeBy: Record<string, { pts: Pt[] } & Record<string, unknown>>
  reservoirs: Array<{ x: number; y: number }>
  pumps: Array<{ x: number; y: number }>
  dmas: Array<{ poly: Pt[] }>
  DASH: unknown
  LAYERS: unknown
  [key: string]: unknown
}

/**
 * The mock payload: the legacy fixture's static catalogues (layers, enums, roles, …) with its
 * Tam Dương network replaced by the generated central-Hanoi network (`hanoi-network.ts`).
 */
export function hanoiNetwork(osm: OsmData | undefined = Object.values(osmFiles)[0]): HanoiNetwork {
  return osm && osm.roads?.length ? buildOsmNetwork(osm) : buildHanoiNetwork()
}

function hanoiSource(): Record<string, unknown> {
  const hanoi = hanoiNetwork()
  return {
    ...(structuredClone(legacySeed) as Record<string, unknown>),
    ...hanoi,
    // separate copies: the rebase below shifts pipes and pipeBy independently
    pipeBy: Object.fromEntries(hanoi.pipes.map((p) => [p.id, JSON.parse(JSON.stringify(p))])),
  }
}

/**
 * Rebases a pixel-plane payload to a positive plane and adds the `geo` metadata the real BFF
 * sends, so the mock opens centred on the data at its true location. Defaults to the Hanoi
 * network; pass `legacySeed` for the original Tam Dương fixture.
 */
export function buildLegacyFullSeed(source: unknown = hanoiSource()): Record<string, unknown> {
  const seed = structuredClone(source) as Seed
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const pipe of seed.pipes) for (const [x, y] of pipe.pts) grow(x, y)
  for (const r of [...seed.reservoirs, ...seed.pumps]) grow(r.x, r.y)
  for (const d of seed.dmas) for (const [x, y] of d.poly) grow(x, y)

  const dx = INSET - minX
  const dy = INSET - minY
  const shift = (p: Pt) => {
    p[0] += dx
    p[1] += dy
  }
  // pipeBy holds clones of the same pipes (separate objects after JSON parse).
  for (const pipe of [...seed.pipes, ...Object.values(seed.pipeBy)]) pipe.pts.forEach(shift)
  for (const r of [...seed.reservoirs, ...seed.pumps]) {
    r.x += dx
    r.y += dy
  }
  for (const d of seed.dmas) d.poly.forEach(shift)
  for (const c of (seed.connDots as Array<{ x: number; y: number }> | undefined) ?? []) {
    c.x += dx
    c.y += dy
  }
  const plant = seed.plant as { x?: number; y?: number }
  if (typeof plant.x === 'number' && typeof plant.y === 'number') {
    plant.x += dx
    plant.y += dy
  }

  const w = Math.ceil(maxX - minX) + 2 * INSET
  const h = Math.ceil(maxY - minY) + 2 * INSET
  seed.world = { w, h }
  addFittings(seed)
  addHydraulics(seed)
  addAssets(seed)
  refreshSummaries(seed)

  const kx = U2M / M_PER_DEG_LON
  const ky = U2M / M_PER_DEG_LAT
  // Keep the network where the 2D pixel affine already puts it.
  const minLon = LON0 + minX * kx - INSET * kx
  const maxLat = LAT0 - minY * ky + INSET * ky
  const maxLon = minLon + w * kx
  const minLat = maxLat - h * ky
  seed.geo = {
    bbox: [minLon, minLat, maxLon, maxLat],
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    source: 'data_extent',
    inset: INSET,
    unitsToMeters: U2M,
    metersPerDegreeLon: M_PER_DEG_LON,
    metersPerDegreeLat: M_PER_DEG_LAT,
  }
  return seed as Record<string, unknown>
}

interface SeedPipe {
  id: string
  dn: number
  dma?: string
  pts: Pt[]
}

/** The legacy fixture ships no valves / hydrants / customer connections; derive a plausible set from the pipes. */
function addFittings(seed: Seed): void {
  const pipes = seed.pipes as unknown as SeedPipe[]
  const valves: unknown[] = []
  const hydrants: unknown[] = []
  // connections derived from real buildings (OSM) arrive with the network; otherwise derive them from the pipes
  const given = (seed.connDots as unknown[] | undefined) ?? []
  const conns: unknown[] = given.length ? given : []
  pipes.forEach((pipe, i) => {
    // DMA boundary links carry a valve that is normally closed (the DMA is fed from the trunk instead)
    if ((pipe as unknown as { boundary?: boolean }).boundary) {
      const m = pipe.pts[Math.floor(pipe.pts.length / 2)]!
      const flagged = (pipe as unknown as { boundaryClosed?: boolean }).boundaryClosed
      const closed = flagged ?? hash01(pipe.id) < 0.7
      valves.push({
        id: `V-${valves.length + 1}`,
        code: `V.${valves.length + 1}`,
        pipe: pipe.id,
        dn: pipe.dn,
        kind: 'boundary',
        state: closed ? 'closed' : 'open',
        dma: pipe.dma ?? 'DMA-01',
        year: 2021,
        x: m[0],
        y: m[1],
      })
      if (closed) (pipe as unknown as { noFlow?: boolean }).noFlow = true
    }
    const mid = pipe.pts[Math.floor(pipe.pts.length / 2)]
    const a = pipe.pts[0]
    const b = pipe.pts[pipe.pts.length - 1]
    if (!mid || !a || !b || pipe.pts.length < 2) return
    const dma = pipe.dma ?? 'DMA-01'
    // a valve at the start of every 12th pipe, a hydrant on every 20th large main
    if (i % 12 === 0) {
      valves.push({
        id: `V-${valves.length + 1}`,
        code: `V.${valves.length + 1}`,
        pipe: pipe.id,
        dn: pipe.dn,
        kind: pipe.dn >= 200 ? 'boundary' : 'isolation',
        state: i % 36 === 0 ? 'closed' : 'open',
        dma,
        year: 2020,
        x: a[0],
        y: a[1],
      })
    }
    if (i % 20 === 5)
      hydrants.push({
        id: `H-${hydrants.length + 1}`,
        code: `PCC.${hydrants.length + 1}`,
        dma,
        status: 'ok',
        x: mid[0] + 4,
        y: mid[1] + 4,
      })
    // customer meters along small distribution pipes: every ~25 m, 5 m to the side
    if (!given.length && pipe.dn <= 150) {
      for (let k = 1; k < pipe.pts.length; k++) {
        const p = pipe.pts[k - 1]!
        const q = pipe.pts[k]!
        const dx = q[0] - p[0]
        const dy = q[1] - p[1]
        const l = Math.hypot(dx, dy)
        if (l < 40) continue
        const side = k % 2 === 0 ? 1 : -1
        conns.push({
          x: p[0] + dx / 2 - (dy / l) * 4 * side,
          y: p[1] + dy / 2 + (dx / l) * 4 * side,
          dma,
        })
      }
    }
  })
  seed.valves = valves
  seed.hydrants = hydrants
  seed.connDots = conns
}

interface HydraulicPipe extends SeedPipe {
  lenM?: number
  trunk?: boolean
  pressure?: number
  flowDir?: 'forward' | 'reverse'
}

const SOURCE_PRESSURE_BAR = 5.8
const HEADLOSS_BAR_PER_KM = 0.55

/**
 * The fixture has no hydraulic results. Derive believable ones: water leaves the
 * plant / reservoir / pump and spreads outward through the connected pipes, so each
 * pipe is oriented away from the nearest source, and pressure falls with the
 * distance travelled (plus a little per-pipe variation). A real backend would send
 * its model results in the same `pressure` / `flowDir` fields.
 */
function addHydraulics(seed: Seed): void {
  const pipes = seed.pipes as unknown as HydraulicPipe[]
  const key = (p: Pt) => `${Math.round(p[0] / 3)},${Math.round(p[1] / 3)}`
  const at = new Map<string, Array<{ pipe: HydraulicPipe; end: 'start' | 'end' }>>()
  const add = (k: string, v: { pipe: HydraulicPipe; end: 'start' | 'end' }) =>
    (at.get(k) ?? at.set(k, []).get(k)!).push(v)
  for (const pipe of pipes) {
    if (pipe.pts.length < 2) continue
    add(key(pipe.pts[0]!), { pipe, end: 'start' })
    add(key(pipe.pts[pipe.pts.length - 1]!), { pipe, end: 'end' })
  }
  const nearestEndpoint = (x: number, y: number): string | null => {
    let best: string | null = null
    let bestD = Infinity
    for (const k of at.keys()) {
      const [kx, ky] = k.split(',').map(Number) as [number, number]
      const d = Math.hypot(kx * 3 - x, ky * 3 - y)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    return best
  }
  const sources: string[] = []
  const plant = seed.plant as { x?: number; y?: number }
  if (typeof plant.x === 'number' && typeof plant.y === 'number')
    sources.push(nearestEndpoint(plant.x, plant.y) ?? '')
  for (const r of [...seed.reservoirs, ...seed.pumps]) sources.push(nearestEndpoint(r.x, r.y) ?? '')

  const distAt = new Map<string, number>()
  const done = new Set<string>()
  const visitFrom = (start: string) => {
    if (!at.has(start) || distAt.has(start)) return
    distAt.set(start, 0)
    const queue = [start]
    while (queue.length) {
      const node = queue.shift()!
      for (const { pipe, end } of at.get(node) ?? []) {
        if (done.has(pipe.id) || (pipe as unknown as { noFlow?: boolean }).noFlow) continue
        done.add(pipe.id)
        pipe.flowDir = end === 'start' ? 'forward' : 'reverse'
        const farKey = key(end === 'start' ? pipe.pts[pipe.pts.length - 1]! : pipe.pts[0]!)
        const d0 = distAt.get(node) ?? 0
        const d1 = d0 + (pipe.lenM ?? 50)
        // pressure at the pipe's midpoint
        pipe.pressure = Math.max(
          1,
          SOURCE_PRESSURE_BAR -
            ((d0 + d1) / 2 / 1000) * HEADLOSS_BAR_PER_KM +
            (hash01(pipe.id) - 0.5) * 0.6
        )
        if (!distAt.has(farKey)) {
          distAt.set(farKey, d1)
          queue.push(farKey)
        }
      }
    }
  }
  for (const s of sources) visitFrom(s)
  // islands not connected to any source: start at their first endpoint, mid pressure
  for (const pipe of pipes) {
    if (done.has(pipe.id) || pipe.pts.length < 2) continue
    visitFrom(key(pipe.pts[0]!))
  }
  for (const pipe of pipes) pipe.flowDir ??= 'forward'
  for (const pipe of pipes) pipe.pressure ??= 3
  // pipeBy holds copies of the same pipes
  const by = seed.pipeBy as unknown as Record<string, HydraulicPipe>
  for (const pipe of pipes) {
    const copy = by[pipe.id]
    if (copy) {
      copy.pressure = pipe.pressure
      copy.flowDir = pipe.flowDir
    }
  }
}

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}

/** Counters shown in the sidebar / layer panel, recomputed for the generated network. */
function refreshSummaries(seed: Seed): void {
  const pipes = seed.pipes as unknown as Array<SeedPipe & { lenM: number; cond: string; material: string }>
  const count = (xs: unknown) => (Array.isArray(xs) ? xs.length : 0)
  const km = pipes.reduce((s, p) => s + p.lenM, 0) / 1000
  const tally = (key: 'cond' | 'material') => {
    const m = new Map<string, number>()
    for (const p of pipes) m.set(p[key], (m.get(p[key]) ?? 0) + 1)
    return m
  }
  const dash = seed.DASH as Record<string, unknown>
  dash.pipeKm = Math.round(km * 10) / 10
  dash.pipeCount = pipes.length
  dash.valveCount = count(seed.valves)
  dash.hydrantCount = count(seed.hydrants)
  dash.connCount = count(seed.connDots)
  dash.dmaCount = seed.dmas.length
  const condMix = dash.condMix as Array<{ k: string; n: number }>
  const conds = tally('cond')
  for (const c of condMix) c.n = conds.get(c.k) ?? 0
  dash.matMix = [...tally('material')].map(([label, n]) => ({ label, n }))
  const counts: Record<string, number> = {
    dma: seed.dmas.length,
    pipe: pipes.length,
    valve: count(seed.valves),
    hydrant: count(seed.hydrants),
    conn: count(seed.connDots),
    source: 1 + seed.reservoirs.length + seed.pumps.length,
  }
  for (const layer of seed.LAYERS as Array<{ id: string; count?: number }>) {
    if (layer.id in counts) layer.count = counts[layer.id]
  }
}

/**
 * The inspector, search palette and layer tables read `assets` (one record per pipe / valve /
 * hydrant, as the real BFF sends). The legacy fixture ships none, so derive them from the network.
 */
function addAssets(seed: Seed): void {
  const assets: unknown[] = []
  const pipes = seed.pipes as unknown as Array<{
    id: string
    code: string
    dn: number
    material: string
    year: number
    cond: string
    status: string
    lenM: number
    dma?: string
    pressure?: number
    trunk?: boolean
  }>
  for (const p of pipes) {
    assets.push({
      id: p.id,
      code: p.code,
      type: 'pipe',
      geom: 'line',
      name: `${p.trunk ? 'Ống chính' : 'Ống phân phối'} DN${p.dn} · ${p.id}`,
      dma: p.dma ?? '',
      cond: p.cond,
      status: p.status,
      attrs: {
        'Đường kính (DN)': p.dn,
        'Vật liệu': p.material,
        'Năm lắp đặt': p.year,
        'Chiều dài (m)': p.lenM,
        'Áp suất (bar)': Math.round((p.pressure ?? 0) * 10) / 10,
      },
      geomRef: p,
    })
  }
  for (const v of (seed.valves as Array<{ id: string; code: string; kind: string; state: string; dn: number; dma: string; year: number }>) ?? []) {
    assets.push({
      id: v.id,
      code: v.code,
      type: 'valve',
      geom: 'point',
      name: `Van ${v.kind === 'boundary' ? 'biên DMA' : 'khóa'} ${v.code}`,
      dma: v.dma,
      cond: 'good',
      status: v.state === 'closed' ? 'closed' : 'ok',
      attrs: { 'Đường kính (DN)': v.dn, 'Trạng thái': v.state === 'closed' ? 'Đóng' : 'Mở', 'Năm lắp đặt': v.year },
      geomRef: v,
    })
  }
  for (const h of (seed.hydrants as Array<{ id: string; code: string; dma: string; status: string }>) ?? []) {
    assets.push({
      id: h.id,
      code: h.code,
      type: 'hydrant',
      geom: 'point',
      name: `Trụ cứu hỏa ${h.code}`,
      dma: h.dma,
      cond: 'good',
      status: h.status,
      attrs: {},
      geomRef: h,
    })
  }
  seed.assets = assets
}
