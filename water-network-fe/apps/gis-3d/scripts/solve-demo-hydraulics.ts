/**
 * Solves the demo network with EPANET and writes src/shared/api/mocks/demo-hydraulics.json.
 * Run with `npm run demo:hydraulics` after changing the network generator.
 *
 * 1. Sizing: pipes that would run faster than 1.5 m/s or lose more than 6 m/km at the peak hour get
 *    the DN that carries their flow at ≤ 1.2 m/s and ≤ 3 m/km (a designed network), until stable.
 * 2. Orientation: a snapshot without PRVs / check valves / boosters gives each pipe's natural flow
 *    direction; those devices are then added the way the water actually flows.
 * 3. Operation, on healthy 24 h runs: the elevated tank's floor moves until it ends the day where it
 *    started, the ground reservoir pump is re-rated to its design flow and refills overnight what it
 *    pumped out, and each DMA's PRV is set so its critical point keeps 15 m at the worst hour.
 * 4. The day itself: a 24 h run (15 min) with a burst and a background leak gives every logger, bulk
 *    meter and level sensor its readings; the same day without them gives what each should read, and
 *    the difference sets device status. Every DMA gets its water balance (inflow = use + storage).
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dnFor, roughness, unitHeadloss, type DemoEvent, type DemoHydraulics } from '../src/shared/api/mocks/demo-hydraulics'
import { buildLegacyFullSeed } from '../src/shared/api/mocks/legacy-full-seed'
import { DISPLAY_HOUR, runExtendedPeriod, solveHydraulics } from '../src/shared/lib/hydraulics/epanet-flow'
import { DEMAND_PATTERN, GROUND_FILL_HOURS, GROUND_PUMP_HOURS, GROUND_PUMP_LPS, fractionAlong, type LeakEvent, type ModelInput } from '../src/shared/lib/hydraulics/network-model'

type Pt = [number, number]
type Rec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const OUT = resolve(__dirname, '../src/shared/api/mocks/demo-hydraulics.json')
const OUT_HOURLY = resolve(__dirname, '../src/shared/api/mocks/demo-network-hourly.json')
const FILL_HOURS = (GROUND_FILL_HOURS[1] + 24 - GROUND_FILL_HOURS[0]) % 24
/** Lowest pressure a customer tap should see at the worst hour (m). */
const SERVICE_PRESSURE_M = 15
const PRV_SETTING_M = 32
const steps24 = (r: { steps: Array<{ t: number; tankLevel: Record<string, number> }> }, id: string) => r.steps[r.steps.length - 1]!.tankLevel[id]!
const PEAK_HOUR = DEMAND_PATTERN.indexOf(Math.max(...DEMAND_PATTERN))
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d
const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
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

async function main() {
  // ── 1. sizing ──
  const base = buildLegacyFullSeed(undefined, { hydraulics: null }) as Rec
  const signature = base.networkSignature as string // as the builder computed it, before DMA sectorisation
  const resize: Record<string, number> = {}
  for (let pass = 1; pass <= 12; pass++) {
    const seed = buildLegacyFullSeed(undefined, { hydraulics: { signature, resize } as unknown as DemoHydraulics }) as Rec
    const flows = await solveHydraulics(seed as never, { snapshotHour: PEAK_HOUR })
    let changed = 0
    for (const p of seed.pipes as Rec[]) {
      const f = flows.get(p.id)
      if (!f || (f.velocity <= 1.5 && unitHeadloss(f.flowLps, p.dn, p.material) <= 6)) continue
      const dn = dnFor(f.flowLps, 1.2, 3, roughness(p.material))
      if (dn > p.dn) {
        resize[p.id] = dn
        changed++
      }
    }
    console.log(`sizing pass ${pass}: ${changed} pipes upsized`)
    if (!changed) break
  }

  // ── 2. orientation, events ──
  const seed = buildLegacyFullSeed(undefined, { hydraulics: { signature, resize } as unknown as DemoHydraulics }) as Rec
  const natural = await solveHydraulics(seed as never, { snapshotHour: DISPLAY_HOUR })
  const orientation = new Map<string, 1 | -1>([...natural].map(([id, f]) => [id, f.flowDir === 'forward' ? 1 : -1]))
  const devices = seed.sourceDevices as Rec[]
  const nodes = seed.nodes as Rec[]
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const dmas = seed.dmas as Array<{ id: string; poly: Pt[] }>
  // leaks happen on distribution pipes, not on the transmission mains
  const onMain = new Set<string>()
  for (const p of seed.pipes as Rec[]) if ((p.baseDn ?? p.dn) >= 400) [p.from, p.to].forEach(n => n && onMain.add(n))
  const nearestNode = (x: number, y: number, dma?: string) =>
    nodes.filter(n => !dma || (n.dma === dma && !onMain.has(n.id))).reduce((m: Rec | null, n) => (!m || Math.hypot(n.x - x, n.y - y) < Math.hypot(m.x - x, m.y - y) ? n : m), null)!
  const critical3 = devices.find(d => d.deviceType === 'PressureSensor' && d.name.includes('bất lợi DMA-03'))!
  // the burst is in the part of DMA-03 fed through its main (metered) inlet, so the DMA meter sees it:
  // walk the open distribution pipes from that inlet and take the node nearest the critical-point logger
  const burstNode = (() => {
    const inlet = (seed.dmaInlets as Array<{ dma: string; pipe: string; main: boolean }>).find(i => i.dma === 'DMA-03' && i.main)
    const inletPipe = inlet ? (seed.pipeBy as Rec)[inlet.pipe] : undefined
    if (!inletPipe) return nearestNode(critical3.x, critical3.y, 'DMA-03')
    const dist = (seed.pipes as Rec[]).filter(p => !p.noFlow && (p.baseDn ?? p.dn) < 400 && p.status !== 'planned' && p.status !== 'abandoned')
    const adj = new Map<string, string[]>()
    for (const p of dist) for (const [a, b] of [[p.from, p.to], [p.to, p.from]]) if (a && b) (adj.get(a) ?? adj.set(a, []).get(a)!).push(b)
    const seen = new Set<string>([inletPipe.from, inletPipe.to].filter(Boolean))
    const queue = [...seen]
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n) && !onMain.has(n)) { seen.add(n); queue.push(n) }
    const island = nodes.filter(n => seen.has(n.id) && n.dma === 'DMA-03' && !onMain.has(n.id))
    return island.reduce((m: Rec | null, n) => (!m || Math.hypot(n.x - critical3.x, n.y - critical3.y) < Math.hypot(m.x - critical3.x, m.y - critical3.y) ? n : m), null) ??
      nearestNode(critical3.x, critical3.y, 'DMA-03')
  })()
  const dma5 = dmas.find(d => d.id === 'DMA-05')!
  const c5 = dma5.poly.reduce((s, p) => [s[0] + p[0] / dma5.poly.length, s[1] + p[1] / dma5.poly.length], [0, 0])
  const leakNode = nearestNode(c5[0], c5[1], 'DMA-05')
  const events: LeakEvent[] = [
    { kind: 'burst', nodeId: burstNode.id, lps: 3, fromHour: 14 },
    { kind: 'background', nodeId: leakNode.id, lps: 4 },
  ]

  // ── 3. 24 h run: first passes find the grade line at the storage sites and how much the ground
  //    reservoir pumps out; the storage then floats on that grade line and refills what it gave ──
  const storage: Record<string, { floorM?: number; pumpHeadM?: number; fillLps?: number }> = {}
  const pumpSteps = (k: number) => GROUND_PUMP_HOURS.some(([a, b]) => k >= a * 4 && k < b * 4)
  const prvSettings: Record<string, number> = {}
  const dmaOf = new Map(nodes.map(n => [n.id as string, n.dma as string]))
  for (let pass = 0; pass < 12; pass++) {
    const r = await runExtendedPeriod(seed as ModelInput, { orientation, events: [], storage, prvSettings })
    const rIdx = new Map(r.linkIds.map((id, i) => [id, i]))
    const rn = new Map(r.nodeIds.map((id, i) => [id, i]))
    const day = r.steps.slice(0, 96)
    for (const t of r.model.tanks) {
      const i = rn.get(t.node)!
      const z = r.model.junctions.get(t.node)!.z
      const levels = day.map(x => x.tankLevel[t.id]!)
      if (t.kind === 'elevated') {
        // floats on the grade line: start half full on an average hour, then move the floor by the
        // day's drift until the tank ends the day where it started
        const p = day.map(x => x.pressure[i]!)
        const mean = p.reduce((a, b) => a + b, 0) / p.length
        const floorM = storage[t.id]?.floorM ?? z + mean - 4.5
        const drift = steps24(r, t.id) - t.initLevel
        const empty = levels.filter(l => l <= 1.05).length / 4 // hours spent empty
        const full = levels.filter(l => l >= 7.95).length / 4 // hours spent full
        storage[t.id] = { floorM: round(floorM + 0.7 * drift - 0.4 * empty + 0.4 * full, 2) }
        continue
      }
      // a single-point pump curve gives H = 4/3·H0·(1 − (Q/2Q0)²): re-rate it so it delivers its design flow
      const pump = rIdx.get(`${t.id}-PUMP`)!
      const on = day.filter((_, k) => pumpSteps(k)).map(x => x.flow[pump]!)
      const q = on.reduce((a, b) => a + b, 0) / on.length
      const h0 = storage[t.id]?.pumpHeadM ?? 45
      const head = round((4 / 3) * h0 * (1 - (q / (2 * GROUND_PUMP_LPS)) ** 2), 1)
      const pumped = on.reduce((a, b) => a + Math.max(0, b), 0) / 4 // L/s·h
      storage[t.id] = { pumpHeadM: Math.max(head, 5), fillLps: round(pumped / FILL_HOURS, 1) }
    }
    // each DMA's PRV is set so its critical point keeps the service pressure at the worst hour
    const worst: Record<string, number> = {}
    for (const x of day) for (const [id, i] of rn) {
      const d = dmaOf.get(id)
      if (d && (worst[d] === undefined || x.pressure[i]! < worst[d]!)) worst[d] = x.pressure[i]!
    }
    for (const [d, p] of Object.entries(worst)) {
      const cur = prvSettings[d] ?? PRV_SETTING_M
      prvSettings[d] = round(Math.min(Math.max(cur + (SERVICE_PRESSURE_M - p), 20), 45), 1)
    }
    console.log(`storage pass ${pass + 1}:`, JSON.stringify(storage), 'worst', JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, round(v, 1)]))))
  }
  const eps = await runExtendedPeriod(seed as ModelInput, { orientation, events, storage, prvSettings })
  // the same day without the burst and the leak: what each device would read on a healthy network
  const healthy = await runExtendedPeriod(seed as ModelInput, { orientation, events: [], storage, prvSettings })
  // yesterday: the background leak was already there, the burst was not, and demand was 3 % lower
  const yesterdayRun = await runExtendedPeriod(seed as ModelInput, {
    orientation,
    events: events.filter(e => e.kind === 'background'),
    storage,
    prvSettings,
    demandLps: 0.12 * 0.97,
  })
  const { model, nodeIds, linkIds, steps } = eps
  const nIdx = new Map(nodeIds.map((id, i) => [id, i]))
  const lIdx = new Map(linkIds.map((id, i) => [id, i]))
  const show = steps.find(s => s.t === DISPLAY_HOUR * 3600)!
  // statistics over the GIS nodes (not the helper junctions inside valve and pump stations)
  const juncs = nodes.map(n => n.id as string).filter(id => nIdx.has(id))

  // results at the display hour
  const pipes: DemoHydraulics['pipes'] = {}
  for (const [pid, { link, flip }] of model.pipeLinks) {
    const i = lIdx.get(link)
    if (i === undefined) continue
    pipes[pid] = [round(show.flow[i]! * (flip ? -1 : 1), 2), round(show.velocity[i]!, 3)]
  }
  const nodePressure: DemoHydraulics['nodes'] = {}
  for (const n of nodes) {
    const i = nIdx.get(n.id)
    if (i !== undefined) nodePressure[n.id] = round(show.pressure[i]!, 1)
  }

  // ── DMAs: which junctions are inside each, and the links that cross its boundary ──
  // DMA membership follows the sectorisation: junctions on a transmission main are outside every DMA,
  // the rest take their GIS node's DMA (or the polygon they sit in), and a tank the DMA of its node
  const trunkNodes = new Set<string>()
  for (const [pid, e] of model.pipeEnds) {
    const p = (seed.pipeBy as Rec)[pid]
    if (p && (p.baseDn ?? p.dn) >= 400) [e.a, e.b].forEach(n => trunkNodes.add(n))
  }
  const dmaOfNode = new Map<string, string>()
  const dmaAt = (id: string): string | undefined => {
    if (trunkNodes.has(id)) return undefined
    const gis = nodeById.get(id)
    if (gis?.dma) return gis.dma
    const j = model.junctions.get(id)
    return j ? dmas.find(x => inPoly([j.x, j.y], x.poly))?.id : undefined
  }
  for (const id of nodeIds) {
    const t = model.tanks.find(x => x.id === id)
    const d = dmaAt(t ? t.node : id)
    if (d) dmaOfNode.set(id, d)
  }
  const ends: Array<[number, number]> = []
  {
    // EPANET link → node indices, from the INP sections
    const byLink = new Map<string, [string, string]>()
    let section = ''
    for (const line of model.inp.split('\n')) {
      if (line.startsWith('[')) section = line
      else if (/^\[(PIPES|PUMPS|VALVES)\]$/.test(section) && line.trim()) {
        const [id, a, b] = line.trim().split('\t')
        byLink.set(id!, [a!, b!])
      }
    }
    for (const id of linkIds) {
      const [a, b] = byLink.get(id)!
      ends.push([nIdx.get(a)!, nIdx.get(b)!])
    }
  }
  const tankIds = new Set(model.tanks.map(t => t.id))
  type Step = (typeof steps)[number]
  /** Net flow across the DMA boundary into it (L/s). */
  const inflowOf = (dma: string, s: Step) => {
    let q = 0
    ends.forEach(([a, b], i) => {
      const da = dmaOfNode.get(nodeIds[a]!) === dma
      const db = dmaOfNode.get(nodeIds[b]!) === dma
      if (da !== db) q += db ? s.flow[i]! : -s.flow[i]!
    })
    return q
  }
  /** Consumption + leakage (tanks: false) or flow into storage (tanks: true) inside the DMA (L/s); EPANET's demand at a tank is the water going into it. */
  const usedIn = (dma: string, s: Step, tanks: boolean) => {
    let q = 0
    nodeIds.forEach((id, i) => {
      if (dmaOfNode.get(id) === dma && tankIds.has(id) === tanks) q += s.demand[i]!
    })
    return q
  }
  /** What the utility sees of a DMA's use: metered inflow less what went into its tanks (L/s, hourly means). */
  const netUse = (dma: string, run: Step[]) =>
    Array.from({ length: 24 }, (_, h) => run.slice(h * 4, h * 4 + 4).reduce((a, s) => a + inflowOf(dma, s) - usedIn(dma, s, true), 0) / 4)
  // a burst is a step that stays; a background leak is there all night
  const leakVerdict = (excessLps: number[], baseLps: number, fromHour = 14): DemoHydraulics['status'][string] => {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const limit = Math.max(0.03 * baseLps, 0.5) // 3 % of the flow or 0.5 L/s
    const night = mean(excessLps.slice(2, 4)) // 02:00–04:00
    const before = mean(excessLps.slice(fromHour - 4, fromHour))
    const after = mean(excessLps.slice(fromHour + 1))
    return after - before > limit ? 'critical' : night > limit ? 'warning' : 'normal'
  }

  // telemetry
  const pressureAt = (s: (typeof steps)[number], d: Rec): number => {
    if (d.hostNodeId && nIdx.has(d.hostNodeId)) return s.pressure[nIdx.get(d.hostNodeId)!]!
    const ends = d.hostPipeId ? model.pipeEnds.get(d.hostPipeId) : undefined
    const pipe = d.hostPipeId ? (seed.pipeBy as Rec)[d.hostPipeId] : undefined
    if (ends && pipe && nIdx.has(ends.a) && nIdx.has(ends.b)) {
      const t = fractionAlong(pipe.pts, d)
      return s.pressure[nIdx.get(ends.a)!]! * (1 - t) + s.pressure[nIdx.get(ends.b)!]! * t
    }
    return s.pressure[nIdx.get(nearestNode(d.x, d.y).id)!]!
  }
  const flowOn = (s: (typeof steps)[number], pipeId: string) => {
    const m = model.pipeLinks.get(pipeId)
    const i = m ? lIdx.get(m.link) : undefined
    return i === undefined ? 0 : Math.abs(s.flow[i]!)
  }
  const day = steps.slice(0, 96)
  const healthyDay = healthy.steps.slice(0, 96)
  const yesterdayDay = yesterdayRun.steps.slice(0, 96)
  const start = `${seed.TODAY ?? '2026-06-23'}T00:00:00+07:00`
  const telemetry: DemoHydraulics['telemetry'] = {}
  const status: DemoHydraulics['status'] = {}
  // two field units with a flat battery / lost link (not in the DMAs where the leaks are)
  const eventDmas = new Set(events.map(e => nodeById.get(e.nodeId)!.dma))
  const offline = new Set(
    devices.filter(d => (d.deviceType === 'PressureSensor' || d.deviceType === 'RTU') && !eventDmas.has(d.dma)).sort((a, b) => hash01(a.id) - hash01(b.id)).slice(0, 2).map(d => d.id)
  )
  const burstAt = nodeById.get(burstNode.id)!
  for (const d of devices) {
    if (d.deviceType === 'PressureSensor') {
      const values = day.map(s => round(Math.max(0, pressureAt(s, d)) / 10.2, 2))
      const expected = healthyDay.map(s => round(Math.max(0, pressureAt(s, d)) / 10.2, 2))
      const yesterday = yesterdayDay.map(s => round(Math.max(0, pressureAt(s, d)) / 10.2, 2))
      telemetry[d.id] = { unit: 'bar', intervalMin: 15, start, values, expected, yesterday, low: 1.0, high: 6 }
      const min = Math.min(...values)
      const loss = Math.max(...values.map((v, k) => expected[k]! - v)) // pressure the leaks took away
      status[d.id] = min < 1.0 || loss >= 0.2 ? 'critical' : min < 1.2 || loss >= 0.08 ? 'warning' : 'normal'
    } else if (d.deviceType === 'BulkMeter' && d.hostPipeId) {
      // the plant's outlet meter reads everything the high-lift pumps send out
      const read = (s: (typeof steps)[number]) => (d.plant ? s.flow[lIdx.get('PLANT-PUMP')!]! : flowOn(s, d.hostPipeId))
      const values = day.map(s => round(read(s) * 3.6, 1))
      const expected = healthyDay.map(s => round(read(s) * 3.6, 1))
      const yesterday = yesterdayDay.map(s => round(read(s) * 3.6, 1))
      telemetry[d.id] = { unit: 'm³/h', intervalMin: 15, start, values, expected, yesterday }
      const fromHour = events.find(e => e.kind === 'burst')?.fromHour
      if (d.main) {
        // the DMA meter: the whole DMA's use (all its inlets, less what its tanks stored) against the healthy day
        const net = netUse(d.dma, day)
        const base = netUse(d.dma, healthyDay)
        status[d.id] = leakVerdict(net.map((q, h) => q - base[h]!), Math.max(...base), fromHour)
      } else if (d.inlet) {
        const hourlyOf = (v: number[]) => Array.from({ length: 24 }, (_, h) => v.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0) / 4 / 3.6)
        const base = hourlyOf(expected)
        const now = hourlyOf(values)
        status[d.id] = leakVerdict(now.map((q, h) => q - base[h]!), Math.max(...base), fromHour)
      }
    } else if (d.deviceType === 'LevelSensor') {
      const tank = model.tanks.reduce((m: (typeof model.tanks)[number] | null, t) => {
        const tj = model.junctions.get(t.node)!
        return !m || Math.hypot(tj.x - d.x, tj.y - d.y) < Math.hypot(model.junctions.get(m.node)!.x - d.x, model.junctions.get(m.node)!.y - d.y) ? t : m
      }, null)
      if (tank) {
        const values = day.map(s => round(s.tankLevel[tank.id] ?? 0, 2))
        const low = tank.kind === 'ground' ? 0.8 : 1.5
        const high = tank.maxLevel - 0.3
        const yesterday = yesterdayDay.map(s => round(s.tankLevel[tank.id] ?? 0, 2))
        const expected = healthyDay.map(s => round(s.tankLevel[tank.id] ?? 0, 2))
        telemetry[d.id] = { unit: 'm', intervalMin: 15, start, values, expected, yesterday, low, high }
        status[d.id] = Math.min(...values) < low || Math.max(...values) > high ? 'warning' : 'normal'
      }
    } else if (d.deviceType === 'AcousticLogger') {
      // loggers within earshot of the burst hear it
      status[d.id] = d.dma === 'DMA-03' && Math.hypot(d.x - burstAt.x, d.y - burstAt.y) < 600 ? 'warning' : 'normal'
    }
    if (!status[d.id]) status[d.id] = 'normal'
    if (offline.has(d.id)) {
      status[d.id] = 'offline'
      const t = telemetry[d.id]
      if (t) {
        t.values = t.values.slice(0, 40)
        delete t.expected
      }
    }
  }

  const hourly = (f: (s: (typeof steps)[number]) => number) =>
    Array.from({ length: 24 }, (_, h) => round(day.slice(h * 4, h * 4 + 4).reduce((a, s) => a + f(s), 0) / 4, 1))
  const balance: DemoHydraulics['summary']['dmas'] = dmas.map(d => {
    const inflowLps = hourly(s => inflowOf(d.id, s))
    const demandLps = hourly(s => usedIn(d.id, s, false))
    const healthyDemandLps = Array.from({ length: 24 }, (_, h) => round(healthyDay.slice(h * 4, h * 4 + 4).reduce((a, s) => a + usedIn(d.id, s, false), 0) / 4, 1))
    const pressures = juncs.filter(id => dmaOfNode.get(id) === d.id).map(id => show.pressure[nIdx.get(id)!]!)
    return {
      id: d.id,
      inflowLps,
      demandLps,
      storageLps: hourly(s => usedIn(d.id, s, true)),
      mnfLps: Math.min(...demandLps.slice(2, 4)),
      mnfBaselineLps: Math.min(...healthyDemandLps.slice(2, 4)),
      minPressureM: round(Math.min(...pressures), 1),
    }
  })
  // inflow = consumption + leakage + water put into storage, every hour in every DMA
  const balanceError = Math.max(
    ...balance.flatMap(b => b.inflowLps.map((q, h) => Math.abs(q - b.demandLps[h]! - b.storageLps[h]!) / Math.max(b.demandLps[h]!, 1)))
  )
  const plantIdx = lIdx.get('PLANT-PUMP')!
  const plantLps = hourly(s => s.flow[plantIdx]!)
  // ── production: what the planner screen needs, by hour ──
  const plantNode = nIdx.get(model.plant!.node)!
  const tankIdx = model.tanks.map(t => nIdx.get(t.id)!).filter(i => i !== undefined)
  const criticalLoggers = devices.filter(d => d.deviceType === 'PressureSensor' && /bất lợi|điểm cao/.test(d.name))
  const hourlyOf = (run: typeof steps, f: (s: (typeof steps)[number]) => number) =>
    Array.from({ length: 24 }, (_, h) => round(run.slice(h * 4, h * 4 + 4).reduce((a, x) => a + f(x), 0) / 4, 2))
  const productionPlan = {
    /** Plant outlet pressure (m) by hour. */
    outletPressureM: hourlyOf(day, s => s.pressure[plantNode]!),
    /** Plant outflow on the healthy day (L/s) by hour: the demand forecast's base. */
    healthyPlantLps: hourlyOf(healthyDay, s => s.flow[plantIdx]!),
    /** Plant outflow yesterday (L/s) by hour. */
    yesterdayPlantLps: hourlyOf(yesterdayDay, s => s.flow[plantIdx]!),
    /** Net flow into storage (L/s, negative while tanks supply) by hour. */
    storageLps: hourlyOf(day, s => tankIdx.reduce((a, i) => a + s.demand[i]!, 0)),
    /** Lowest pressure (m) among the critical-point loggers, by hour. */
    criticalMinM: hourlyOf(day, s => Math.min(...criticalLoggers.map(d => pressureAt(s, d)))),
    /** Lowest pressure (m) at any GIS node, by hour. */
    networkMinM: hourlyOf(day, s => Math.min(...juncs.map(id => s.pressure[nIdx.get(id)!]!))),
    criticalLoggers: criticalLoggers.map(d => d.id as string),
  }
  // ── the network at every hour (for the time slider), compact: dm, 0.1 L/s, cm/s ──
  {
    const pipeIds = [...model.pipeLinks.keys()].filter(id => lIdx.has(model.pipeLinks.get(id)!.link))
    const nodeIdsGis = juncs
    const hours = Array.from({ length: 24 }, (_, h) => day[h * 4]!)
    const hourlyNet = {
      signature,
      nodes: nodeIdsGis,
      pipes: pipeIds,
      pressureDm: hours.map(s => nodeIdsGis.map(id => Math.round(s.pressure[nIdx.get(id)!]! * 10))),
      flowDl: hours.map(s => pipeIds.map(id => {
        const m = model.pipeLinks.get(id)!
        return Math.round(s.flow[lIdx.get(m.link)!]! * (m.flip ? -1 : 1) * 10)
      })),
      velocityCm: hours.map(s => pipeIds.map(id => Math.round(Math.abs(s.velocity[lIdx.get(model.pipeLinks.get(id)!.link)!]!) * 100))),
    }
    writeFileSync(OUT_HOURLY, JSON.stringify(hourlyNet))
    console.log(`wrote ${OUT_HOURLY} (${(JSON.stringify(hourlyNet).length / 1024).toFixed(0)} kB)`)
  }
  const customers = [...model.customerLps.values()].reduce((a, b) => a + b, 0)
  const leakage = [...model.leakLps.values()].reduce((a, b) => a + b, 0) + events.reduce((a, e) => a + e.lps * (e.kind === 'burst' ? (24 - (e.fromHour ?? 0)) / 24 : 1), 0)
  const production = (plantLps.reduce((a, b) => a + b, 0) / 24) * 86.4
  const peakP = juncs.map(id => show.pressure[nIdx.get(id)!]!).sort((a, b) => a - b)
  const out: DemoHydraulics = {
    signature,
    displayHour: DISPLAY_HOUR,
    resize,
    pipes,
    nodes: nodePressure,
    telemetry,
    status,
    summary: {
      productionM3d: round(production, 0),
      consumptionM3d: round(customers * 86.4, 0),
      leakageM3d: round(leakage * 86.4, 0),
      nrwPct: round(((production - customers * 86.4) / production) * 100, 1),
      plantLps,
      minPressureM: round(peakP[0]!, 1),
      medianPressureM: round(peakP[Math.floor(peakP.length / 2)]!, 1),
      maxVelocity: round(Math.max(...Object.values(pipes).map(p => p[1])), 2),
      tanks: Object.fromEntries(model.tanks.map(t => [t.id, Array.from({ length: 24 }, (_, h) => round(day[h * 4]!.tankLevel[t.id] ?? 0, 2))])),
      dmas: balance,
      balanceError: round(balanceError, 4),
      unsuppliedNodes: model.excluded.unsuppliedNodes.length,
      production: productionPlan,
    },
    events: events.map((e): DemoEvent => {
      const n = nodeById.get(e.nodeId)!
      const dma = n.dma as string
      const seenBy = devices
        .filter(d => d.dma === dma && ['BulkMeter', 'PressureSensor', 'AcousticLogger'].includes(d.deviceType) && status[d.id] !== 'normal')
        .map(d => d.id)
      return { ...e, dma, seenBy }
    }),
    settings: { storage, prvSettings, servicePressureM: SERVICE_PRESSURE_M },
  }
  writeFileSync(OUT, JSON.stringify(out))
  const s = out.summary
  console.log(`wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} kB)`)
  console.log(`production ${s.productionM3d} m³/d, consumption ${s.consumptionM3d}, leakage ${s.leakageM3d}, NRW ${s.nrwPct}%`)
  console.log(`pressure @${DISPLAY_HOUR}:00 min ${s.minPressureM} m, median ${s.medianPressureM} m; vmax ${s.maxVelocity} m/s; balance error ${s.balanceError}; unsupplied ${s.unsuppliedNodes}`)
  console.log('tanks', JSON.stringify(s.tanks))
  console.log('DMAs', s.dmas.map(d => `${d.id} in@8h ${d.inflowLps[8]} demand ${d.demandLps[8]} storage ${d.storageLps[8]} mnf ${d.mnfLps} pmin ${d.minPressureM}`).join('\n     '))
  console.log('warnings', eps.warnings.length, eps.warnings.slice(0, 6))
  for (const d of devices) if (status[d.id] !== 'normal') console.log('  ', status[d.id], d.deviceType, d.name)
  console.log('status', JSON.stringify(Object.values(status).reduce((m: Rec, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})))
}

main()
