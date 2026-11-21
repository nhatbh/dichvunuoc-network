/**
 * Seating the catalog fittings on the drawn pipes (near level, L2), so a pipe goes into its fitting instead of through it.
 *
 * A fitting is placed at its node with the heading `orient` gave it and scaled to its pipe's drawn width. The catalog
 * says where its ports are (catalogPorts).
 *  - Seat: the fitting is shifted so its ports lie on the axes of the pipes they join. A bend's arc sits inside the
 *    corner of its two pipes, not on the corner point.
 *  - Cut: each pipe stops at the port that takes it, instead of running on to the node. That is where it enters the
 *    socket: at a pipe end, or on both sides of a bend inside a polyline.
 * A pipe is only cut where it really fits the socket (its axis through the port, its drawn width close to the port's).
 * Otherwise it runs on to the node and ends inside the fitting's body, which hides its end; an open end beside a
 * socket would show.
 * Parts inside a pipe run (valves, meters, a reducer or adapter placed along a pipe) and saddles are left as they are:
 * the pipe passes through them.
 */
import { catalogPorts } from '../three/catalog-mesh'
import type { XY } from '../data/geo'
import type { NetDevice } from '../data/network-devices'
import type { NetPipe } from '../data/network-model'

/** fittings that sit at a node and take the pipes ending there */
export const SEATED = new Set(['Tee', 'ReducingTee', 'Cross', 'Bend', 'Reducer', 'Cap', 'Coupling', 'Transition'])
/** a leg's direction is read this far from the node (m), so a small jog at a pipe end does not turn it */
const REACH = 2
/** a cut leaves at least this much of the pipe (m) */
const MARGIN = 0.1
/** a drawn pipe fits a socket when its radius is within this share of the port's */
const FIT = 0.25
/** a leg further than ~30° off its port is kept off that port but does not pull the seat */
const SOLVE_DOT = 0.87

/** how much of a pipe is cut away for the fittings at its ends and bends (metres along it) */
export interface PipeCuts {
  start: number
  end: number
  /** at an inner vertex: [cut on the side before it, cut on the side after it] */
  inner: Map<number, [number, number]>
}

interface LegRef {
  pipe: NetPipe
  /** unit direction from the node along the pipe */
  u: XY
  /** the pipe's own end (or vertex) relative to the node: cuts are measured from there, not from the node */
  e: XY
  /** the longest cut this side of the pipe allows */
  room: number
  /** the pipe's start, its end, or a vertex inside it (then `back` = the side before the vertex) */
  where: 'start' | 'end' | 'vertex'
  i: number
  back?: boolean
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
const unit = (from: XY, to: XY): XY => {
  const l = dist(from, to) || 1
  return [(to[0] - from[0]) / l, (to[1] - from[1]) / l]
}
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]

/** the pipes leaving a node: their ends there (the nearer one if both are), or the two sides of a vertex there */
function legsOf(at: XY, pipes: NetPipe[], tol: number): LegRef[] {
  const out: LegRef[] = []
  for (const p of pipes) {
    const path = p.path
    const n = path.length
    const len: number[] = [0]
    for (let i = 1; i < n; i++) len.push(len[i - 1]! + dist(path[i - 1]!, path[i]!))
    const total = len[n - 1]!
    /** the first vertex REACH away from the node, walking from `from` (else the last one off the node) */
    const away = (from: number, step: 1 | -1) => {
      let last: XY | null = null
      for (let i = from; i >= 0 && i < n; i += step) {
        const d = dist(path[i]!, at)
        if (d >= REACH) return path[i]!
        if (d > 0.05) last = path[i]!
      }
      return last
    }
    const leg = (o: XY, q: XY | null, rest: Omit<LegRef, 'pipe' | 'u' | 'e'>) => {
      if (q) out.push({ pipe: p, u: unit(at, q), e: [o[0] - at[0], o[1] - at[1]], ...rest })
    }
    const ds = dist(path[0]!, at)
    const de = dist(path[n - 1]!, at)
    if (ds <= tol && (ds <= de || de > tol)) leg(path[0]!, away(1, 1), { room: total - MARGIN, where: 'start', i: 0 })
    else if (de <= tol) leg(path[n - 1]!, away(n - 2, -1), { room: total - MARGIN, where: 'end', i: n - 1 })
    else {
      let best = -1
      for (let i = 1; i < n - 1; i++) if (dist(path[i]!, at) <= tol && (best < 0 || dist(path[i]!, at) < dist(path[best]!, at))) best = i
      if (best < 0) continue
      leg(path[best]!, away(best - 1, -1), { room: len[best]! - MARGIN, where: 'vertex', i: best, back: true })
      leg(path[best]!, away(best + 1, 1), { room: total - len[best]! - MARGIN, where: 'vertex', i: best, back: false })
    }
  }
  return out
}

/**
 * Where each seated fitting goes (its node shifted onto the pipe axes) and how much of each pipe its fittings cut away.
 * `scaleOf` is the scale the fitting is drawn at (its pipe's drawn width over the real one). `radiusOf` is a pipe's
 * drawn radius: without it a pipe is cut at any port it lines up with, whatever its width.
 */
export function seatFittings(devices: NetDevice[], pipes: NetPipe[], scaleOf: (d: NetDevice) => number, radiusOf?: (p: NetPipe) => number) {
  const seat = new Map<string, XY>()
  const cuts = new Map<string, PipeCuts>()
  const cutsOf = (id: string) => cuts.get(id) ?? cuts.set(id, { start: 0, end: 0, inner: new Map() }).get(id)!
  // pipes near each fitting, found through a coarse grid
  const CELL = 50
  const grid = new Map<string, NetPipe[]>()
  for (const p of pipes) {
    const keys = new Set<string>()
    for (const v of p.path) keys.add(`${Math.floor(v[0] / CELL)}:${Math.floor(v[1] / CELL)}`)
    for (const k of keys) (grid.get(k) ?? grid.set(k, []).get(k)!).push(p)
  }
  const near = (at: XY) => {
    const found = new Set<NetPipe>()
    const cx = Math.floor(at[0] / CELL)
    const cy = Math.floor(at[1] / CELL)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of grid.get(`${cx + i}:${cy + j}`) ?? []) found.add(p)
    return [...found]
  }
  const plans: Array<{ d: NetDevice; matched: number; at: XY; cut: Array<{ leg: LegRef; along: number }> }> = []
  for (const d of devices) {
    if (!d.onPipe || !SEATED.has(d.code)) continue
    const legs = legsOf(d.at, near(d.at), 1)
    if (!legs.length) continue
    const k = scaleOf(d)
    const c = Math.cos(d.heading)
    const s = Math.sin(d.heading)
    const ports = catalogPorts(d.code, d.dn, d.dn2, d.angle).map(p => ({
      at: [(p.pos.x * c - p.pos.y * s) * k, (p.pos.x * s + p.pos.y * c) * k] as XY,
      dir: [p.dir.x * c - p.dir.y * s, p.dir.x * s + p.dir.y * c] as XY,
      r: (k * p.dn) / 2000,
    }))
    // best pairs first over all legs and ports: a leg that fits one port exactly is not robbed of it by a leg read earlier
    const cand: Array<{ li: number; pi: number; dot: number }> = []
    legs.forEach((leg, li) =>
      ports.forEach((p, pi) => {
        const f = dot(p.dir, leg.u)
        if (f > 0.5) cand.push({ li, pi, dot: f })
      }),
    )
    cand.sort((a, b) => b.dot - a.dot)
    const usedLeg = new Set<number>()
    const usedPort = new Set<number>()
    const pairs: Array<{ leg: LegRef; port: (typeof ports)[number]; dot: number }> = []
    for (const { li, pi, dot } of cand) {
      if (usedLeg.has(li) || usedPort.has(pi)) continue
      usedLeg.add(li)
      usedPort.add(pi)
      pairs.push({ leg: legs[li]!, port: ports[pi]!, dot })
    }
    if (!pairs.length) continue
    // shift t that puts every matched port on its pipe's axis (least squares: cross(port + t − e, u) = 0)
    let a11 = 0
    let a12 = 0
    let a22 = 0
    let b1 = 0
    let b2 = 0
    for (const { leg, port } of pairs.filter(p => p.dot >= SOLVE_DOT)) {
      const r: XY = [leg.u[1], -leg.u[0]]
      const rhs = -cross([port.at[0] - leg.e[0], port.at[1] - leg.e[1]], leg.u)
      a11 += r[0] * r[0]
      a12 += r[0] * r[1]
      a22 += r[1] * r[1]
      b1 += r[0] * rhs
      b2 += r[1] * rhs
    }
    // truncated solve in the axes of the normal equations: a direction the legs barely constrain (along a run that is
    // straight within ~25°) takes no shift, since solving it exactly would throw the fitting metres along the run
    const tr = a11 + a22
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - (a11 * a22 - a12 * a12)))
    const l2 = tr - l1
    let v: XY = Math.abs(a12) > 1e-12 ? [a12, l1 - a11] : a11 >= a22 ? [1, 0] : [0, 1]
    const vl = Math.hypot(v[0], v[1]) || 1
    v = [v[0] / vl, v[1] / vl]
    const w: XY = [-v[1], v[0]]
    const f1 = l1 > 1e-9 ? (v[0] * b1 + v[1] * b2) / l1 : 0
    const f2 = l2 > 0.05 * l1 ? (w[0] * b1 + w[1] * b2) / l2 : 0
    let t: XY = [v[0] * f1 + w[0] * f2, v[1] * f1 + w[1] * f2]
    if (d.code === 'Cap') t = [0, 0]
    /** how far along its pipe (from the pipe's own end) a port lands with the shift */
    const alongOf = (leg: LegRef, port: XY, sh: XY) => dot([port[0] + sh[0] - leg.e[0], port[1] + sh[1] - leg.e[1]], leg.u)
    // a shift longer than the fitting, or one that puts a port behind its pipe's end, is a misread: keep the node
    const reach = Math.max(...ports.map(p => Math.hypot(p.at[0], p.at[1])))
    if (Math.hypot(t[0], t[1]) > reach || pairs.some(({ leg, port }) => alongOf(leg, port.at, t) < 0)) t = [0, 0]
    const cut: Array<{ leg: LegRef; along: number }> = []
    for (const { leg, port } of pairs) {
      // off its pipe's axis by more than the socket: cutting would leave a gap beside the socket
      if (Math.abs(cross([port.at[0] + t[0] - leg.e[0], port.at[1] + t[1] - leg.e[1]], leg.u)) > port.r) continue
      // a pipe much wider or thinner than the socket (a reducing tee scaled to its main) would show its open end
      if (radiusOf && Math.abs(port.r / radiusOf(leg.pipe) - 1) > FIT) continue
      const along = Math.min(leg.room, alongOf(leg, port.at, t))
      if (along > 0.01) cut.push({ leg, along })
    }
    plans.push({ d, matched: pairs.length, at: [d.at[0] + t[0], d.at[1] + t[1]], cut })
  }
  // two fittings on one node would both cut its pipes: only the one that takes more of them is seated
  plans.sort((a, b) => b.matched - a.matched)
  const taken = new Map<string, XY[]>()
  const cell = (x: number, y: number) => `${Math.floor(x / 0.5)}:${Math.floor(y / 0.5)}`
  for (const p of plans) {
    const [x, y] = p.d.at
    let clash = false
    for (let i = -1; i <= 1 && !clash; i++) for (let j = -1; j <= 1 && !clash; j++) clash = (taken.get(cell(x + i * 0.5, y + j * 0.5)) ?? []).some(q => dist(q, p.d.at) < 0.3)
    if (clash) continue
    const key = cell(x, y)
    ;(taken.get(key) ?? taken.set(key, []).get(key)!).push(p.d.at)
    seat.set(p.d.id, p.at)
    for (const { leg, along } of p.cut) {
      const cu = cutsOf(leg.pipe.id)
      if (leg.where === 'start') cu.start = Math.max(cu.start, along)
      else if (leg.where === 'end') cu.end = Math.max(cu.end, along)
      else {
        const cur = cu.inner.get(leg.i) ?? [0, 0]
        cur[leg.back ? 0 : 1] = Math.max(cur[leg.back ? 0 : 1], along)
        cu.inner.set(leg.i, cur)
      }
    }
  }
  return { seat, cuts }
}

/**
 * A pipe's path with its fittings cut away: shortened at its ends, split at its bends. Each part tells whether its ends
 * are the pipe's own (closed with a half ball) or go into a fitting (left open, inside the socket).
 */
export function cutPath(path: XY[], cuts: PipeCuts | undefined): Array<{ path: XY[]; capStart: boolean; capEnd: boolean; d0: number }> {
  if (!cuts) return [{ path, capStart: true, capEnd: true, d0: 0 }]
  const len: number[] = [0]
  for (let i = 1; i < path.length; i++) len.push(len[i - 1]! + dist(path[i - 1]!, path[i]!))
  const total = len[len.length - 1]!
  /** the point `m` metres along the path */
  const at = (m: number): XY => {
    let i = 1
    while (i < path.length - 1 && len[i]! < m) i++
    const a = path[i - 1]!
    const b = path[i]!
    const span = len[i]! - len[i - 1]! || 1
    const f = Math.min(1, Math.max(0, (m - len[i - 1]!) / span))
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  }
  // the stretches to keep, between the cuts
  const marks: Array<{ from: number; to: number; open: [boolean, boolean] }> = []
  let from = cuts.start
  let openStart = cuts.start > 0
  const inner = [...cuts.inner.entries()].sort((a, b) => a[0] - b[0])
  for (const [i, [before, after]] of inner) {
    marks.push({ from, to: len[i]! - before, open: [openStart, true] })
    from = len[i]! + after
    openStart = true
  }
  marks.push({ from, to: total - cuts.end, open: [openStart, cuts.end > 0] })
  const out: Array<{ path: XY[]; capStart: boolean; capEnd: boolean; d0: number }> = []
  const h = Math.min(0.05, total / 2)
  for (const m of marks) {
    let a = Math.max(0, m.from)
    let b = Math.min(total, m.to)
    if (b - a < 0.1) {
      // the fittings would meet: keep a short stretch in the middle so the pipe still shows between them; the middle
      // is held inside the pipe, else both ends land on one end point and the piece vanishes
      const mid = Math.min(total - h, Math.max(h, (m.from + m.to) / 2))
      a = mid - h
      b = mid + h
    }
    const pts: XY[] = [at(a)]
    for (let i = 1; i < path.length - 1; i++) if (len[i]! > a && len[i]! < b) pts.push(path[i]!)
    pts.push(at(b))
    out.push({ path: pts, capStart: !m.open[0], capEnd: !m.open[1], d0: a })
  }
  return out
}
