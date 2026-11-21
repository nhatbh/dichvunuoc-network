/**
 * The pipe network on the integrated map, in the local metric frame (geo.ts):
 *  - distribution: the 43 pipes, 27 gate valves and 44 fittings of "1.MB-PP-Vinh Thinh - Dot 3.dwg" (CAD import);
 *  - service: the D50/D63 service pipes of "2. MB Ong Dich vu- Vinh Thinh 123.dwg", processed like the distribution
 *    drawing (nodes, the fitting at each node, caps) and hung off the processed distribution pipes through the drawing's
 *    180 tapping saddles "kt1…" (scripts/twin/service_network.py). Links the drawing does not show are `assumed`;
 *  - transmission (assumed route): D1000 steel from the plant's clean-water PS to the DN315 head of the
 *    network (the drawing's northern open end, where the main enters), continuing to the other zones;
 *  - raw water (assumed route): D600 steel from TB1 at the river to the plant's pond inlet (cửa xả cấp nước thô).
 *
 * `solveNetwork` turns the plant's outlet head + the zone's demand into a flow and a pressure for every pipe
 * (tree from the entry node, demand spread by pipe length, Hazen-Williams). Closed valves cut their subtree. Each
 * service tree takes the pressure of the distribution pipe its saddle sits on and carries the demand of its length.
 *
 * Sizes follow the drawings and the CAD import: `dn` of an HDPE pipe is its outside diameter in mm (D50 … D315, ISO 4427
 * / TCVN 7305), of a steel main its nominal size. `nominalDn` gives the standard DN of an HDPE outside diameter.
 */
import cad from './cad-twin.json'
import { dist, polylineLength, toLocal, type XY } from './geo'
import { PLANT, R, plantToMap, INTAKE } from './plant-model'

export type PipeKind = 'transmission' | 'raw' | 'trunk' | 'dist' | 'service'

export interface NetPipe {
  id: string
  code: string
  kind: PipeKind
  dn: number
  mat: string
  len: number
  path: XY[]
  from?: string
  to?: string
  source: string
  assumed?: boolean
}
export interface NetValve {
  id: string
  code: string
  pipe: string
  dn: number
  at: XY
}
export interface NetFitting {
  id: string
  kind: string
  at: XY
}
/** a fitting of the service network, with the size of the pipes it joins */
export interface ServiceFitting {
  id: string
  kind: 'Tee' | 'ReducingTee' | 'Cross' | 'Bend' | 'Reducer' | 'Cap'
  dn: number
  dn2?: number
  angle?: number
  at: XY
  /** bearing of the fitting's run (rad, map frame); for a cap, pointing away from its pipe */
  heading: number
  assumed?: boolean
}
/** a tapping saddle on a distribution pipe, where a service tree starts */
export interface ServiceSaddle {
  id: string
  /** the drawing's name ("kt12") */
  tag: string
  /** the distribution pipe it clamps */
  main: string
  dn: number
  /** the service pipe it feeds */
  dn2: number
  at: XY
  heading: number
  assumed?: boolean
}

/** a part joining the assumed mains to each other and to the network (sizes are nominal DN) */
export interface JunctionPart {
  id: string
  kind: 'ReducingTee' | 'Reducer' | 'Transition' | 'Coupling'
  tag: string
  dn: number
  dn2?: number
  at: XY
  pipe: string
}

/** Standard DN of an HDPE pipe by its outside diameter (ISO 4427 / TCVN 7305). */
const HDPE_DN: Record<number, number> = { 20: 15, 25: 20, 32: 25, 40: 32, 50: 40, 63: 50, 75: 65, 90: 80, 110: 100, 125: 100, 140: 125, 160: 150, 200: 175, 225: 200, 250: 225, 280: 250, 315: 300, 355: 350, 400: 350 }
export const isHdpe = (mat: string) => /hdpe|\bpe\b/i.test(mat)
/** nominal DN of a pipe size as the data gives it (HDPE: outside diameter) */
export const nominalDn = (dn: number, mat = 'HDPE') => (isHdpe(mat) ? (HDPE_DN[dn] ?? Math.round(dn * 0.9)) : dn)
/** how a pipe size is written: HDPE by outside diameter with its DN ("D90 (DN80)"), steel by its nominal size */
export const sizeLabel = (dn: number, mat = 'HDPE') => (isHdpe(mat) ? `D${dn} (DN${nominalDn(dn, mat)})` : `D${dn}`)

interface CadNet {
  network: {
    source: string
    pipes: Array<{ id: string; dn: number; mat: string; len: number; from: string | null; to: string | null; path: [number, number][] }>
    valves: Array<{ id: string; pipe: string | null; dn: number; at: [number, number] }>
    fittings: Array<{ id: string; kind: string; at: [number, number] }>
  }
  service: {
    source: string
    pipes: Array<{ id: string; dn: number; from: string; to: string; path: [number, number][]; assumed?: boolean }>
    fittings: Array<Omit<ServiceFitting, 'at'> & { at: [number, number] }>
    saddles: Array<Omit<ServiceSaddle, 'at'> & { at: [number, number] }>
  }
}
const C = cad as unknown as CadNet

/** TB1 (pump house, channel) is drawn this many times its size on the map, so it reads next to the thickened pipes */
export const INTAKE_MAP_SCALE = 2.5
/** bearing of TB1's local +x (towards the river): the nearest drawn water edge point, as intake-builder places it */
export const INTAKE_HEADING_MAP = (() => {
  let best: XY | null = null
  let bd = Infinity
  for (const l of INTAKE.waterEdge)
    for (const p of l) {
      const d = dist(p, INTAKE.origin)
      if (d < bd) [bd, best] = [d, p]
    }
  return best ? Math.atan2(best[1] - INTAKE.origin[1], best[0] - INTAKE.origin[0]) : Math.PI
})()

/** The drawing's northern open end of the DN315 main: where water from the plant enters the zone. */
export const ENTRY_LONLAT: [number, number] = [105.49342, 21.1961]

const L = ([lon, lat]: readonly number[]) => toLocal(lon!, lat!)

function build() {
  const pipes: NetPipe[] = []
  // ── distribution (CAD import) ──
  const sorted = C.network.pipes.slice().sort((a, b) => b.dn - a.dn || a.id.localeCompare(b.id))
  sorted.forEach((p, i) => {
    pipes.push({
      id: p.id,
      code: `VT3-${String(i + 1).padStart(3, '0')}`,
      kind: p.dn >= 225 ? 'trunk' : 'dist',
      dn: p.dn,
      mat: p.mat || 'HDPE',
      len: p.len || polylineLength(p.path.map(L)),
      path: p.path.map(L),
      from: p.from ?? undefined,
      to: p.to ?? undefined,
      source: C.network.source,
    })
  })
  // ── service pipes, between their nodes (fittings / saddles) ──
  C.service.pipes.forEach((s, i) => {
    const path = s.path.map(L)
    pipes.push({
      id: s.id,
      code: `DV-${String(i + 1).padStart(4, '0')}`,
      kind: 'service',
      dn: s.dn,
      mat: 'HDPE',
      len: polylineLength(path),
      path,
      from: s.from,
      to: s.to,
      source: s.assumed ? 'Đoạn nối giả định: bản vẽ không thể hiện điểm đấu' : C.service.source,
      assumed: s.assumed,
    })
  })
  // ── transmission D1000 (assumed route) and the zone's branch off it ──
  // The main runs on to the other zones (D800 after a reducer). The zone is fed through a reducing tee DN1000 × DN300
  // at B: its D315 branch leaves to the right of the main (the catalog tee's side), turns and runs to the drawing's
  // DN315 open end, where a coupling joins it to the network.
  const s7 = R('S07')
  const outlet = plantToMap([s7.x0 - 1, s7.cy + 2.6])
  const exitW = plantToMap([PLANT.boundary.reduce((m, p) => Math.min(m, p[0]), 0) - 6, s7.cy + 2.6])
  const entry = L(ENTRY_LONLAT)
  const E = (dx: number, dy: number): XY => [entry[0] + dx, entry[1] + dy]
  const K = E(420, 820)
  const B = E(120, 260)
  const dl = Math.hypot(B[0] - K[0], B[1] - K[1])
  const d: XY = [(B[0] - K[0]) / dl, (B[1] - K[1]) / dl] // along the main at B
  const at = (o: XY, v: XY, m: number): XY => [o[0] + v[0] * m, o[1] + v[1] * m]
  const tm: XY[] = [outlet, exitW, [exitW[0] - 180, exitW[1] - 260], K, B]
  pipes.unshift({
    id: 'TM-01',
    code: 'D1000-TD',
    kind: 'transmission',
    dn: 1000,
    mat: 'Thép',
    len: polylineLength(tm),
    path: tm,
    source: 'DCCN: "D1000-st tới mạng lưới tiêu thụ" · tuyến giả định',
    assumed: true,
  })
  const c2 = at(B, d, 45)
  const c3 = at(c2, [-d[1], d[0]], 40) // a 90° bend to the left, towards the other zones
  const onward: XY[] = [B, c2, c3, E(700, 180), E(1500, -120)]
  pipes.unshift({
    id: 'TM-03',
    code: 'D800-KV',
    kind: 'transmission',
    dn: 800,
    mat: 'Thép',
    len: polylineLength(onward),
    path: onward,
    source: 'Đi các khu vực khác · giả định',
    assumed: true,
  })
  const branch: XY[] = [B, at(B, [d[1], -d[0]], 15), entry]
  pipes.unshift({
    id: 'TM-02',
    code: 'D315-NV',
    kind: 'trunk',
    dn: 315,
    mat: 'HDPE',
    len: polylineLength(branch),
    path: branch,
    source: 'Nhánh cấp vùng từ ống D1000, đấu nối vào DN315 · giả định',
    assumed: true,
  })
  // the parts that join them (catalog codes, nominal DN), oriented later from the pipes they meet
  const junction: JunctionPart[] = [
    { id: 'TE-TD-01', kind: 'ReducingTee', tag: 'Tê thu DN1000×300', dn: 1000, dn2: 300, at: B, pipe: 'TM-01' },
    { id: 'CO-TD-01', kind: 'Reducer', tag: 'Côn DN1000×800', dn: 1000, dn2: 800, at: at(B, d, 14), pipe: 'TM-03' },
    { id: 'KN-NV-01', kind: 'Transition', tag: 'Khớp nối thép – HDPE DN300', dn: 300, at: at(B, [d[1], -d[0]], 9), pipe: 'TM-02' },
    { id: 'MS-NV-01', kind: 'Coupling', tag: 'Măng sông HDPE D315', dn: 300, at: entry, pipe: 'TM-02' },
  ]
  // ── raw water D600 (assumed route): out of TB1's pump house (drawn INTAKE_MAP_SCALE times its size on the map,
  // like the pipes are thickened), inland, to the plant's raw-water inlet ──
  const inlet = plantToMap(PLANT.inletOutfall)
  const ia = INTAKE.origin
  const tb1 = (x: number, y: number): XY => {
    const c = Math.cos(INTAKE_HEADING_MAP)
    const s = Math.sin(INTAKE_HEADING_MAP)
    return [ia[0] + (x * c - y * s) * INTAKE_MAP_SCALE, ia[1] + (x * s + y * c) * INTAKE_MAP_SCALE]
  }
  const raw: XY[] = [
    tb1(-6, -2), // inside the pump house wall: the rising main leaves the house
    tb1(-22, -2),
    [ia[0] + 140, ia[1] + 380],
    [ia[0] + 250, ia[1] + 1700],
    [ia[0] + 620, ia[1] + 2850],
    [ia[0] + 1700, ia[1] + 3850],
    [inlet[0] - 160, inlet[1] - 90],
    inlet,
  ]
  pipes.unshift({
    id: 'RW-01',
    code: 'D600-NT',
    kind: 'raw',
    dn: 600,
    mat: 'Thép',
    len: polylineLength(raw),
    path: raw,
    source: 'TB1: "DN600 - ST", DCCN · tuyến giả định',
    assumed: true,
  })

  const valves: NetValve[] = C.network.valves.map((v, i) => ({ id: v.id, code: `V.${i + 1}`, pipe: v.pipe ?? '', dn: v.dn, at: L(v.at) }))
  const fittings: NetFitting[] = C.network.fittings.filter(f => f.kind !== 'Junction').map(f => ({ id: f.id, kind: f.kind, at: L(f.at) }))
  const serviceFittings: ServiceFitting[] = C.service.fittings.map(f => ({ ...f, at: L(f.at) }))
  const saddles: ServiceSaddle[] = C.service.saddles.map(s => ({ ...s, at: L(s.at) }))
  return { pipes, valves, fittings, serviceFittings, saddles, junction, entry }
}

export const NET = build()
export const PIPE_BY_ID: Record<string, NetPipe> = Object.fromEntries(NET.pipes.map(p => [p.id, p]))

// ───────────────────────── hydraulics ─────────────────────────

export interface PipeState {
  /** m³/h, positive in drawing direction (path[0] → path[n]) */
  q: number
  /** pressure at the downstream end (m) */
  p: number
  /** velocity m/s */
  v: number
  supplied: boolean
}

interface Topo {
  order: string[]
  parent: Map<string, string>
  dir: Map<string, 1 | -1>
  /** demand weight carried through each pipe (subtree length) */
  carried: Map<string, number>
  total: number
  /** for each service pipe: the distribution pipe its saddle sits on */
  serviceHost: Map<string, string>
  /** service pipes from each saddle outwards (parents before children) */
  serviceOrder: string[]
  /** node the water enters each service pipe from */
  serviceUp: Map<string, string>
  /** service pipe length downstream of (and including) each service pipe */
  serviceCarried: Map<string, number>
  serviceTotal: number
}

function topology(): Topo {
  const dist0 = NET.pipes.filter(p => p.kind === 'trunk' || p.kind === 'dist').filter(p => p.from && p.to)
  const adj = new Map<string, Array<{ pipe: NetPipe; other: string; dir: 1 | -1 }>>()
  const link = (a: string, b: string, pipe: NetPipe, dir: 1 | -1) => (adj.get(a) ?? adj.set(a, []).get(a)!).push({ pipe, other: b, dir })
  for (const p of dist0) {
    link(p.from!, p.to!, p, 1)
    link(p.to!, p.from!, p, -1)
  }
  // entry node: the network node closest to ENTRY
  let entryNode = ''
  let best = Infinity
  for (const p of dist0)
    for (const [ref, pt] of [
      [p.from!, p.path[0]!],
      [p.to!, p.path[p.path.length - 1]!],
    ] as const) {
      const d = dist(pt, NET.entry)
      if (d < best) [best, entryNode] = [d, ref]
    }
  const parent = new Map<string, string>()
  const dir = new Map<string, 1 | -1>()
  const order: string[] = []
  const seen = new Set([entryNode])
  const queue = [entryNode]
  const children = new Map<string, string[]>()
  const pipeNode = new Map<string, string>() // pipe id -> its downstream node
  while (queue.length) {
    const n = queue.shift()!
    for (const { pipe, other, dir: d } of adj.get(n) ?? []) {
      if (seen.has(other)) continue
      seen.add(other)
      parent.set(pipe.id, n)
      dir.set(pipe.id, d)
      order.push(pipe.id)
      pipeNode.set(pipe.id, other)
      ;(children.get(n) ?? children.set(n, []).get(n)!).push(pipe.id)
      queue.push(other)
    }
  }
  const carried = new Map<string, number>()
  for (const id of order.slice().reverse()) {
    const node = pipeNode.get(id)!
    const own = NET.pipes.find(p => p.id === id)!.len
    const sub = (children.get(node) ?? []).reduce((s, c) => s + (carried.get(c) ?? 0), 0)
    carried.set(id, own + sub)
  }
  const total = (children.get(entryNode) ?? []).reduce((s, c) => s + (carried.get(c) ?? 0), 0)
  // service trees: out from each saddle along the service pipes
  const sAdj = new Map<string, NetPipe[]>()
  for (const p of NET.pipes)
    if (p.kind === 'service') for (const n of [p.from!, p.to!]) (sAdj.get(n) ?? sAdj.set(n, []).get(n)!).push(p)
  const serviceHost = new Map<string, string>()
  const serviceUp = new Map<string, string>()
  const serviceOrder: string[] = []
  const sChildren = new Map<string, string[]>()
  for (const sd of NET.saddles) {
    const q = [sd.id]
    const seenS = new Set([sd.id])
    while (q.length) {
      const n = q.shift()!
      for (const p of sAdj.get(n) ?? []) {
        if (serviceHost.has(p.id)) continue
        const other = p.from === n ? p.to! : p.from!
        serviceHost.set(p.id, sd.main)
        serviceUp.set(p.id, n)
        serviceOrder.push(p.id)
        ;(sChildren.get(n) ?? sChildren.set(n, []).get(n)!).push(p.id)
        if (!seenS.has(other)) {
          seenS.add(other)
          q.push(other)
        }
      }
    }
  }
  const serviceCarried = new Map<string, number>()
  for (const id of serviceOrder.slice().reverse()) {
    const p = PIPE_BY_ID[id]!
    const down = serviceUp.get(id) === p.from ? p.to! : p.from!
    serviceCarried.set(id, p.len + (sChildren.get(down) ?? []).reduce((s, c) => s + (serviceCarried.get(c) ?? 0), 0))
  }
  const serviceTotal = NET.pipes.reduce((s, p) => s + (p.kind === 'service' ? p.len : 0), 0)
  return { order, parent, dir, carried, total, serviceHost, serviceOrder, serviceUp, serviceCarried, serviceTotal }
}

export function segDist(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!
  const dy = b[1]! - a[1]!
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / l2))
  return Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy)
}

let TOPO: Topo | null = null

const hw = (lenM: number, qM3h: number, dnMm: number, c = 140) => {
  const q = Math.abs(qM3h) / 3600
  const d = (dnMm * (dnMm >= 500 ? 0.97 : 0.88)) / 1000
  return (10.67 * lenM * q ** 1.852) / (c ** 1.852 * d ** 4.87)
}

export interface NetworkSolution {
  pipes: Map<string, PipeState>
  minP: number
  maxP: number
  unsupplied: number
}

export function solveNetwork(input: { entryHead: number; qZone: number; qOut: number; qRaw: number; demandFactor: number; closedValves: ReadonlySet<string> }): NetworkSolution {
  const T = (TOPO ??= topology())
  const out = new Map<string, PipeState>()
  // closed valve codes → pipes cut
  const cut = new Set(NET.valves.filter(v => input.closedValves.has(v.code)).map(v => v.pipe))
  // demand weight of everything cut off is not served
  const nodeHead = new Map<string, number>()
  const blocked = new Set<string>()
  let lost = 0
  for (const id of T.order) {
    const par = T.parent.get(id)!
    if (cut.has(id) || blocked.has(par)) {
      blocked.add(downstreamNode(id))
      if (cut.has(id) && !blocked.has(par)) lost += T.carried.get(id) ?? 0
    }
  }
  const served = Math.max(1e-6, T.total - lost)
  const supplied = input.entryHead > 3
  let minP = Infinity
  let maxP = -Infinity
  let unsupplied = 0
  for (const id of T.order) {
    const pipe = PIPE_BY_ID[id]!
    const par = T.parent.get(id)!
    const down = downstreamNode(id)
    const isBlocked = blocked.has(down)
    const hUp = nodeHead.get(par) ?? input.entryHead
    const q = isBlocked ? 0 : (input.qZone * (T.carried.get(id) ?? 0)) / served
    const h = isBlocked ? 0 : Math.max(0, hUp - hw(pipe.len, q, pipe.dn))
    nodeHead.set(down, h)
    const area = Math.PI * ((pipe.dn * 0.88) / 2000) ** 2
    out.set(id, { q: q * T.dir.get(id)!, p: h, v: q / 3600 / area, supplied: supplied && !isBlocked })
    if (!isBlocked) {
      minP = Math.min(minP, h)
      maxP = Math.max(maxP, h)
    } else unsupplied++
  }
  // pipes outside the tree (loops / unconnected) take their neighbours' pressure
  for (const p of NET.pipes) {
    if (out.has(p.id)) continue
    if (p.kind === 'transmission') {
      const q = p.id === 'TM-01' ? input.qOut : Math.max(0, input.qOut - input.qZone)
      const area = Math.PI * (p.dn / 2000) ** 2
      out.set(p.id, { q, p: input.entryHead + 1.5, v: q / 3600 / area, supplied: input.qOut > 1 })
    } else if (p.kind === 'raw') {
      const area = Math.PI * (p.dn / 2000) ** 2
      out.set(p.id, { q: input.qRaw, p: input.qRaw > 1 ? 32 : 2, v: input.qRaw / 3600 / area, supplied: input.qRaw > 1 })
    } else if (p.kind === 'service') {
      continue // below, tree by tree
    } else {
      const st = out.get('TM-02')
      out.set(p.id, { q: input.qZone, p: input.entryHead, v: 0.5, supplied: (st?.supplied ?? true) && input.entryHead > 3 })
    }
  }
  // service trees: the saddle takes the pressure of its distribution pipe; each pipe carries the demand of the
  // service length behind it (the zone's demand is drawn through the service pipes), Hazen-Williams on the PE bore
  const perM = input.qZone / Math.max(1, T.serviceTotal)
  const head = new Map<string, number>()
  for (const id of T.serviceOrder) {
    const p = PIPE_BY_ID[id]!
    const up = T.serviceUp.get(id)!
    const host = out.get(T.serviceHost.get(id)!)
    const supplied = !!host?.supplied
    const hUp = head.get(up) ?? (host ? Math.max(0, host.p - 0.3) : 0)
    const q = supplied ? perM * (T.serviceCarried.get(id) ?? p.len) : 0
    const h = supplied ? Math.max(0, hUp - hw(p.len, q, p.dn * 0.93, 150)) : 0
    head.set(up === p.from ? p.to! : p.from!, h)
    const area = Math.PI * ((p.dn * 0.82) / 2000) ** 2
    out.set(id, { q: up === p.from ? q : -q, p: h, v: q / 3600 / area, supplied })
  }
  for (const p of NET.pipes) if (p.kind === 'service' && !out.has(p.id)) out.set(p.id, { q: 0, p: 0, v: 0, supplied: false })
  return { pipes: out, minP: Number.isFinite(minP) ? minP : 0, maxP: Number.isFinite(maxP) ? maxP : 0, unsupplied }

  function downstreamNode(id: string) {
    const p = PIPE_BY_ID[id]!
    return T.dir.get(id) === 1 ? p.to! : p.from!
  }
}
