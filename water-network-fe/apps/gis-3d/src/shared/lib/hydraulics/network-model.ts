/* Hydraulic model of the GIS network for EPANET (epanet-js).
   Pure: GIS data in, EPANET INP text plus the id maps needed to read results back.

   What it models, from the plant to the customer:
   - the treatment plant's clear-water well (RESERVOIR) and high-lift pumps (PUMP) into the trunk main
   - storage that floats on the network: the elevated tank, and the ground reservoir that fills at night
     through a flow-control valve and pumps back into the network by day
   - booster pumps, DMA-inlet pressure-reducing valves, check valves at pump discharge
   - closed DMA-boundary valves; planned / abandoned pipes left out
   - customer demand at the node each connection sits on (diurnal pattern), leakage per km of main
     (higher on old cast iron), and leak events (burst / background leak)
   Node elevations come from the GIS nodes; pipe roughness from the material. */

export type Pt = [number, number]

export interface ModelPipe {
  id: string
  dn: number
  lenM?: number
  material?: string
  status?: string
  year?: number
  noFlow?: boolean
  pts: readonly Pt[] | [[number, number], [number, number]]
  vertices?: readonly Pt[]
  from?: string
  to?: string
  dma?: string
  /** Street-class size before network sizing; mains are ≥ 400. */
  baseDn?: number
}
export interface ModelInput {
  pipes: ModelPipe[]
  connDots: ReadonlyArray<{ x: number; y: number }>
  plant: { x?: number; y?: number }
  nodes?: ReadonlyArray<{ id: string; x: number; y: number; z?: number }>
  valves?: ReadonlyArray<{ id: string; pipe: string; kind: string; state?: string; x: number; y: number; dma?: string }>
  reservoirs?: ReadonlyArray<{ id: string; x: number; y: number; cap?: number }>
  pumps?: ReadonlyArray<{ id: string; x: number; y: number; dma?: string }>
  sourceDevices?: ReadonlyArray<{ id: string; deviceType: string; x: number; y: number; hostPipeId?: string; hostNodeId?: string; dma?: string }>
  dmas?: ReadonlyArray<{ id: string; poly: readonly Pt[] }>
}

export interface LeakEvent {
  kind: 'burst' | 'background'
  nodeId: string
  lps: number
  /** Burst starts at this hour (0–24); background leaks run all day. */
  fromHour?: number
}

export interface ModelOptions {
  /** Average demand per customer connection (L/s). */
  demandLps?: number
  /** Background leakage per km of pipe (L/s); ×2.5 on grey cast iron, ×1.5 on pipes older than 1995. */
  leakLpsPerKm?: number
  /** Plant high-lift pump head at design flow (m). */
  plantPumpHeadM?: number
  /** Pressure downstream of DMA-inlet PRVs (m). */
  prvSettingM?: number
  /** Per-DMA PRV outlet pressure (m), overriding `prvSettingM` — set so each DMA's critical point keeps its service pressure. */
  prvSettings?: Record<string, number>
  /** Solve one snapshot at this hour instead of a 24 h extended-period run. */
  snapshotHour?: number
  /** Tank levels (m) for a snapshot, by tank id (default: their initial level). */
  tankLevels?: Record<string, number>
  events?: LeakEvent[]
  /**
   * Flow sign per GIS pipe (+1 along the drawn line, -1 against) from a run without PRVs, check valves
   * and boosters. When given, those devices are added and oriented with the flow; without it they are
   * left out. `solveHydraulics` / `runExtendedPeriod` do the two passes.
   */
  orientation?: Map<string, 1 | -1>
  /**
   * Storage settings found from a first run: an elevated tank's floor elevation (so it floats on the
   * network's hydraulic grade line), a ground reservoir's pump head (to lift water back into it).
   */
  storage?: Record<string, { floorM?: number; pumpHeadM?: number; fillLps?: number }>
}

/** Residential + commercial diurnal demand for a Vietnamese city, hourly multipliers (mean 1). */
export const DEMAND_PATTERN = normalise([
  0.45, 0.38, 0.34, 0.33, 0.38, 0.62, 1.25, 1.55, 1.32, 1.12, 1.05, 1.12,
  1.18, 1.0, 0.92, 0.95, 1.08, 1.32, 1.52, 1.45, 1.22, 0.98, 0.75, 0.58,
])
/** Leakage follows pressure: a little higher at night when the network is fuller. */
export const LEAK_PATTERN = DEMAND_PATTERN.map(m => Math.round((1.15 - 0.15 * m) * 1000) / 1000)

/** Ground reservoir: day pumping rate and night fill rate (17 h × pump = 7 h × fill). */
export const GROUND_PUMP_LPS = 60
/** The ground reservoir pumps into the network over the two demand peaks and refills overnight. */
export const GROUND_PUMP_HOURS: Array<[number, number]> = [[6, 10], [17, 21]]
export const GROUND_FILL_HOURS: [number, number] = [22, 5]
const pumpHours = GROUND_PUMP_HOURS.reduce((a, [s, e]) => a + e - s, 0)
const fillHours = (GROUND_FILL_HOURS[1] + 24 - GROUND_FILL_HOURS[0]) % 24
const GROUND_FILL_LPS = Math.round((GROUND_PUMP_LPS * pumpHours) / fillHours)
const groundPumpOn = (h: number) => GROUND_PUMP_HOURS.some(([s, e]) => h >= s && h < e)
const groundFillOn = (h: number) => h >= GROUND_FILL_HOURS[0] || h < GROUND_FILL_HOURS[1]
const clock = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`

const ROUGHNESS: Record<string, number> = { 'Gang dẻo': 130, HDPE: 145, uPVC: 145, Thép: 120, 'Gang xám': 95 }
/** Hazen-Williams C for a pipe material. */
export const roughness = (material?: string) => ROUGHNESS[material ?? ''] ?? 120
const U2M = 1.15

export interface NetworkModel {
  inp: string
  /** GIS pipe id → EPANET link carrying its flow (first segment) and whether the link runs against the drawn line. */
  pipeLinks: Map<string, { link: string; flip: boolean }>
  /** EPANET junction id for each GIS pipe end (drawn start / end). */
  pipeEnds: Map<string, { a: string; b: string }>
  /** Junctions that carry customer demand. */
  demandNodes: Set<string>
  /** Customer demand (L/s, average) per junction. */
  customerLps: Map<string, number>
  /** Background leakage (L/s, average) per junction. */
  leakLps: Map<string, number>
  plant: { reservoir: string; pump: string; node: string } | null
  tanks: Array<{ id: string; node: string; kind: 'elevated' | 'ground'; maxLevel: number; initLevel: number; diameter: number }>
  /** Junction coordinates (pixel plane) and elevation. */
  junctions: Map<string, { x: number; y: number; z: number }>
  /** Pipes left out (planned, abandoned, degenerate) and junctions not connected to any source. */
  excluded: { pipes: string[]; unsuppliedNodes: string[] }
  /** Average total demand the model draws (customers + leakage + events), L/s. */
  averageDemandLps: number
}

function normalise(xs: number[]): number[] {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return xs.map(x => Math.round((x / m) * 1000) / 1000)
}
const polylineOf = (p: ModelPipe): readonly Pt[] => (p.vertices && p.vertices.length >= 2 ? p.vertices : (p.pts as readonly Pt[]))
const polyLenPx = (pts: readonly Pt[]) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) : s), 0)
const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '0')

function inPoly(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) inside = !inside
  }
  return inside
}

/** Fraction (0..1) along a polyline of the point nearest to `p`. */
export function fractionAlong(pts: readonly Pt[], p: { x: number; y: number }): number {
  const total = polyLenPx(pts) || 1
  let acc = 0
  let best = 0
  let bestD = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const k = l ? Math.max(0, Math.min(1, ((p.x - a[0]) * (b[0] - a[0]) + (p.y - a[1]) * (b[1] - a[1])) / (l * l))) : 0
    const d = Math.hypot(p.x - (a[0] + k * (b[0] - a[0])), p.y - (a[1] + k * (b[1] - a[1])))
    if (d < bestD) {
      bestD = d
      best = (acc + k * l) / total
    }
    acc += l
  }
  return best
}

export function buildNetworkModel(input: ModelInput, opts: ModelOptions = {}): NetworkModel {
  const { demandLps = 0.12, leakLpsPerKm = 0.18, plantPumpHeadM = 48, prvSettingM = 32, snapshotHour } = opts
  const snapshot = snapshotHour !== undefined
  const hour = snapshot ? Math.floor(((snapshotHour % 24) + 24) % 24) : 0

  // ── junctions: GIS nodes when the pipes reference them, else snapped pipe ends ──
  const junctions = new Map<string, { x: number; y: number; z: number }>()
  const gisNodes = new Map((input.nodes ?? []).map(n => [n.id, n]))
  const snapKey = (p: Pt) => `${Math.round(p[0] / 3)},${Math.round(p[1] / 3)}`
  const snapped = new Map<string, string>()
  const junctionAt = (p: Pt, ref?: string): string => {
    if (ref) {
      const n = gisNodes.get(ref)
      if (n) {
        if (!junctions.has(n.id)) junctions.set(n.id, { x: n.x, y: n.y, z: n.z ?? 10 })
        return n.id
      }
    }
    const k = snapKey(p)
    let id = snapped.get(k)
    if (!id) {
      id = `J${snapped.size + 1}`
      snapped.set(k, id)
      junctions.set(id, { x: p[0], y: p[1], z: 10 })
    }
    return id
  }

  interface Link { id: string; kind: 'pipe' | 'pump' | 'prv' | 'fcv'; a: string; b: string; len?: number; dn?: number; c?: number; status?: 'Closed' | 'CV'; setting?: number; curve?: string }
  const links: Link[] = []
  const pipeLinks = new Map<string, { link: string; flip: boolean }>()
  const pipeEnds = new Map<string, { a: string; b: string }>()
  const excludedPipes: string[] = []
  const pipeById = new Map<string, ModelPipe>()
  const linkOfPipe = new Map<string, Link>()

  for (const p of input.pipes) {
    const pts = polylineOf(p)
    if (p.status === 'planned' || p.status === 'abandoned' || pts.length < 2) {
      excludedPipes.push(p.id)
      continue
    }
    const a = junctionAt(pts[0]!, p.from)
    const b = junctionAt(pts[pts.length - 1]!, p.to)
    if (a === b) {
      excludedPipes.push(p.id)
      continue
    }
    const link: Link = {
      id: p.id, kind: 'pipe', a, b,
      len: Math.max(p.lenM ?? polyLenPx(pts) * U2M, 1),
      dn: Math.max(p.dn, 25),
      c: roughness(p.material),
      status: p.noFlow ? 'Closed' : undefined,
    }
    links.push(link)
    linkOfPipe.set(p.id, link)
    pipeById.set(p.id, p)
    pipeLinks.set(p.id, { link: p.id, flip: false })
    pipeEnds.set(p.id, { a, b })
  }

  const nearestJunction = (x: number, y: number, filter?: (id: string) => boolean): string | null => {
    let best: string | null = null
    let bestD = Infinity
    for (const [id, j] of junctions) {
      if (filter && !filter(id)) continue
      const d = (j.x - x) ** 2 + (j.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }
  const incident = new Map<string, Link[]>()
  const index = () => {
    incident.clear()
    for (const l of links) for (const n of [l.a, l.b]) (incident.get(n) ?? incident.set(n, []).get(n)!).push(l)
  }
  index()

  /** Split a pipe at fraction `t`, inserting a link between the two new nodes; returns the [upstream, downstream] node ids. */
  const splitPipe = (pipeId: string, t: number, tag: string): { near: string; far: string; seg1: Link; seg2: Link } | null => {
    const link = linkOfPipe.get(pipeId)
    const pipe = pipeById.get(pipeId)
    if (!link || !pipe || link.kind !== 'pipe' || link.id !== pipeId || links.some(l => l.id === `${pipeId}~2`)) return null
    const pts = polylineOf(pipe)
    const total = polyLenPx(pts)
    let target = total * Math.min(Math.max(t, 0.05), 0.95)
    let at: Pt = pts[0]!
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (target <= l) {
        const k = l ? target / l : 0
        at = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
        break
      }
      target -= l
    }
    const za = junctions.get(link.a)!.z
    const zb = junctions.get(link.b)!.z
    const z = za + (zb - za) * t
    const n1 = `${tag}-1`
    const n2 = `${tag}-2`
    junctions.set(n1, { x: at[0], y: at[1], z })
    junctions.set(n2, { x: at[0], y: at[1], z })
    const len = link.len!
    const seg2: Link = { ...link, id: `${pipeId}~2`, a: n2, b: link.b, len: Math.max(len * (1 - t), 1) }
    link.b = n1
    link.len = Math.max(len * t, 1)
    links.push(seg2)
    return { near: n1, far: n2, seg1: link, seg2 }
  }

  const dmaPoly = (id?: string) => input.dmas?.find(d => d.id === id)?.poly
  const pumpCurves: string[] = []
  const curve = (id: string, q: number, h: number) => {
    pumpCurves.push(` ${id}\t${fmt(q, 1)}\t${fmt(h, 1)}`)
    return id
  }

  // ── DMA-inlet pressure-reducing valves (valves of kind prv, and PRV stations) ──
  const prvs = [
    ...(input.valves ?? []).filter(v => v.kind === 'prv').map(v => ({ id: v.id, pipe: v.pipe, x: v.x, y: v.y, dma: v.dma })),
    ...(input.sourceDevices ?? []).filter(d => d.deviceType === 'PRVStation' && d.hostPipeId).map(d => ({ id: d.id, pipe: d.hostPipeId!, x: d.x, y: d.y, dma: d.dma })),
  ]
  const orient = opts.orientation
  for (const v of orient ? prvs : []) {
    const pipe = pipeById.get(v.pipe)
    const sign = orient!.get(v.pipe)
    if (!pipe || pipe.noFlow || !sign) continue
    const pts = polylineOf(pipe)
    const t = fractionAlong(pts, v)
    const s = splitPipe(v.pipe, t, v.id)
    if (!s) continue
    // a PRV only passes flow one way: orient it with the flow found without it
    const setting = (v.dma && opts.prvSettings?.[v.dma]) || prvSettingM
    links.push(sign > 0
      ? { id: v.id, kind: 'prv', a: s.near, b: s.far, dn: pipe.dn, setting }
      : { id: v.id, kind: 'prv', a: s.far, b: s.near, dn: pipe.dn, setting })
  }

  // ── check valves at pump discharge: the pipe only flows away from the pump ──
  for (const v of orient ? (input.valves ?? []).filter(x => x.kind === 'check') : []) {
    const link = linkOfPipe.get(v.pipe)
    const pipe = pipeById.get(v.pipe)
    const sign = orient!.get(v.pipe)
    if (!link || !pipe || !sign) continue
    // the check valve lets the pipe flow only the way it already flows (away from the pump)
    if (sign < 0) {
      const tmp = link.a
      link.a = link.b
      link.b = tmp
      pipeLinks.set(v.pipe, { link: link.id, flip: true })
    }
    if (link.status !== 'Closed') link.status = 'CV'
  }
  index()

  // ── demand: customers at the nearest distribution node, leakage along every pipe, events ──
  const customerLps = new Map<string, number>()
  const leakLps = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  const distribution = new Set<string>()
  for (const l of links) if (l.kind === 'pipe' && (l.dn ?? 0) <= 200) {
    distribution.add(l.a)
    distribution.add(l.b)
  }
  // grid for nearest-node lookups
  const CELL = 60
  const grid = new Map<string, string[]>()
  for (const [id, j] of junctions) {
    if (!distribution.has(id)) continue
    const k = `${Math.floor(j.x / CELL)},${Math.floor(j.y / CELL)}`
    ;(grid.get(k) ?? grid.set(k, []).get(k)!).push(id)
  }
  const nearestDistribution = (x: number, y: number): string | null => {
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    for (let r = 1; r <= 6; r++) {
      let best: string | null = null
      let bestD = Infinity
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const j = junctions.get(id)!
            const d = (j.x - x) ** 2 + (j.y - y) ** 2
            if (d < bestD) {
              bestD = d
              best = id
            }
          }
      if (best) return best
    }
    return nearestJunction(x, y)
  }
  for (const c of input.connDots) {
    const n = nearestDistribution(c.x, c.y)
    if (n) add(customerLps, n, demandLps)
  }
  for (const l of links) {
    if (l.kind !== 'pipe') continue
    const pipe = pipeById.get(l.id.replace(/~2$/, ''))
    const factor = (pipe?.material === 'Gang xám' ? 2.5 : 1) * ((pipe?.year ?? 2010) < 1995 ? 1.5 : 1)
    const q = ((l.len ?? 0) / 1000) * leakLpsPerKm * factor
    add(leakLps, l.a, q / 2)
    add(leakLps, l.b, q / 2)
  }

  // ── sources ──
  const reservoirsSec: string[] = []
  const tanksSec: string[] = []
  const tanks: NetworkModel['tanks'] = []
  let plant: NetworkModel['plant'] = null
  // the plant is designed for the healthy network: a leak must not change the pumps
  const avgDemand = () => [...customerLps.values(), ...leakLps.values()].reduce((s, x) => s + x, 0)
  // junctions on the transmission mains (outside the DMAs)
  const trunk = new Set<string>()
  for (const p of input.pipes) if ((p.baseDn ?? p.dn) >= 400 && pipeEnds.has(p.id) && !p.noFlow) {
    trunk.add(pipeEnds.get(p.id)!.a)
    trunk.add(pipeEnds.get(p.id)!.b)
  }

  if (typeof input.plant.x === 'number' && typeof input.plant.y === 'number') {
    // the plant feeds the trunk: connect to the junction on the largest pipe near it
    const big = new Set<string>()
    for (const l of links) if (l.kind === 'pipe' && (l.dn ?? 0) >= 300) {
      big.add(l.a)
      big.add(l.b)
    }
    const node = nearestJunction(input.plant.x, input.plant.y, big.size ? id => big.has(id) : undefined)
    if (node) {
      const z = junctions.get(node)!.z
      reservoirsSec.push(` PLANT\t${fmt(z + 2, 2)}`)
      const design = avgDemand() * 1.7
      links.push({ id: 'PLANT-PUMP', kind: 'pump', a: 'PLANT', b: node, curve: curve('PLANT-PUMP', design, plantPumpHeadM) })
      plant = { reservoir: 'PLANT', pump: 'PLANT-PUMP', node }
    }
  }
  // ground reservoir: on the transmission main, fills from it at night through an FCV, pumps back by day
  for (const r of input.reservoirs ?? []) {
    const node = nearestJunction(r.x, r.y, trunk.size ? id => trunk.has(id) : undefined)
    if (!node) continue
    const z = junctions.get(node)!.z
    const maxLevel = 5
    const diameter = Math.round(Math.sqrt(((r.cap ?? 20000) / maxLevel) * (4 / Math.PI)))
    const level = opts.tankLevels?.[r.id] ?? 2.5
    tanksSec.push(` ${r.id}\t${fmt(z, 2)}\t${fmt(level, 2)}\t0.5\t${maxLevel}\t${diameter}\t0`)
    tanks.push({ id: r.id, node, kind: 'ground', maxLevel, initLevel: level, diameter })
    const pumpOn = snapshot ? groundPumpOn(hour) : false
    const fillOn = snapshot ? groundFillOn(hour) : true
    const fill = Math.round(opts.storage?.[r.id]?.fillLps ?? GROUND_FILL_LPS)
    // EPANET does not allow a control valve straight onto a tank: FCV → inlet junction → short pipe → tank
    const inlet = `${r.id}-IN`
    junctions.set(inlet, { ...junctions.get(node)! })
    // refills overnight at the rate that puts back what the peak pumping drew out
    links.push({ id: `${r.id}-FILL`, kind: 'fcv', a: node, b: inlet, dn: 300, setting: fill, status: fillOn ? undefined : 'Closed' })
    links.push({ id: `${r.id}-INLET`, kind: 'pipe', a: inlet, b: r.id, len: 20, dn: 300, c: 120 })
    const head = opts.storage?.[r.id]?.pumpHeadM ?? 45
    links.push({ id: `${r.id}-PUMP`, kind: 'pump', a: r.id, b: node, curve: curve(`${r.id}-PUMP`, GROUND_PUMP_LPS, head), status: pumpOn ? undefined : 'Closed' })
  }
  // elevated tanks float on the network
  for (const d of (input.sourceDevices ?? []).filter(x => x.deviceType === 'Tank')) {
    const node = (d.hostNodeId && junctions.has(d.hostNodeId) ? d.hostNodeId : null) ?? nearestJunction(d.x, d.y)
    if (!node) continue
    const z = junctions.get(node)!.z
    const level = opts.tankLevels?.[d.id] ?? 4.5
    const floor = opts.storage?.[d.id]?.floorM ?? z + 24
    tanksSec.push(` ${d.id}\t${fmt(floor, 2)}\t${fmt(level, 2)}\t1\t8\t16\t0`)
    tanks.push({ id: d.id, node, kind: 'elevated', maxLevel: 8, initLevel: level, diameter: 16 })
    links.push({ id: `${d.id}-RISER`, kind: 'pipe', a: node, b: d.id, len: 40, dn: 300, c: 120 })
  }
  // booster pumps: in line on the pipe heading into the DMA they serve
  const boosters = [
    ...(input.pumps ?? []).map(p => ({ id: p.id, x: p.x, y: p.y, dma: p.dma, node: undefined as string | undefined })),
    ...(input.sourceDevices ?? []).filter(d => d.deviceType === 'BoosterStation').map(d => ({ id: d.id, x: d.x, y: d.y, dma: d.dma, node: d.hostNodeId })),
  ]
  for (const b of orient ? boosters : []) {
    const node = (b.node && junctions.has(b.node) ? b.node : null) ?? nearestJunction(b.x, b.y)
    if (!node) continue
    const poly = dmaPoly(b.dma)
    const around = (incident.get(node) ?? []).filter(l => l.kind === 'pipe' && l.status !== 'Closed')
    const other = (l: Link) => junctions.get(l.a === node ? l.b : l.a)!
    // the booster sits on the pipe that carries water away from its site (towards the DMA it serves)
    const outflow = (l: Link) => {
      const sign = orient!.get(l.id.replace(/~2$/, ''))
      if (!sign) return false
      const forward = sign > 0 !== (pipeLinks.get(l.id)?.flip ?? false)
      return (l.a === node) === forward
    }
    const into = around
      .filter(outflow)
      .map(l => ({ l, score: (poly && inPoly([other(l).x, other(l).y], poly) ? 1000 : 0) + (l.dn ?? 0) }))
      .sort((x, y) => y.score - x.score)[0]?.l
    if (!into) continue
    const j = junctions.get(node)!
    const out = `${b.id}-OUT`
    junctions.set(out, { ...j })
    if (into.a === node) into.a = out
    else into.b = out
    links.push({ id: `${b.id}-PUMP`, kind: 'pump', a: node, b: out, curve: curve(`${b.id}-PUMP`, 70, 14) })
    index()
  }

  // ── keep only what a source can reach (closed links do not count) ──
  const sourcesNodes = new Set<string>([...(plant ? [plant.node] : []), ...tanks.map(t => t.node)])
  const reach = new Set<string>()
  const adj = new Map<string, string[]>()
  for (const l of links) {
    if (l.status === 'Closed' && l.kind === 'pipe') continue
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]] as const) (adj.get(x) ?? adj.set(x, []).get(x)!).push(y)
  }
  const queue = [...sourcesNodes]
  for (const s of queue) reach.add(s)
  while (queue.length) {
    const n = queue.pop()!
    for (const m of adj.get(n) ?? []) if (!reach.has(m)) {
      reach.add(m)
      queue.push(m)
    }
  }
  const tankIds = new Set(tanks.map(t => t.id))
  const unsupplied = [...junctions.keys()].filter(id => !reach.has(id))
  const isJunction = (id: string) => junctions.has(id)
  const live = (l: Link) => (isJunction(l.a) ? reach.has(l.a) : true) && (isJunction(l.b) ? reach.has(l.b) : true)
  const modelLinks = links.filter(live)
  for (const id of unsupplied) {
    customerLps.delete(id)
    leakLps.delete(id)
  }

  // ── INP ──
  const events = (opts.events ?? []).filter(e => reach.has(e.nodeId))
  let inp = '[TITLE]\nGIS network: plant to customer\n\n[JUNCTIONS]\n'
  for (const [id, j] of junctions) if (reach.has(id) && !tankIds.has(id)) inp += ` ${id}\t${fmt(j.z, 2)}\t0\n`
  inp += '\n[RESERVOIRS]\n' + reservoirsSec.join('\n') + '\n\n[TANKS]\n' + tanksSec.join('\n') + '\n\n[PIPES]\n'
  for (const l of modelLinks.filter(x => x.kind === 'pipe'))
    inp += ` ${l.id}\t${l.a}\t${l.b}\t${fmt(l.len!, 1)}\t${l.dn}\t${l.c}\t0\t${l.status === 'CV' ? 'CV' : 'Open'}\n`
  inp += '\n[PUMPS]\n'
  for (const l of modelLinks.filter(x => x.kind === 'pump')) inp += ` ${l.id}\t${l.a}\t${l.b}\tHEAD ${l.curve}\n`
  inp += '\n[VALVES]\n'
  for (const l of modelLinks.filter(x => x.kind === 'prv' || x.kind === 'fcv'))
    inp += ` ${l.id}\t${l.a}\t${l.b}\t${l.dn}\t${l.kind.toUpperCase()}\t${fmt(l.setting!, 1)}\t0\n`
  inp += '\n[STATUS]\n'
  for (const l of modelLinks) if (l.status === 'Closed') inp += ` ${l.id}\tClosed\n`
  inp += '\n[DEMANDS]\n'
  for (const [n, q] of customerLps) inp += ` ${n}\t${fmt(q, 4)}\tDIURNAL\n`
  for (const [n, q] of leakLps) if (q > 0) inp += ` ${n}\t${fmt(q, 4)}\tLEAK\n`
  events.forEach((e, i) => (inp += ` ${e.nodeId}\t${fmt(e.lps, 3)}\t${e.kind === 'burst' ? `EV${i}` : 'LEAK'}\n`))
  inp += '\n[PATTERNS]\n'
  inp += ` DIURNAL\t${DEMAND_PATTERN.join('\t')}\n LEAK\t${LEAK_PATTERN.join('\t')}\n`
  events.forEach((e, i) => {
    if (e.kind === 'burst') inp += ` EV${i}\t${Array.from({ length: 24 }, (_, h) => (h >= (e.fromHour ?? 0) ? 1 : 0)).join('\t')}\n`
  })
  inp += '\n[CURVES]\n' + pumpCurves.join('\n') + '\n\n[CONTROLS]\n'
  if (!snapshot)
    for (const t of tanks.filter(x => x.kind === 'ground')) {
      for (const [s, e] of GROUND_PUMP_HOURS) inp += ` LINK ${t.id}-PUMP OPEN AT CLOCKTIME ${clock(s)}\n LINK ${t.id}-PUMP CLOSED AT CLOCKTIME ${clock(e)}\n`
      const fill = Math.round(opts.storage?.[t.id]?.fillLps ?? GROUND_FILL_LPS)
      inp += ` LINK ${t.id}-FILL CLOSED AT CLOCKTIME ${clock(GROUND_FILL_HOURS[1])}\n LINK ${t.id}-FILL ${fill} AT CLOCKTIME ${clock(GROUND_FILL_HOURS[0])}\n`
    }
  inp += '\n[OPTIONS]\n Units\tLPS\n Headloss\tH-W\n Accuracy\t0.001\n Trials\t200\n Unbalanced\tContinue 20\n'
  inp += snapshot
    ? `\n[TIMES]\n Duration\t0\n Pattern Timestep\t1:00\n Pattern Start\t${hour}:00\n Start ClockTime\t${hour}:00\n\n[END]\n`
    : '\n[TIMES]\n Duration\t24:00\n Hydraulic Timestep\t0:15\n Pattern Timestep\t1:00\n Report Timestep\t0:15\n Start ClockTime\t12 AM\n\n[END]\n'

  for (const id of excludedPipes) pipeLinks.delete(id)
  for (const [pid, m] of pipeLinks) if (!modelLinks.some(l => l.id === m.link)) pipeLinks.delete(pid)

  return {
    inp,
    pipeLinks,
    pipeEnds,
    demandNodes: new Set(customerLps.keys()),
    customerLps,
    leakLps,
    plant,
    tanks,
    junctions,
    excluded: { pipes: excludedPipes, unsuppliedNodes: unsupplied },
    averageDemandLps: [...customerLps.values(), ...leakLps.values()].reduce((s, x) => s + x, 0) +
      events.reduce((s, e) => s + e.lps * (e.kind === 'burst' ? (24 - (e.fromHour ?? 0)) / 24 : 1), 0),
  }
}
