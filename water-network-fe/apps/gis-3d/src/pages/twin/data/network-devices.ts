/**
 * Every component on the pipe network, typed by its code in the component catalog (@wn/component-models).
 *
 * From the drawings: the 27 gate valves and the 25 named fittings of Đợt 3 (Tee, ReducingTee, Cross, Bend, Reducer
 * with their DN / DN2 from the pipes meeting there), a tapping saddle at the start of each of the 746 service lines,
 * and a customer meter at each of the 180 meter clusters ("đai khởi thủy" blocks).
 * Assumed for the demo (`assumed: true`), placed by rule the way a utility equips such a network: the zone's
 * inlet station (DMA bulk meter, motorised control valve, pressure + chlorine monitoring, RTU), pressure loggers at
 * the critical (farthest) points, hydrants every ~180 m, air valves on mains every ~500 m, washouts at dead ends,
 * acoustic loggers on every third valve, sampling points, and the valves / air valves / meters on the D1000 and D600 mains.
 */
import { dist, type XY } from './geo'
import { NET, PIPE_BY_ID, segDist, type NetPipe } from './network-model'

export interface NetDevice {
  id: string
  /** catalog code */
  code: string
  /** label shown to people (tag or drawing code) */
  tag: string
  at: XY
  /** bearing of the pipe axis (rad, map frame) */
  heading: number
  dn: number
  dn2?: number
  /** the pipe it is on / connected to */
  pipe?: string
  /** sits on the pipe axis (in-line, fittings) or beside it (hydrants, sensors) */
  onPipe: boolean
  assumed?: boolean
  source: string
}

const CAD = '1.MB-PP-Vinh Thinh - Dot 3.dwg'
const SERVICE = '2. MB Ong Dich vu- Vinh Thinh 123.dwg'

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
    out.push({
      id: f.id,
      code: f.kind,
      tag: f.kind,
      at: f.at,
      heading: n.heading,
      dn: dns[0] ?? n.pipe.dn,
      dn2: f.kind === 'ReducingTee' || f.kind === 'Reducer' ? (dns[dns.length - 1] ?? n.pipe.dn) : undefined,
      pipe: n.pipe.id,
      onPipe: true,
      source: `${CAD} (CAD import: ${f.kind})`,
    })
  }
  // ── service lines: a tapping saddle where each leaves its main, a meter at each cluster ──
  for (const s of NET.pipes.filter(p => p.kind === 'service')) {
    const n = nearest(s.path[0]!, distPipes)
    if (n.d > 25) continue
    out.push({ id: `TS-${s.id}`, code: 'TappingSaddle', tag: `Đai ${s.code}`, at: n.at, heading: n.heading, dn: n.pipe.dn, dn2: s.dn, pipe: n.pipe.id, onPipe: true, source: `${SERVICE} (đầu tuyến dịch vụ)` })
  }
  NET.meters.forEach((m, i) => {
    out.push({ id: `KT-${i + 1}`, code: 'CustomerMeter', tag: `kt${i + 1}`, at: m, heading: 0, dn: 25, onPipe: false, source: `${SERVICE} (block đai khởi thủy kt${i + 1})` })
  })

  // ── zone inlet station (assumed) ──
  const inlet = PIPE_BY_ID['TM-02']!
  const ia = inlet.path[0]!
  const ib = inlet.path[1]!
  const h = Math.atan2(ib[1] - ia[1], ib[0] - ia[0])
  const at = (t: number): XY => [ia[0] + (ib[0] - ia[0]) * t, ia[1] + (ib[1] - ia[1]) * t]
  const add = (d: Omit<NetDevice, 'assumed' | 'source'> & { source?: string }) => out.push({ source: 'Thiết bị giả định cho demo', ...d, assumed: true })
  add({ id: 'MV-VT3', code: 'MotorisedValve', tag: 'MV-VT3', at: at(0.25), heading: h, dn: 315, pipe: inlet.id, onPipe: true })
  add({ id: 'FT-VT3', code: 'BulkMeter', tag: 'FT-VT3', at: at(0.55), heading: h, dn: 315, pipe: inlet.id, onPipe: true })
  add({ id: 'PT-VT3-01', code: 'PressureSensor', tag: 'PT-VT3-01', at: side(at(0.75), h, 2.5), heading: h, dn: 15, pipe: inlet.id, onPipe: false })
  add({ id: 'AIT-VT3', code: 'ChlorineAnalyser', tag: 'AIT-VT3', at: side(at(0.7), h, -4), heading: h, dn: 15, pipe: inlet.id, onPipe: false })
  add({ id: 'RTU-VT3', code: 'RTU', tag: 'RTU-VT3', at: side(at(0.5), h, 5), heading: h, dn: 15, pipe: inlet.id, onPipe: false })

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
  ends.forEach((e, i) => add({ id: `WO-${i + 1}`, code: 'Washout', tag: `XC-${i + 1}`, at: e.at, heading: e.heading, dn: Math.min(e.pipe.dn, 100), pipe: e.pipe.id, onPipe: true }))

  // ── hydrants, air valves, sampling points, acoustic loggers ──
  let hn = 0
  for (const p of cadPipes) for (const s of along(p, p.dn >= 160 ? 180 : 220)) add({ id: `HY-${++hn}`, code: 'Hydrant', tag: `TCH-${hn}`, at: side(s.at, s.heading, 4), heading: s.heading, dn: 100, pipe: p.id, onPipe: false })
  let an = 0
  for (const p of NET.pipes.filter(x => x.kind === 'trunk' || x.kind === 'transmission' || x.kind === 'raw'))
    for (const s of along(p, p.kind === 'trunk' ? 500 : 650, 260)) add({ id: `AV-${++an}`, code: 'AirValve', tag: `XK-${an}`, at: s.at, heading: s.heading, dn: p.dn >= 600 ? 150 : 80, pipe: p.id, onPipe: true })
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
  return out
}

export const NET_DEVICES = build()
export const DEVICE_BY_ID: Record<string, NetDevice> = Object.fromEntries(NET_DEVICES.map(d => [d.id, d]))

/** devices on the map that are worth a flat symbol at mid distance (not every saddle) */
export const SYMBOLISED = new Set(['GateValve', 'ButterflyValve', 'MotorisedValve', 'BulkMeter', 'PressureSensor', 'ChlorineAnalyser', 'RTU', 'Hydrant', 'AirValve', 'Washout', 'CustomerMeter', 'SamplingPoint', 'AcousticLogger'])
