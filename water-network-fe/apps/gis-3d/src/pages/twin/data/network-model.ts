/**
 * The pipe network on the integrated map, in the local metric frame (geo.ts):
 *  - distribution: the 43 pipes, 27 gate valves and 44 fittings of "1.MB-PP-Vinh Thinh - Dot 3.dwg" (CAD import);
 *  - service: the 746 D50/D63 service lines and 180 meter clusters of "2. MB Ong Dich vu- Vinh Thinh 123.dwg";
 *  - transmission (assumed route): D1000 steel from the plant's clean-water PS to the DN315 head of the
 *    network (the drawing's northern open end, where the main enters), continuing to the other zones;
 *  - raw water (assumed route): D600 steel from TB1 at the river to the plant's pond inlet (cửa xả cấp nước thô).
 *
 * `solveNetwork` turns the plant's outlet head + the zone's demand into a flow and a pressure for every pipe
 * (tree from the entry node, demand spread by pipe length, Hazen-Williams). Closed valves cut their subtree.
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

interface CadNet {
  network: {
    source: string
    pipes: Array<{ id: string; dn: number; mat: string; len: number; from: string | null; to: string | null; path: [number, number][] }>
    valves: Array<{ id: string; pipe: string | null; dn: number; at: [number, number] }>
    fittings: Array<{ id: string; kind: string; at: [number, number] }>
  }
  service: { source: string; lines: Array<{ dn: number; path: [number, number][] }>; meterClusters: [number, number][] }
}
const C = cad as unknown as CadNet

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
  // ── service lines ──
  C.service.lines.forEach((s, i) => {
    const path = s.path.map(L)
    pipes.push({
      id: `SV-${i + 1}`,
      code: `DV-${String(i + 1).padStart(4, '0')}`,
      kind: 'service',
      dn: s.dn,
      mat: 'HDPE',
      len: polylineLength(path),
      path,
      source: C.service.source,
    })
  })
  // ── transmission D1000 (assumed route) ──
  const s7 = R('S07')
  const outlet = plantToMap([s7.x0 - 1, s7.cy + 2.6])
  const exitW = plantToMap([PLANT.boundary.reduce((m, p) => Math.min(m, p[0]), 0) - 6, s7.cy + 2.6])
  const entry = L(ENTRY_LONLAT)
  const tm: XY[] = [outlet, exitW, [exitW[0] - 180, exitW[1] - 260], [entry[0] + 420, entry[1] + 820], [entry[0] + 120, entry[1] + 260], [entry[0] + 30, entry[1] + 40]]
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
  pipes.unshift({
    id: 'TM-02',
    code: 'D315-NV',
    kind: 'trunk',
    dn: 315,
    mat: 'HDPE',
    len: polylineLength([tm[tm.length - 1]!, entry]),
    path: [tm[tm.length - 1]!, entry],
    source: 'Đấu nối vào DN315 · giả định',
    assumed: true,
  })
  const onward: XY[] = [tm[tm.length - 2]!, [entry[0] + 700, entry[1] + 180], [entry[0] + 1500, entry[1] - 120]]
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
  // ── raw water D600 (assumed route) ──
  const inlet = plantToMap(PLANT.inletOutfall)
  const ia = INTAKE.origin
  const raw: XY[] = [
    [ia[0] + 12, ia[1] + 8],
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
  const meters: XY[] = C.service.meterClusters.map(L)
  return { pipes, valves, fittings, meters, entry }
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
  /** for each service line: the distribution pipe feeding it */
  serviceHost: Map<string, string>
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
  // service lines: nearest distribution pipe to their first vertex
  const serviceHost = new Map<string, string>()
  const segs: Array<{ id: string; a: XY; b: XY }> = []
  for (const p of dist0) for (let i = 1; i < p.path.length; i++) segs.push({ id: p.id, a: p.path[i - 1]!, b: p.path[i]! })
  for (const s of NET.pipes) {
    if (s.kind !== 'service') continue
    const pt = s.path[0]!
    let bd = Infinity
    let host = ''
    for (const g of segs) {
      const d = segDist(pt, g.a, g.b)
      if (d < bd) [bd, host] = [d, g.id]
    }
    serviceHost.set(s.id, host)
  }
  return { order, parent, dir, carried, total, serviceHost }
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
      const host = out.get(T.serviceHost.get(p.id) ?? '')
      const q = host?.supplied ? 0.4 + 1.6 * input.demandFactor * ((p.len % 7) / 7) : 0
      const area = Math.PI * ((p.dn * 0.82) / 2000) ** 2
      out.set(p.id, { q, p: host ? Math.max(0, host.p - 1.2) : 0, v: q / 3600 / area, supplied: host?.supplied ?? false })
    } else {
      const st = out.get('TM-02')
      out.set(p.id, { q: input.qZone, p: input.entryHead, v: 0.5, supplied: (st?.supplied ?? true) && input.entryHead > 3 })
    }
  }
  return { pipes: out, minP: Number.isFinite(minP) ? minP : 0, maxP: Number.isFinite(maxP) ? maxP : 0, unsupplied }

  function downstreamNode(id: string) {
    const p = PIPE_BY_ID[id]!
    return T.dir.get(id) === 1 ? p.to! : p.from!
  }
}
