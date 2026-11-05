/**
 * Demo network completeness: turns the generated pipes into a connected network that carries
 * every component in the catalog (@wn/component-models), so the map, inspector and 3D view
 * have real examples of each.
 *
 * - Nodes at every pipe end (tee, cross, bend, reducer, transition, cap…), with elevations, and
 *   every pipe's `from` / `to` pointing at them.
 * - Valve kinds by engineering rule: butterfly on large mains, PRV at DMA inlets, air valves at
 *   high points, washouts at dead ends and low points, check valves at pump discharge.
 * - Network devices (`sourceDevices`, `deviceType` = catalog code): DMA inlet chambers with bulk
 *   meter, strainer and dismantling joint; pressure loggers at inlets, critical and high points;
 *   level and quality sensors, RTUs, acoustic loggers, re-chlorination, sampling points, tank,
 *   booster and PRV station, service taps, repair clamps…
 * - 24 h telemetry (15 min) for every pressure logger, bulk meter and level sensor.
 *
 * Everything is deterministic (seeded from ids), so the demo looks the same on every load.
 */

type Pt = [number, number]

interface P {
  id: string
  dn: number
  dma?: string
  material?: string
  status?: string
  trunk?: boolean
  pressure?: number
  lenM?: number
  from?: string
  to?: string
  pts: Pt[]
}
interface Valve { id: string; code: string; pipe: string; dn: number; kind: string; state: string; dma: string; year: number; x: number; y: number }
export interface DemoNode { id: string; code: string; i: number; j: number; z: number; kind: string; x: number; y: number; dn: number; dn2?: number; material?: string; bearing: number; pipes: string[]; dma: string }
export interface DemoDevice {
  id: string
  code: string
  name: string
  deviceType: string
  status: 'normal' | 'warning' | 'critical' | 'offline'
  x: number
  y: number
  dn?: number
  bearing?: number
  hostPipeId?: string
  hostNodeId?: string
  dma: string
}
export interface Telemetry { unit: string; intervalMin: number; start: string; values: number[]; low?: number; high?: number }

interface Seed {
  pipes: P[]
  pipeBy: Record<string, P>
  valves?: Valve[]
  hydrants?: Array<{ id: string; status: string; x: number; y: number }>
  nodes?: unknown[]
  sourceDevices?: unknown[]
  connDots?: Array<{ x: number; y: number; dma: string }>
  connections?: unknown[]
  reservoirs: Array<{ id: string; x: number; y: number; dma?: string }>
  pumps: Array<{ id: string; x: number; y: number; dma?: string }>
  plant: { id?: string; x?: number; y?: number }
  dmas: Array<{ id: string; name?: string; poly: Pt[] }>
  TODAY?: string
  [k: string]: unknown
}

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}
const pad = (n: number, w = 4) => String(n).padStart(w, '0')
const lenPx = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0)
/** Compass bearing (deg clockwise from north) of a → b on the pixel plane (x east, y south). */
const bearingOf = (a: Pt, b: Pt) => ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360
/** Gently rolling ground: Hanoi is flat, 5–16 m above sea level. */
export const elevationAt = (x: number, y: number) =>
  Math.round((9 + 3.2 * Math.sin(x / 900) + 2.4 * Math.cos(y / 700) + 1.2 * Math.sin((x + y) / 330)) * 10) / 10

/** Point and segment bearing at a fraction `t` (0..1) along a polyline. */
function along(pts: Pt[], t: number): { p: Pt; bearing: number } {
  const total = lenPx(pts)
  let target = total * Math.min(Math.max(t, 0), 1)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (target <= l || i === pts.length - 1) {
      const k = l ? Math.min(target / l, 1) : 0
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], bearing: bearingOf(a, b) }
    }
    target -= l
  }
  return { p: pts[0]!, bearing: 0 }
}
function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) inside = !inside
  }
  return inside
}

export function addNetworkDevices(seed: Seed): void {
  const pipes = seed.pipes
  const valves = (seed.valves ??= [])
  const devices: DemoDevice[] = []
  const dmaAt = (p: Pt, fallback = 'DMA-01') => seed.dmas.find((d) => inPoly(p, d.poly))?.id ?? fallback

  // ── 1. nodes at every pipe end, typed as the fitting that joins them ──
  const key = (p: Pt) => `${Math.round(p[0] / 3)},${Math.round(p[1] / 3)}`
  const ends = new Map<string, { at: Pt; list: Array<{ pipe: P; end: 'a' | 'b' }> }>()
  for (const pipe of pipes) {
    if (pipe.pts.length < 2) continue
    for (const end of ['a', 'b'] as const) {
      const at = end === 'a' ? pipe.pts[0]! : pipe.pts[pipe.pts.length - 1]!
      const k = key(at)
      const slot = ends.get(k) ?? ends.set(k, { at, list: [] }).get(k)!
      slot.list.push({ pipe, end })
    }
  }
  const sourcesPx: Pt[] = [
    ...(typeof seed.plant.x === 'number' && typeof seed.plant.y === 'number' ? [[seed.plant.x, seed.plant.y] as Pt] : []),
    ...seed.reservoirs.map((r) => [r.x, r.y] as Pt),
    ...seed.pumps.map((r) => [r.x, r.y] as Pt),
  ]
  const nearSource = (p: Pt) => sourcesPx.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < 40)
  /** Direction pointing away from the node along the pipe's first segment. */
  const outward = (pipe: P, end: 'a' | 'b'): number => {
    const n = pipe.pts.length
    return end === 'a' ? bearingOf(pipe.pts[0]!, pipe.pts[1]!) : bearingOf(pipe.pts[n - 1]!, pipe.pts[n - 2]!)
  }
  const nodes: DemoNode[] = []
  const nodeOfEnd = new Map<string, DemoNode>() // `${pipeId}:a|b`
  for (const { at, list } of ends.values()) {
    const dns = list.map((e) => e.pipe.dn)
    const mats = new Set(list.map((e) => e.pipe.material ?? ''))
    const maxDn = Math.max(...dns)
    const minDn = Math.min(...dns)
    let kind: string
    let bearing = outward(list[0]!.pipe, list[0]!.end)
    // a source (plant, reservoir, pump) connects through a plain junction node
    if (nearSource(at)) kind = 'Junction'
    else if (list.length === 1) kind = 'Cap'
    else if (list.length === 2) {
      const b1 = outward(list[0]!.pipe, list[0]!.end)
      const b2 = outward(list[1]!.pipe, list[1]!.end)
      const turn = Math.abs(((b1 - b2 + 540) % 360) - 180) // 0 = straight through
      if (maxDn !== minDn) kind = 'Reducer'
      else if (mats.size > 1) kind = 'Transition'
      else if (turn > 20) kind = 'Bend'
      else kind = 'Coupling'
      // run axis A→B: from the first pipe through the node into the second
      bearing = (b1 + 180) % 360
    } else if (list.length === 3) {
      kind = maxDn !== minDn ? 'ReducingTee' : 'Tee'
      // the run is the largest pipe; bearing along it
      const run = list.reduce((m, e) => (e.pipe.dn > m.pipe.dn ? e : m), list[0]!)
      bearing = (outward(run.pipe, run.end) + 180) % 360
    } else kind = 'Cross'
    const id = `N-${pad(nodes.length + 1)}`
    const node: DemoNode = {
      id, code: `N.${nodes.length + 1}`, i: 0, j: 0, z: elevationAt(at[0], at[1]), kind,
      x: at[0], y: at[1], dn: maxDn, ...(minDn !== maxDn ? { dn2: minDn } : {}),
      material: list[0]!.pipe.material, bearing: Math.round(bearing), pipes: list.map((e) => e.pipe.id),
      dma: list[0]!.pipe.dma ?? dmaAt(at),
    }
    nodes.push(node)
    for (const e of list) nodeOfEnd.set(`${e.pipe.id}:${e.end}`, node)
  }
  for (const pipe of pipes) {
    const a = nodeOfEnd.get(`${pipe.id}:a`)
    const b = nodeOfEnd.get(`${pipe.id}:b`)
    for (const copy of [pipe, seed.pipeBy[pipe.id]]) {
      if (!copy) continue
      if (a) copy.from = a.id
      if (b) copy.to = b.id
    }
  }
  seed.nodes = nodes

  // ── 2. valve kinds by rule ──
  const pipeById = new Map(pipes.map((p) => [p.id, p]))
  for (const v of valves) {
    const host = pipeById.get(v.pipe)
    const onBoundary = !!(host as unknown as { boundary?: boolean })?.boundary
    if (!onBoundary && v.dn >= 300) v.kind = 'butterfly'
    else if (v.kind === 'boundary' && !onBoundary) v.kind = 'isolation'
  }
  const addValve = (kind: string, pipe: P, t: number, state = 'open'): Valve => {
    const { p } = along(pipe.pts, t)
    const v: Valve = {
      id: `V-${valves.length + 1}`, code: `V.${valves.length + 1}`, pipe: pipe.id, dn: pipe.dn, kind, state,
      dma: pipe.dma ?? dmaAt(p), year: 2016 + Math.floor(hash01(pipe.id + kind) * 9), x: p[0], y: p[1],
    }
    valves.push(v)
    return v
  }

  // DMA inlets: the largest open pipe crossing from outside a DMA into it
  const inlets: Array<{ dma: string; pipe: P; inside: 'a' | 'b' }> = []
  for (const d of seed.dmas) {
    let best: { pipe: P; inside: 'a' | 'b' } | null = null
    for (const pipe of pipes) {
      if ((pipe as unknown as { noFlow?: boolean }).noFlow || pipe.pts.length < 2) continue
      const aIn = inPoly(pipe.pts[0]!, d.poly)
      const bIn = inPoly(pipe.pts[pipe.pts.length - 1]!, d.poly)
      if (aIn === bIn) continue
      if (!best || pipe.dn > best.pipe.dn) best = { pipe, inside: aIn ? 'a' : 'b' }
    }
    if (!best) {
      // fallback: the largest pipe inside the DMA
      const inside = pipes.filter((p) => inPoly(p.pts[0]!, d.poly)).sort((x, y) => y.dn - x.dn)[0]
      if (inside) best = { pipe: inside, inside: 'b' }
    }
    if (best) inlets.push({ dma: d.id, ...best })
  }

  const status = (id: string): DemoDevice['status'] => {
    const r = hash01(id + 'status')
    return r < 0.78 ? 'normal' : r < 0.9 ? 'warning' : r < 0.96 ? 'critical' : 'offline'
  }
  const addDevice = (deviceType: string, at: Pt, extra: Partial<DemoDevice> & { name: string }): DemoDevice => {
    const id = `D-${pad(devices.length + 1)}`
    const d: DemoDevice = {
      id, code: `${deviceType.replace(/[a-z]/g, '').slice(0, 4) || 'DV'}.${devices.length + 1}`,
      deviceType, status: status(id), x: at[0], y: at[1], dma: dmaAt(at), ...extra,
    }
    devices.push(d)
    return d
  }
  const onPipe = (deviceType: string, pipe: P, t: number, name: string, extra: Partial<DemoDevice> = {}) => {
    const { p, bearing } = along(pipe.pts, t)
    return addDevice(deviceType, p, { name, dn: pipe.dn, bearing: Math.round(bearing), hostPipeId: pipe.id, dma: pipe.dma ?? dmaAt(p), ...extra })
  }
  const atNode = (deviceType: string, node: DemoNode, name: string, offset: Pt = [0, 0], extra: Partial<DemoDevice> = {}) =>
    addDevice(deviceType, [node.x + offset[0], node.y + offset[1]], { name, dn: Math.min(node.dn, 200), bearing: node.bearing, hostNodeId: node.id, dma: node.dma, ...extra })

  // inlet chamber per DMA: PRV with strainer, bulk meter with dismantling joint, logger, quality, RTU
  inlets.forEach(({ dma, pipe, inside }, i) => {
    const t = (k: number) => (inside === 'b' ? k : 1 - k) // walk towards the DMA
    const dmaName = seed.dmas.find((d) => d.id === dma)?.name ?? dma
    if (i === 0) onPipe('PRVStation', pipe, t(0.45), `Trạm giảm áp ${dmaName}`)
    else addValve('prv', pipe, t(0.45))
    onPipe('Strainer', pipe, t(0.38), `Lọc Y cửa vào ${dma}`)
    onPipe('BulkMeter', pipe, t(0.6), `Đồng hồ tổng ${dma}`)
    onPipe('DismantlingJoint', pipe, t(0.66), `Khớp tháo lắp ĐHT ${dma}`)
    onPipe('PressureSensor', pipe, t(0.72), `Logger áp lực cửa vào ${dma}`, { dn: 15 })
    onPipe('QualitySensor', pipe, t(0.52), `Trạm đo clo dư ${dma}`, { dn: 15 })
    onPipe('RTU', pipe, t(0.56), `RTU cửa vào ${dma}`, { dn: 15 })
  })

  // pressure loggers at each DMA's critical point (lowest pressure) and highest node
  for (const d of seed.dmas) {
    const inDma = pipes.filter((p) => p.dma === d.id && p.pts.length >= 2)
    const critical = inDma.reduce<P | null>((m, p) => (!m || (p.pressure ?? 9) < (m.pressure ?? 9) ? p : m), null)
    if (critical) onPipe('PressureSensor', critical, 0.5, `Logger điểm bất lợi ${d.id}`, { dn: 15 })
    const high = nodes.filter((n) => n.dma === d.id).sort((a, b) => b.z - a.z)[0]
    if (high) atNode('PressureSensor', high, `Logger điểm cao ${d.id}`, [3, 3], { dn: 15 })
  }

  // air valves at local high points on mains, washouts at dead ends and low points
  const mainsNodes = nodes.filter((n) => n.dn >= 300 && n.kind !== 'Cap')
  mainsNodes
    .filter((n) => hash01(n.id + 'air') < 0.5)
    .sort((a, b) => b.z - a.z)
    .slice(0, 24)
    .forEach((n) => {
      const pipe = pipeById.get(n.pipes[0]!)
      if (pipe) addValve('air', pipe, pipe.from === n.id ? 0.02 : 0.98)
    })
  nodes
    .filter((n) => n.kind === 'Cap' && n.dn >= 100)
    .slice(0, 30)
    .forEach((n) => {
      const pipe = pipeById.get(n.pipes[0]!)
      if (pipe) addValve('washout', pipe, pipe.from === n.id ? 0.04 : 0.96)
    })
  mainsNodes
    .sort((a, b) => a.z - b.z)
    .slice(0, 10)
    .forEach((n) => {
      const pipe = pipeById.get(n.pipes[0]!)
      if (pipe) addValve('washout', pipe, pipe.from === n.id ? 0.03 : 0.97)
    })

  // sources: plant outlet, reservoir, pumps
  const nearestPipe = (p: Pt, minDn = 0): P | undefined => {
    let best: P | undefined
    let bestD = Infinity
    for (const pipe of pipes) {
      if (pipe.dn < minDn) continue
      for (const q of [pipe.pts[0]!, pipe.pts[pipe.pts.length - 1]!]) {
        const dd = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (dd < bestD) {
          bestD = dd
          best = pipe
        }
      }
    }
    return best
  }
  const startAt = (pipe: P, p: Pt) => {
    const a = pipe.pts[0]!
    const b = pipe.pts[pipe.pts.length - 1]!
    return Math.hypot(a[0] - p[0], a[1] - p[1]) <= Math.hypot(b[0] - p[0], b[1] - p[1])
  }
  if (typeof seed.plant.x === 'number' && typeof seed.plant.y === 'number') {
    const at: Pt = [seed.plant.x, seed.plant.y]
    const out = nearestPipe(at, 300)
    if (out) {
      const f = (k: number) => (startAt(out, at) ? k : 1 - k)
      onPipe('BulkMeter', out, f(0.2), 'Đồng hồ tổng đầu ra NMN Yên Phụ')
      onPipe('QualitySensor', out, f(0.12), 'Trạm đo chất lượng đầu ra NMN', { dn: 15 })
      onPipe('PressureSensor', out, f(0.28), 'Áp lực đầu ra NMN', { dn: 15 })
    }
    addDevice('RTU', [at[0] + 12, at[1] - 10], { name: 'RTU / SCADA NMN Yên Phụ', dn: 15 })
  }
  for (const r of seed.reservoirs) {
    const at: Pt = [r.x, r.y]
    addDevice('LevelSensor', [at[0] + 6, at[1] - 4], { name: `Cảm biến mực nước ${r.id}`, dn: 15 })
    addDevice('RTU', [at[0] - 10, at[1] + 8], { name: `RTU ${r.id}`, dn: 15 })
    const out = nearestPipe(at, 200)
    if (out) {
      const f = (k: number) => (startAt(out, at) ? k : 1 - k)
      onPipe('Pump', out, f(0.08), `Bơm cấp 2 ${r.id}`)
      onPipe('ChlorinationPoint', out, f(0.2), `Châm clo bổ sung ${r.id}`)
      addValve('fcv', out, f(0.3))
    }
  }
  seed.pumps.forEach((pump, i) => {
    const at: Pt = [pump.x, pump.y]
    const out = nearestPipe(at, 200)
    if (out) {
      const f = (k: number) => (startAt(out, at) ? k : 1 - k)
      addValve('check', out, f(0.1))
      if (i === 0) addValve('psv', out, f(0.22))
      onPipe('PressureSensor', out, f(0.3), `Áp lực xả ${pump.id}`, { dn: 15 })
    }
    addDevice('RTU', [at[0] + 9, at[1] + 9], { name: `RTU ${pump.id}`, dn: 15 })
  })

  // an elevated tank on the highest node, fed through an altitude valve; a local booster in the far DMA
  const top = nodes.filter((n) => n.dn >= 150 && n.kind !== 'Cap').sort((a, b) => b.z - a.z)[0]
  if (top) {
    atNode('Tank', top, 'Đài nước điều hòa', [30, -30], { dn: 300 })
    atNode('LevelSensor', top, 'Cảm biến mực nước đài', [33, -27], { dn: 15 })
    const feed = pipeById.get(top.pipes[0]!)
    if (feed) addValve('altitude', feed, feed.from === top.id ? 0.06 : 0.94)
  }
  const far = [...seed.dmas].reverse().find((d) => nodes.some((n) => n.dma === d.id))
  const farNode = far && nodes.filter((n) => n.dma === far.id && n.dn >= 150).sort((a, b) => b.z - a.z)[0]
  if (farNode) atNode('BoosterStation', farNode, `Trạm tăng áp cục bộ ${far.id}`, [22, 18], { dn: 150 })

  // trunk mains: expansion joints on the longest runs; repair clamps on old / leaking pipes
  pipes.filter((p) => p.dn >= 400).sort((a, b) => (b.lenM ?? 0) - (a.lenM ?? 0)).slice(0, 4)
    .forEach((p) => onPipe('ExpansionJoint', p, 0.5, `Khớp co giãn ${p.id}`))
  // old / leaking pipes: repair clamps on small breaks, couplings where a section was cut in
  pipes.filter((p) => p.status === 'leak' || (p.material === 'Gang xám' && hash01(p.id + 'clamp') < 0.15)).slice(0, 24)
    .forEach((p, k) =>
      k % 3 === 2
        ? onPipe('Coupling', p, 0.35 + hash01(p.id) * 0.3, `Măng sông sửa chữa ${p.id}`)
        : onPipe('RepairClamp', p, 0.35 + hash01(p.id) * 0.3, `Đai sửa chữa ${p.id}`),
    )

  // acoustic loggers on valves, two per DMA
  for (const d of seed.dmas) {
    valves.filter((v) => v.dma === d.id && v.kind !== 'air' && v.kind !== 'washout').slice(0, 2)
      .forEach((v) => addDevice('AcousticLogger', [v.x + 2, v.y - 2], { name: `Logger âm thanh ${v.code}`, dn: 15, hostPipeId: v.pipe, dma: v.dma }))
  }

  // ── 3. customer services: connections, taps, curb stops, backflow on industrial users ──
  const dots = seed.connDots ?? []
  const types = ['sh', 'sh', 'sh', 'sh', 'kd', 'kd', 'hcsn', 'sx']
  const streets = ['Kim Mã', 'Giảng Võ', 'Láng Hạ', 'Thái Hà', 'Tôn Đức Thắng', 'Nguyễn Chí Thanh', 'Đội Cấn', 'Hàng Bông']
  const connections = dots.filter((_, k) => k % 6 === 0).slice(0, 450).map((c, k) => {
    const type = types[k % types.length]!
    const dn = type === 'sx' ? 50 : type === 'kd' ? 25 : type === 'hcsn' ? 32 : 15
    const s = hash01(`c${k}`)
    return {
      id: `KH-${pad(k + 1, 5)}`, name: `Khách hàng ${k + 1}`, danhbo: `DB${pad(10000 + k * 7, 6)}`,
      addr: `${1 + Math.floor(s * 220)} ${streets[k % streets.length]}`, dma: c.dma, type, x: c.x, y: c.y,
      meter: `${type === 'sx' ? 'Woltmann' : 'Cơ'} DN${dn}`, dn, status: s < 0.92 ? 'active' : s < 0.97 ? 'suspended' : 'faulty',
      geocoded: s < 0.85, gpsRtk: s < 0.3,
    }
  })
  seed.connections = connections
  const nearestPipeTo = (p: Pt, maxDn = Infinity): { pipe: P; t: number } | undefined => {
    let best: { pipe: P; t: number } | undefined
    let bestD = Infinity
    for (const pipe of pipes) {
      if (pipe.dn > maxDn) continue
      const total = lenPx(pipe.pts) || 1
      let acc = 0
      for (let i = 1; i < pipe.pts.length; i++) {
        const a = pipe.pts[i - 1]!
        const b = pipe.pts[i]!
        const l = Math.hypot(b[0] - a[0], b[1] - a[1])
        const k = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l))) : 0
        const d = Math.hypot(p[0] - (a[0] + k * (b[0] - a[0])), p[1] - (a[1] + k * (b[1] - a[1])))
        if (d < bestD) {
          bestD = d
          best = { pipe, t: (acc + k * l) / total }
        }
        acc += l
      }
    }
    return bestD < 15 ? best : undefined
  }
  connections.filter((c) => c.type !== 'sh').slice(0, 60).forEach((c, k) => {
    const host = nearestPipeTo([c.x, c.y], 300)
    if (!host) return
    if (k % 3 === 0) onPipe('TappingSaddle', host.pipe, host.t, `Đai khởi thủy ${c.id}`)
    onPipe('ServiceConnection', host.pipe, host.t, `Đấu nối ${c.id}`)
    addDevice('ServiceValve', [c.x + (host ? 0 : 1), c.y], { name: `Van trước đồng hồ ${c.id}`, dn: c.dn, dma: c.dma })
    if (c.type === 'sx') {
      addDevice('BackflowPreventer', [c.x + 2, c.y + 2], { name: `Chống chảy ngược ${c.id}`, dn: c.dn, dma: c.dma })
      addDevice('BallValve', [c.x - 2, c.y + 2], { name: `Van bi ${c.id}`, dn: c.dn, dma: c.dma })
    }
  })
  // a sampling point per DMA, at a customer near the middle of the DMA
  for (const d of seed.dmas) {
    const c = connections.find((x) => x.dma === d.id && x.type === 'hcsn') ?? connections.find((x) => x.dma === d.id)
    if (c) addDevice('SamplingPoint', [c.x + 3, c.y - 3], { name: `Điểm lấy mẫu ${d.id}`, dn: 15, dma: d.id })
  }
  // hydrants: a few out of service
  for (const h of seed.hydrants ?? []) if (hash01(h.id + 'fault') < 0.08) h.status = 'fault'

  seed.sourceDevices = devices

  // ── 4. 24 h telemetry (15 min) for loggers, bulk meters and level sensors ──
  seed.telemetry = buildTelemetry(devices, pipeById, seed.TODAY)
}

/** Diurnal demand shape (0..1): night minimum ~03:00, peaks ~07:00 and ~19:00. */
const demandShape = (h: number) =>
  0.35 + 0.45 * Math.exp(-(((h - 7) / 1.8) ** 2)) + 0.5 * Math.exp(-(((h - 19) / 2.2) ** 2)) + 0.15 * Math.exp(-(((h - 12) / 2.5) ** 2))

function buildTelemetry(devices: DemoDevice[], pipeById: Map<string, P>, today = '2026-06-23'): Record<string, Telemetry> {
  const out: Record<string, Telemetry> = {}
  const start = `${today}T00:00:00+07:00`
  for (const d of devices) {
    const noise = (k: number) => (hash01(`${d.id}:${k}`) - 0.5)
    const host = d.hostPipeId ? pipeById.get(d.hostPipeId) : undefined
    const values: number[] = []
    if (d.deviceType === 'PressureSensor') {
      const base = host?.pressure ?? 3.2
      for (let k = 0; k < 96; k++) {
        let v = base + 0.9 - 1.3 * demandShape(k / 4) + noise(k) * 0.12
        if (d.status === 'warning' && k >= 8 && k <= 16) v -= 0.35 // night-time drop: suspected leak
        if (d.status === 'critical' && k >= 60) v -= 1.1 // sudden drop that does not recover
        values.push(Math.round(Math.max(0.3, v) * 100) / 100)
      }
      out[d.id] = { unit: 'bar', intervalMin: 15, start, values: d.status === 'offline' ? values.slice(0, 40) : values, low: 1.5, high: 6 }
    } else if (d.deviceType === 'BulkMeter') {
      const peak = (d.dn ?? 300) * 1.4
      for (let k = 0; k < 96; k++) {
        let v = peak * demandShape(k / 4) + noise(k) * peak * 0.05
        if (d.status === 'warning' && k < 20) v += peak * 0.12 // high minimum night flow
        values.push(Math.round(Math.max(0, v)))
      }
      out[d.id] = { unit: 'm³/h', intervalMin: 15, start, values: d.status === 'offline' ? values.slice(0, 40) : values }
    } else if (d.deviceType === 'LevelSensor') {
      let level = 3.6
      for (let k = 0; k < 96; k++) {
        level += (0.55 - demandShape(k / 4)) * 0.18 + noise(k) * 0.02
        level = Math.min(4.8, Math.max(0.8, level))
        values.push(Math.round(level * 100) / 100)
      }
      out[d.id] = { unit: 'm', intervalMin: 15, start, values, low: 1, high: 4.6 }
    }
  }
  return out
}
