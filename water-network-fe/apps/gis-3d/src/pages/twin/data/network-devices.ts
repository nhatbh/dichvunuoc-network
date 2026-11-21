/**
 * Every component on the pipe network, typed by its code in the component catalog (@wn/component-models).
 *
 * From the drawings: the 27 gate valves and the 25 named fittings of Đợt 3 (Tee, ReducingTee, Cross, Bend, Reducer
 * with their DN / DN2 from the pipes meeting there); the service network's tapping saddles ("đai khởi thủy" kt1…, on
 * the distribution pipe they clamp) and the fitting at every node of its pipes (tees, bends, reducers, caps), as
 * scripts/twin/service_network.py resolves them.
 * Assumed for the demo (`assumed: true`), placed by rule the way a utility equips such a network: the zone's
 * inlet station (DMA bulk meter, motorised control valve, pressure + chlorine monitoring, RTU), pressure loggers at
 * the critical (farthest) points, hydrants every ~180 m, air valves on mains every ~500 m, washouts at dead ends,
 * acoustic loggers on every third valve, sampling points, and the valves / air valves / meters on the D1000 and D600 mains,
 * with the parts that join the mains to each other and to the network (reducing tee, reducer, bends, coupling).
 *
 * Every fitting is turned to the pipes it joins (`orient`): a tee's branch points along its branch pipe, a bend turns
 * from one pipe into the other by the angle between them, a reducer's small end faces the smaller pipe.
 */
import { dist, type XY } from './geo'
import { isHdpe, NET, nominalDn, PIPE_BY_ID, segDist, type NetPipe } from './network-model'

export interface NetDevice {
  id: string
  /** catalog code */
  code: string
  /** label shown to people (tag or drawing code) */
  tag: string
  at: XY
  /** bearing of the pipe axis (rad, map frame) */
  heading: number
  /** a bend's angle (degrees) */
  angle?: number
  /** nominal size (catalog DN); for parts on an HDPE pipe, the DN of the pipe's outside diameter */
  dn: number
  dn2?: number
  /** outside diameter of the HDPE pipe(s) it joins, as the drawings write it (D110, D63 …) */
  od?: number
  od2?: number
  /** the pipe it is on / connected to */
  pipe?: string
  /** sits on the pipe axis (in-line, fittings) or beside it (hydrants, sensors) */
  onPipe: boolean
  assumed?: boolean
  source: string
}

const CAD = '1.MB-PP-Vinh Thinh - Dot 3.dwg'
const SERVICE = '2. MB Ong Dich vu- Vinh Thinh 123.dwg'
const FITTING_VI: Record<string, string> = { Tee: 'Tê', ReducingTee: 'Tê thu', Cross: 'Thập', Bend: 'Cút', Reducer: 'Côn', Cap: 'Bịt' }

/** nearest segment of the given pipes: pipe, bearing, point on it */
function nearest(p: XY, pipes: NetPipe[]) {
  let best = { pipe: pipes[0]!, heading: 0, d: Infinity, at: p }
  for (const pp of pipes)
    for (let i = 1; i < pp.path.length; i++) {
      const a = pp.path[i - 1]!
      const b = pp.path[i]!
      const d = segDist(p, a, b)
      if (d < best.d) {
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const l2 = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
        best = { pipe: pp, heading: Math.atan2(dy, dx), d, at: [a[0] + dx * t, a[1] + dy * t] }
      }
    }
  return best
}

/** points every `step` metres along a pipe (skipping the ends), with the local bearing */
function along(p: NetPipe, step: number, offset = step / 2) {
  const out: Array<{ at: XY; heading: number }> = []
  let next = offset
  let acc = 0
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1]!
    const b = p.path[i]!
    const l = dist(a, b)
    while (next <= acc + l && l > 0) {
      const t = (next - acc) / l
      out.push({ at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: Math.atan2(b[1] - a[1], b[0] - a[0]) })
      next += step
    }
    acc += l
  }
  return out
}
const side = (at: XY, heading: number, d: number): XY => [at[0] - Math.sin(heading) * d, at[1] + Math.cos(heading) * d]

/** a pipe leaving a node: its bearing from the node (rad) and its size */
export interface Leg {
  h: number
  dn: number
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const bearing = (from: XY, to: XY) => Math.atan2(to[1] - from[1], to[0] - from[0])

/**
 * The pipes leaving a point: one leg along a pipe that ends there, two along a pipe it lies on (to the vertices on
 * either side when it sits on a vertex, so a bend in a polyline gives the two directions of the bend).
 */
export function legsAt(at: XY, pipes: NetPipe[], tol = 1.5): Leg[] {
  const out: Leg[] = []
  for (const p of pipes) {
    const n = p.path.length
    const firstAway = (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < n; i += step) if (dist(p.path[i]!, at) > 0.05) return p.path[i]!
      return null
    }
    if (dist(p.path[0]!, at) <= tol) {
      const q = firstAway(1, 1)
      if (q) out.push({ h: bearing(at, q), dn: p.dn })
      continue
    }
    if (dist(p.path[n - 1]!, at) <= tol) {
      const q = firstAway(n - 2, -1)
      if (q) out.push({ h: bearing(at, q), dn: p.dn })
      continue
    }
    for (let i = 1; i < n; i++) {
      if (segDist(at, p.path[i - 1]!, p.path[i]!) > 0.5) continue
      const onVertex = dist(p.path[i]!, at) < 0.05 && i < n - 1
      const ahead = onVertex ? p.path[i + 1]! : p.path[i]!
      const back = dist(p.path[i - 1]!, at) < 0.05 ? (firstAway(i - 2, -1) ?? p.path[i - 1]!) : p.path[i - 1]!
      out.push({ h: bearing(at, back), dn: p.dn }, { h: bearing(at, ahead), dn: p.dn })
      break
    }
  }
  return out
}

/**
 * Heading (and a bend's angle) that turns a catalog fitting to the pipes at its node. On the map the catalog models
 * lie with their run along +heading (port A behind, B ahead); a tee's branch points to heading − 90°, a bend turns
 * clockwise from heading by its angle, a reducer's small end and a cap's dome are ahead.
 */
export function orient(kind: string, legs: Leg[], fallback = 0): { heading: number; angle?: number } {
  if (!legs.length) return { heading: fallback }
  if (kind === 'Cap') return { heading: legs[0]!.h + Math.PI }
  if (legs.length === 1) return { heading: legs[0]!.h }
  // the pair of legs closest to a straight line is the run
  let run: [number, number] = [0, 1]
  let best = Infinity
  for (let i = 0; i < legs.length; i++)
    for (let j = i + 1; j < legs.length; j++) {
      const dev = Math.abs(Math.PI - Math.abs(wrap(legs[i]!.h - legs[j]!.h)))
      const bigger = kind === 'ReducingTee' ? -(legs[i]!.dn + legs[j]!.dn) * 1e-6 : 0 // a reducing tee's run is the big pipe
      if (dev + bigger < best) [best, run] = [dev + bigger, [i, j]]
    }
  const [i, j] = run
  if (kind === 'Tee' || kind === 'ReducingTee' || kind === 'TappingSaddle') {
    const br = legs.find((_, k) => k !== i && k !== j)
    if (!br) return { heading: legs[j]!.h }
    // the branch must point to heading − 90°: take the run direction that puts it on that side
    return { heading: Math.sin(br.h - legs[j]!.h) < 0 ? legs[j]!.h : legs[i]!.h }
  }
  if (kind === 'Bend') {
    const a = legs[i]!.h
    const b = legs[j]!.h
    const angle = Math.round(180 - (Math.abs(wrap(a - b)) * 180) / Math.PI)
    // enter from leg a (heading a + π) and turn clockwise by the angle: the exit must point along leg b
    const h = a + Math.PI
    const fit = Math.abs(wrap(h - (angle * Math.PI) / 180 - b)) < 0.2
    return { heading: fit ? h : b + Math.PI, angle: Math.max(5, angle) }
  }
  // a reducer's small end ahead; one placed inside a pipe (legs back, ahead) points on along the pipe
  if (kind === 'Reducer') return { heading: legs[i]!.dn > legs[j]!.dn ? legs[j]!.h : legs[i]!.dn < legs[j]!.dn ? legs[i]!.h : legs[j]!.h }
  // a flange adapter's steel (flange) end is ahead: inside a pipe that leaves a steel fitting, it points back to it
  if (kind === 'Transition') return { heading: legs[i]!.h }
  return { heading: legs[j]!.h }
}
/** parts that come in sizes of 5° only, so bends share their models */
const roundAngle = (a: number | undefined) => (a === undefined ? undefined : Math.min(150, Math.max(5, Math.round(a / 5) * 5)))

function build(): NetDevice[] {
  const out: NetDevice[] = []
  const distPipes = NET.pipes.filter(p => p.kind === 'dist' || p.kind === 'trunk')
  const cadPipes = distPipes.filter(p => !p.assumed)

  // ── CAD valves and fittings ──
  for (const v of NET.valves) {
    const host = PIPE_BY_ID[v.pipe]
    const n = nearest(v.at, host ? [host] : cadPipes)
    out.push({ id: v.code, code: 'GateValve', tag: v.code, at: n.at, heading: n.heading, dn: n.pipe.dn, pipe: n.pipe.id, onPipe: true, source: `${CAD} (block Vanmoinoi)` })
  }
  for (const f of NET.fittings) {
    const meeting = cadPipes.filter(p => dist(p.path[0]!, f.at) < 1.5 || dist(p.path[p.path.length - 1]!, f.at) < 1.5 || nearest(f.at, [p]).d < 0.5)
    const dns = [...new Set(meeting.map(p => p.dn))].sort((a, b) => b - a)
    const n = nearest(f.at, meeting.length ? meeting : cadPipes)
    const o = orient(f.kind, legsAt(f.at, meeting), n.heading)
    out.push({
      id: f.id,
      code: f.kind,
      tag: f.kind,
      at: f.at,
      heading: o.heading,
      angle: roundAngle(o.angle),
      dn: dns[0] ?? n.pipe.dn,
      dn2: f.kind === 'ReducingTee' || f.kind === 'Reducer' ? (dns[dns.length - 1] ?? n.pipe.dn) : undefined,
      pipe: n.pipe.id,
      onPipe: true,
      source: `${CAD} (CAD import: ${f.kind})`,
    })
  }
  // ── service network: a tapping saddle on the distribution pipe where each tree starts, a fitting at every node ──
  for (const sd of NET.saddles)
    out.push({
      id: sd.id,
      code: 'TappingSaddle',
      tag: `Đai khởi thủy ${sd.tag}`,
      at: sd.at,
      heading: sd.heading,
      dn: sd.dn,
      dn2: sd.dn2,
      pipe: sd.main,
      onPipe: true,
      assumed: sd.assumed,
      source: sd.assumed ? `${SERVICE}: ống dịch vụ kết thúc trên ống phân phối, đai giả định` : `${SERVICE} (block Daudai ${sd.tag})`,
    })
  const atNode = new Map<string, NetPipe[]>()
  for (const p of NET.pipes) if (p.kind === 'service') for (const n of [p.from!, p.to!]) (atNode.get(n) ?? atNode.set(n, []).get(n)!).push(p)
  for (const f of NET.serviceFittings) {
    const size = f.dn2 ? `D${f.dn}/${f.dn2}` : `D${f.dn}`
    const o = orient(f.kind, legsAt(f.at, atNode.get(f.id) ?? [], 0.5), f.heading)
    out.push({
      id: f.id,
      code: f.kind,
      tag: `${FITTING_VI[f.kind] ?? f.kind} ${size}`,
      at: f.at,
      heading: o.heading,
      angle: roundAngle(o.angle),
      dn: f.dn,
      dn2: f.dn2,
      pipe: atNode.get(f.id)?.[0]?.id,
      onPipe: true,
      assumed: f.assumed,
      source: f.assumed ? `${SERVICE}: điểm nối giả định` : `${SERVICE} (nút ống dịch vụ: ${FITTING_VI[f.kind] ?? f.kind}${f.angle ? ` ${f.angle}°` : ''})`,
    })
  }

  const add = (d: Omit<NetDevice, 'assumed' | 'source'> & { source?: string }) => out.push({ source: 'Thiết bị giả định cho demo', ...d, assumed: true })

  // ── the assumed mains: the parts joining them, and a bend at every turn of their routes ──
  const mainPipes = NET.pipes.filter(p => p.kind === 'transmission' || p.kind === 'raw' || p.id === 'TM-02')
  const nearMains = (at: XY) => NET.pipes.filter(p => p.kind !== 'service' && Math.min(...p.path.slice(1).map((b, i) => segDist(at, p.path[i]!, b))) < 1.5)
  for (const j of NET.junction) {
    const o = orient(j.kind, legsAt(j.at, nearMains(j.at)))
    add({ id: j.id, code: j.kind, tag: j.tag, at: j.at, heading: o.heading, dn: j.dn, dn2: j.dn2, pipe: j.pipe, onPipe: true, source: 'Phụ kiện nối giả định (tuyến ống chính giả định)' })
  }
  for (const p of mainPipes)
    for (let i = 1; i < p.path.length - 1; i++) {
      const legs = legsAt(p.path[i]!, [p])
      if (legs.length < 2 || Math.abs(Math.PI - Math.abs(wrap(legs[0]!.h - legs[1]!.h))) < (10 * Math.PI) / 180) continue
      const o = orient('Bend', legs)
      const dn = nominalDn(p.dn, p.mat)
      add({ id: `CU-${p.id}-${i}`, code: 'Bend', tag: `Cút ${o.angle}° DN${dn}`, at: p.path[i]!, heading: o.heading, angle: roundAngle(o.angle), dn: p.dn, pipe: p.id, onPipe: true, source: 'Cút tại điểm đổi hướng tuyến giả định' })
    }

  // ── zone inlet station (assumed), on the branch's last run into the network ──
  const inlet = PIPE_BY_ID['TM-02']!
  const ia = inlet.path[inlet.path.length - 2]!
  const ib = inlet.path[inlet.path.length - 1]!
  const h = Math.atan2(ib[1] - ia[1], ib[0] - ia[0])
  const runLen = dist(ia, ib)
  /** a point `m` metres before the network's DN315 end */
  const before = (m: number): XY => [ib[0] - ((ib[0] - ia[0]) * m) / runLen, ib[1] - ((ib[1] - ia[1]) * m) / runLen]
  add({ id: 'MV-VT3', code: 'MotorisedValve', tag: 'MV-VT3', at: before(70), heading: h, dn: 315, pipe: inlet.id, onPipe: true })
  add({ id: 'FT-VT3', code: 'BulkMeter', tag: 'FT-VT3', at: before(45), heading: h, dn: 315, pipe: inlet.id, onPipe: true })
  add({ id: 'PT-VT3-01', code: 'PressureSensor', tag: 'PT-VT3-01', at: side(before(25), h, 2.5), heading: h, dn: 15, pipe: inlet.id, onPipe: false })
  add({ id: 'AIT-VT3', code: 'ChlorineAnalyser', tag: 'AIT-VT3', at: side(before(32), h, -4), heading: h, dn: 15, pipe: inlet.id, onPipe: false })
  add({ id: 'RTU-VT3', code: 'RTU', tag: 'RTU-VT3', at: side(before(55), h, 5), heading: h, dn: 15, pipe: inlet.id, onPipe: false })

  // ── critical points: the two dead ends farthest from the inlet ──
  const ends: Array<{ at: XY; pipe: NetPipe; heading: number }> = []
  const endCount = new Map<string, number>()
  const key = (p: XY) => `${Math.round(p[0])}:${Math.round(p[1])}`
  for (const p of cadPipes) for (const e of [p.path[0]!, p.path[p.path.length - 1]!]) endCount.set(key(e), (endCount.get(key(e)) ?? 0) + 1)
  for (const p of cadPipes)
    for (const [e, o] of [
      [p.path[0]!, p.path[1]!],
      [p.path[p.path.length - 1]!, p.path[p.path.length - 2]!],
    ] as const)
      if (endCount.get(key(e)) === 1 && dist(e, NET.entry) > 50) ends.push({ at: e, pipe: p, heading: Math.atan2(e[1] - o[1], e[0] - o[0]) })
  ends.sort((a, b) => dist(b.at, NET.entry) - dist(a.at, NET.entry))
  ends.slice(0, 2).forEach((e, i) => {
    add({ id: `PT-VT3-0${i + 2}`, code: 'PressureSensor', tag: `PT-VT3-0${i + 2}`, at: side(e.at, e.heading, 2.5), heading: e.heading, dn: 15, pipe: e.pipe.id, onPipe: false })
    add({ id: `RTU-VT3-0${i + 2}`, code: 'RTU', tag: `RTU-VT3-0${i + 2}`, at: side(e.at, e.heading, 5), heading: e.heading, dn: 15, pipe: e.pipe.id, onPipe: false })
  })
  ends.forEach((e, i) => add({ id: `WO-${i + 1}`, code: 'Washout', tag: `XC-${i + 1}`, at: e.at, heading: e.heading, dn: Math.min(nominalDn(e.pipe.dn, e.pipe.mat), 100), pipe: e.pipe.id, onPipe: true }))

  // ── hydrants, air valves, sampling points, acoustic loggers ──
  let hn = 0
  for (const p of cadPipes) for (const s of along(p, p.dn >= 160 ? 180 : 220)) add({ id: `HY-${++hn}`, code: 'Hydrant', tag: `TCH-${hn}`, at: side(s.at, s.heading, 4), heading: s.heading, dn: 100, pipe: p.id, onPipe: false })
  let an = 0
  for (const p of NET.pipes.filter(x => x.kind === 'trunk' || x.kind === 'transmission' || x.kind === 'raw'))
    for (const s of along(p, p.kind === 'trunk' ? 500 : 650, 260)) add({ id: `AV-${++an}`, code: 'AirValve', tag: `XK-${an}`, at: s.at, heading: s.heading, dn: p.dn >= 900 ? 250 : p.dn >= 600 ? 200 : 80, pipe: p.id, onPipe: true })
  cadPipes
    .filter(p => p.dn <= 110)
    .filter((_, i) => i % 6 === 2)
    .forEach((p, i) => {
      const s = along(p, 1e9, Math.min(40, p.len / 2))[0]
      if (s) add({ id: `SP-${i + 1}`, code: 'SamplingPoint', tag: `LM-${i + 1}`, at: side(s.at, s.heading, 3), heading: s.heading, dn: 20, pipe: p.id, onPipe: false })
    })
  NET.valves.filter((_, i) => i % 3 === 0).forEach((v, i) => {
    const n = nearest(v.at, cadPipes)
    add({ id: `AL-${i + 1}`, code: 'AcousticLogger', tag: `NR-${i + 1}`, at: side(n.at, n.heading, 1.6), heading: n.heading, dn: 15, pipe: n.pipe.id, onPipe: false })
  })

  // ── D1000 transmission and D600 raw-water mains ──
  const tm = PIPE_BY_ID['TM-01']!
  const t0 = along(tm, 1e9, 30)[0]!
  add({ id: 'BV-TD-01', code: 'ButterflyValve', tag: 'VB-TD-01', at: t0.at, heading: t0.heading, dn: 1000, pipe: tm.id, onPipe: true })
  const t1 = along(tm, 1e9, 60)[0]!
  add({ id: 'FT-TD-01', code: 'BulkMeter', tag: 'FT-TD-01', at: t1.at, heading: t1.heading, dn: 1000, pipe: tm.id, onPipe: true })
  const rw = PIPE_BY_ID['RW-01']!
  const r0 = along(rw, 1e9, 40)[0]!
  add({ id: 'BV-NT-01', code: 'ButterflyValve', tag: 'VB-NT-01', at: r0.at, heading: r0.heading, dn: 600, pipe: rw.id, onPipe: true })
  const r1 = along(rw, 1e9, 2600)[0]
  if (r1) add({ id: 'WO-NT-01', code: 'Washout', tag: 'XC-NT-01', at: r1.at, heading: r1.heading, dn: 200, pipe: rw.id, onPipe: true })

  // the catalog sizes parts by nominal DN; HDPE pipes are given by outside diameter (D110 = DN100, D63 = DN50 …)
  for (const d of out) {
    const pipe = d.pipe ? PIPE_BY_ID[d.pipe] : undefined
    if (!d.onPipe || !pipe || !isHdpe(pipe.mat) || !SIZED_BY_PIPE.has(d.code)) continue
    d.od = d.dn
    d.dn = nominalDn(d.dn)
    if (d.dn2) {
      d.od2 = d.dn2
      d.dn2 = nominalDn(d.dn2)
    }
  }
  return out
}
/** parts that take the size of the pipe(s) they are on */
const SIZED_BY_PIPE = new Set(['GateValve', 'MotorisedValve', 'BulkMeter', 'Tee', 'ReducingTee', 'Cross', 'Bend', 'Reducer', 'Cap', 'TappingSaddle'])

/** parts of the service network: its saddles and the fittings on its pipes (shown with the service pipes) */
export const isServiceDevice = (d: NetDevice) => d.code === 'TappingSaddle' || d.code === 'CustomerMeter' || (!!d.pipe && PIPE_BY_ID[d.pipe]?.kind === 'service')

export const NET_DEVICES = build()
export const DEVICE_BY_ID: Record<string, NetDevice> = Object.fromEntries(NET_DEVICES.map(d => [d.id, d]))

/** devices on the map that are worth a flat symbol at mid distance (not every saddle) */
export const SYMBOLISED = new Set(['GateValve', 'ButterflyValve', 'MotorisedValve', 'BulkMeter', 'PressureSensor', 'ChlorineAnalyser', 'RTU', 'Hydrant', 'AirValve', 'Washout', 'CustomerMeter', 'SamplingPoint', 'AcousticLogger'])
