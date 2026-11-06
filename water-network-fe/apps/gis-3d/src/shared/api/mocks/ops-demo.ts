/**
 * Demo data for the operations API, built from the seeded network and its EPANET day
 * (demo-hydraulics.json): sensors, readings with a baseline band and yesterday, leak events,
 * alarms, markers, DMA balances and the production plan. Pure, so it is tested without MSW.
 */
import { alarmsFor, bandAround } from '../ops-status'
import type {
  OpsAlarm,
  OpsDmaBalance,
  OpsEvent,
  OpsMarker,
  OpsPlanHour,
  OpsProduction,
  OpsSensor,
  OpsSeries,
  SensorKind,
} from '../ops-types'
import type { DemoHydraulics } from './demo-hydraulics'

type Rec = Record<string, unknown>
interface Device {
  id: string
  name: string
  deviceType: string
  dma?: string
  x: number
  y: number
  hostPipeId?: string
  hostNodeId?: string
  inlet?: boolean
  main?: boolean
  plant?: boolean
}

export interface OpsDemo {
  date: string
  sensors: OpsSensor[]
  series: Record<string, OpsSeries>
  events: OpsEvent[]
  alarms: OpsAlarm[]
  markers: OpsMarker[]
  dmaBalance: OpsDmaBalance[]
  production: OpsProduction
}

const KIND: Record<string, SensorKind> = { PressureSensor: 'pressure', BulkMeter: 'flow', LevelSensor: 'level' }
const BAND_MIN: Record<SensorKind, number> = { pressure: 0.05, flow: 1.8, level: 0.1 }
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0)

/** "23/06/2026" → "2026-06-23" (ISO dates pass through). */
export function isoDate(d: string | undefined): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(d ?? '')
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(d ?? '') ? d!.slice(0, 10) : '2026-06-23'
}
const nextDay = (iso: string) => {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}
/** Deterministic noise in [-1, 1]. */
const wobble = (i: number, seed: number) => Math.sin(i * 12.9898 + seed * 78.233) * 0.5 + Math.sin(i * 4.1 + seed) * 0.5

/** Pipe maximum: 6 bar on distribution, 8 bar where the logger sits on a main or a pump outlet. */
function highLimit(t: { unit: string; high?: number; expected?: number[]; values: number[] }): number {
  if (t.unit !== 'bar') return t.high!
  return Math.max(...(t.expected ?? t.values)) > 5 ? 8 : t.high!
}

export function buildOpsDemo(seed: Rec, hyd: DemoHydraulics): OpsDemo {
  const date = isoDate(seed.TODAY as string | undefined)
  const start = `${date}T00:00:00+07:00`
  const devices = (seed.sourceDevices as Device[]).filter(d => KIND[d.deviceType] && hyd.telemetry[d.id])
  const nodes = new Map((seed.nodes as Array<{ id: string; x: number; y: number }>).map(n => [n.id, n]))
  const critical = new Set(hyd.summary.production?.criticalLoggers ?? [])

  // ── sensors and their readings ──
  const sensors: OpsSensor[] = devices.map(d => {
    const t = hyd.telemetry[d.id]!
    return {
      id: d.id,
      name: d.name,
      kind: KIND[d.deviceType]!,
      deviceType: d.deviceType,
      dma: d.dma,
      unit: t.unit,
      x: d.x,
      y: d.y,
      ...(d.hostPipeId ? { hostPipeId: d.hostPipeId } : {}),
      ...(d.hostNodeId ? { hostNodeId: d.hostNodeId } : {}),
      ...(t.low !== undefined ? { low: t.low } : {}),
      ...(t.high !== undefined ? { high: highLimit(t) } : {}),
      ...(d.inlet ? { inlet: true } : {}),
      ...(d.main ? { main: true } : {}),
      ...(d.plant || /NMN/.test(d.name) ? { plant: true } : {}),
      ...(critical.has(d.id) ? { critical: true } : {}),
    }
  })
  const series: Record<string, OpsSeries> = {}
  for (const s of sensors) {
    const t = hyd.telemetry[s.id]!
    const out: OpsSeries = { sensorId: s.id, unit: t.unit, intervalMin: t.intervalMin, start, values: t.values }
    if (t.expected) {
      const band = bandAround(t.expected, BAND_MIN[s.kind], s.kind === 'flow' ? 1 : 2)
      Object.assign(out, { p50: t.expected, p10: band.p10, p90: band.p90 })
    }
    if (t.yesterday) out.yesterday = t.yesterday
    if (t.low !== undefined) out.low = t.low
    if (t.high !== undefined) out.high = highLimit(t)
    series[s.id] = out
  }

  // ── leak events: the sensors that show them, with the level the model gave them ──
  const sensorIds = new Set(sensors.map(s => s.id))
  const events: OpsEvent[] = hyd.events.map((e, i) => {
    const n = nodes.get(e.nodeId)
    return {
      id: `EV-${i + 1}`,
      kind: e.kind,
      dma: e.dma,
      nodeId: e.nodeId,
      x: n?.x ?? 0,
      y: n?.y ?? 0,
      lps: e.lps,
      fromSlot: (e.fromHour ?? 0) * 4,
      seenBy: e.seenBy
        .filter(id => sensorIds.has(id))
        .map(id => ({ sensorId: id, level: hyd.status[id] === 'critical' ? ('critical' as const) : ('warning' as const) })),
    }
  })

  // ── alarms ──
  const byId = new Map(sensors.map(s => [s.id, s]))
  const alarms = sensors
    .flatMap(s => alarmsFor(series[s.id]!, events, s.name))
    .sort((a, b) => b.startSlot - a.startSlot || (a.severity === 'critical' ? -1 : 1))

  // ── markers: one per leak event, one per sensor that stopped, and planned maintenance ──
  const at = (slot: number) => `${date}T${String(Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}:00+07:00`
  const markers: OpsMarker[] = []
  for (const e of events) {
    const meter = e.seenBy.find(s => byId.get(s.sensorId)?.kind === 'flow' && s.level === (e.kind === 'burst' ? 'critical' : 'warning')) ?? e.seenBy[0]
    const hours = e.kind === 'burst' ? 24 - e.fromSlot / 4 : 24
    markers.push({
      id: `MK-${e.id}`,
      kind: 'suspected_leak',
      title: e.kind === 'burst' ? `Nghi vỡ ống ${e.dma}` : `Rò rỉ ngầm ${e.dma} (lưu lượng đêm tăng)`,
      dma: e.dma,
      x: e.x,
      y: e.y,
      gisRef: e.nodeId,
      ...(meter ? { sensorId: meter.sensorId } : {}),
      origin: 'auto',
      state: 'suspected',
      severity: e.kind === 'burst' ? 'high' : 'medium',
      lossM3d: Math.round(e.lps * 3.6 * hours),
      ...(meter ? { evidence: { sensorId: meter.sensorId, fromSlot: e.kind === 'burst' ? e.fromSlot : 8, toSlot: e.kind === 'burst' ? 95 : 16 } } : {}),
      createdAt: at(e.kind === 'burst' ? e.fromSlot + 2 : 20),
      history: [{ state: 'suspected', at: at(e.kind === 'burst' ? e.fromSlot + 2 : 20), by: 'Quy tắc tự động' }],
    })
  }
  for (const s of sensors) {
    const n = series[s.id]!.values.length
    if (n >= 96) continue
    markers.push({
      id: `MK-SF-${s.id}`,
      kind: 'sensor_fault',
      title: `Mất tín hiệu: ${s.name}`,
      ...(s.dma ? { dma: s.dma } : {}),
      x: s.x,
      y: s.y,
      gisRef: s.hostNodeId ?? s.hostPipeId,
      sensorId: s.id,
      origin: 'auto',
      state: 'work_ordered',
      severity: 'low',
      evidence: { sensorId: s.id, fromSlot: Math.max(0, n - 8), toSlot: n },
      assignee: 'Tổ đo lường',
      workOrderRef: `WO-${s.id.replace('D-', '')}`,
      createdAt: at(n + 8),
      history: [
        { state: 'suspected', at: at(n + 8), by: 'Quy tắc tự động' },
        { state: 'work_ordered', at: at(n + 12), by: 'Điều độ' },
      ],
    })
  }
  const valves = (seed.valves as Array<{ id: string; code: string; x: number; y: number; dma: string; kind: string }>) ?? []
  const hydrants = (seed.hydrants as Array<{ id: string; code: string; x: number; y: number; dma: string; status: string }>) ?? []
  const planned: Array<{ title: string; ref?: { id: string; code?: string; x: number; y: number; dma?: string }; state: OpsMarker['state'] }> = [
    { title: 'Bảo dưỡng định kỳ van', ref: valves.find(v => v.kind === 'isolation' || v.kind === 'gate'), state: 'work_ordered' },
    { title: 'Sửa trụ cứu hỏa', ref: hydrants.find(h => h.status !== 'ok') ?? hydrants[0], state: 'repaired' },
    { title: 'Hiệu chuẩn logger áp lực', ref: devices.find(d => d.deviceType === 'PressureSensor' && d.dma === 'DMA-06'), state: 'closed' },
  ]
  planned.forEach((p, i) => {
    if (!p.ref) return
    const history: OpsMarker['history'] = [{ state: 'work_ordered', at: at(30 + i * 4), by: 'Tổ bảo trì' }]
    if (p.state === 'repaired' || p.state === 'closed') history.push({ state: 'repaired', at: at(50 + i * 4), by: 'Tổ bảo trì' })
    if (p.state === 'closed') history.push({ state: 'closed', at: at(70), by: 'Kiểm tra sau sửa chữa', note: 'Số đọc trở lại đường nền' })
    markers.push({
      id: `MK-M-${i + 1}`,
      kind: 'maintenance',
      title: `${p.title} ${p.ref.code ?? p.ref.id}`,
      ...(p.ref.dma ? { dma: p.ref.dma } : {}),
      x: p.ref.x,
      y: p.ref.y,
      gisRef: p.ref.id,
      origin: 'manual',
      state: p.state,
      severity: 'low',
      assignee: 'Tổ bảo trì',
      workOrderRef: `WO-M${i + 1}`,
      createdAt: at(30 + i * 4),
      history,
    })
  })

  // ── DMA balance ──
  const dmaBalance: OpsDmaBalance[] = hyd.summary.dmas.map(d => ({
    id: d.id,
    inflowLps: d.inflowLps,
    useLps: d.demandLps,
    storageLps: d.storageLps,
    mnfLps: d.mnfLps,
    mnfBaselineLps: d.mnfBaselineLps ?? d.mnfLps,
    inflowM3d: Math.round(sum(d.inflowLps) * 3.6),
    useM3d: Math.round(sum(d.demandLps) * 3.6),
    storageM3d: Math.round(sum(d.storageLps) * 3.6),
    minPressureM: d.minPressureM,
  }))

  return { date, sensors, series, events, alarms, markers, dmaBalance, production: buildProduction(hyd, date) }
}

/** Service minimum at critical points (bar) and the spare kept above it when lowering the outlet pressure. */
export const SERVICE_MIN_BAR = 1.0
export const MARGIN_BAR = 0.2
const PUMP_RATED_M3H = 720

export function buildProduction(hyd: DemoHydraulics, date: string): OpsProduction {
  const p = hyd.summary.production
  const plant = hyd.summary.plantLps
  const demand = plant.map((q, h) => r1((q - p.storageLps[h]!) * 3.6))
  // forecast: the same weekday's healthy profile (demand), band ±6 %
  const forecast = p.healthyPlantLps.map((q, h) => r1((q - p.storageLps[h]!) * 3.6))
  const history = [1, 2, 3, 4].map(w => ({
    label: `${w} tuần trước`,
    m3h: forecast.map((v, h) => r1(v * (1 + 0.035 * wobble(h, w)))),
  }))
  // forecast error: the healthy profile as yesterday's forecast, against yesterday's plant output
  const mape = (100 * sum(p.yesterdayPlantLps.map((a, h) => Math.abs(a - p.healthyPlantLps[h]!) / a))) / 24
  const reservoir = (h: number): OpsPlanHour['reservoir'] => ((h >= 22 || h < 5) ? 'fill' : (h >= 6 && h < 10) || (h >= 17 && h < 21) ? 'supply' : 'hold')
  const floorM = (SERVICE_MIN_BAR + MARGIN_BAR) * 10.2
  const plan: OpsPlanHour[] = p.healthyPlantLps.map((q, h) => {
    const flowM3h = Math.round(q * 3.6)
    // lower the outlet by what the critical points have to spare above minimum + margin
    const spare = Math.max(0, p.criticalMinM[h]! - floorM)
    const setpointBar = r2((p.outletPressureM[h]! - spare) / 10.2)
    return {
      hour: h,
      flowM3h,
      setpointBar,
      pumpsOn: Math.max(1, Math.ceil(flowM3h / PUMP_RATED_M3H)),
      reservoir: reservoir(h),
      criticalMinBar: r2((p.criticalMinM[h]! - spare) / 10.2),
    }
  })
  const s = hyd.summary
  return {
    date,
    planDate: nextDay(date),
    serviceMinBar: SERVICE_MIN_BAR,
    marginBar: MARGIN_BAR,
    pumpRatedM3h: PUMP_RATED_M3H,
    demandM3h: demand,
    forecastM3h: forecast,
    forecastLoM3h: forecast.map(v => r1(v * 0.94)),
    forecastHiM3h: forecast.map(v => r1(v * 1.06)),
    history,
    mapePct: r1(mape),
    plan,
    today: {
      plannedFlowM3h: p.yesterdayPlantLps.map(q => r1(q * 3.6)),
      actualFlowM3h: plant.map(q => r1(q * 3.6)),
      plannedSetpointBar: p.outletPressureM.map(m => r2(Math.round((m / 10.2) * 10) / 10)),
      outletBar: p.outletPressureM.map(m => r2(m / 10.2)),
      criticalMinBar: p.criticalMinM.map(m => r2(m / 10.2)),
    },
    kpis: {
      productionM3d: s.productionM3d,
      consumptionM3d: s.consumptionM3d,
      leakageM3d: s.leakageM3d,
      nrwPct: s.nrwPct,
      avgPressureBar: r2(s.medianPressureM / 10.2),
    },
  }
}
