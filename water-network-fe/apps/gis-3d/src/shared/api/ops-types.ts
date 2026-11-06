/**
 * Operations API (`/api/ops/*`): sensors, readings, alarms, markers, DMA balance and production.
 * Shapes shared by the BFF contract, the demo MSW handlers and the screens. Times are 15-minute
 * slots of one day (0 = 00:00, 95 = 23:45); hours are 0–23.
 */

export type OpsStatus = 'normal' | 'warning' | 'critical' | 'offline'
export type SensorKind = 'pressure' | 'flow' | 'level'

export interface OpsSensor {
  id: string
  name: string
  kind: SensorKind
  /** Catalog code of the device (PressureSensor, BulkMeter, LevelSensor). */
  deviceType: string
  dma?: string
  unit: string
  /** Map position (GIS plane coordinates, like every other asset). */
  x: number
  y: number
  hostPipeId?: string
  hostNodeId?: string
  /** Service minimum / pipe maximum (pressure, level). */
  low?: number
  high?: number
  /** DMA inlet meter; `main` = the DMA's metered main inlet. */
  inlet?: boolean
  main?: boolean
  /** Plant outlet meter / logger. */
  plant?: boolean
  /** Critical-point logger (high point, end of line). */
  critical?: boolean
}

export interface OpsSeries {
  sensorId: string
  unit: string
  intervalMin: number
  /** ISO time of slot 0. */
  start: string
  /** Readings; shorter than 96 when the sensor stopped reporting. */
  values: number[]
  /** Baseline band for each slot (p50 = the expected reading). Absent when no baseline exists yet. */
  p10?: number[]
  p50?: number[]
  p90?: number[]
  yesterday?: number[]
  low?: number
  high?: number
}

export interface OpsEvent {
  id: string
  kind: 'burst' | 'background'
  dma: string
  /** Node where the water is lost. */
  nodeId: string
  x: number
  y: number
  lps: number
  fromSlot: number
  /** Sensors whose readings show it, with how strongly. */
  seenBy: Array<{ sensorId: string; level: 'warning' | 'critical' }>
}

export interface OpsAlarm {
  id: string
  sensorId: string
  rule: 'limit' | 'baseline' | 'leak' | 'no_data'
  severity: 'warning' | 'critical'
  startSlot: number
  /** Last slot of the alarm; absent while it is still active at the end of the day. */
  endSlot?: number
  message: string
}

export type MarkerKind = 'suspected_leak' | 'confirmed_leak' | 'maintenance' | 'sensor_fault'
export type MarkerState = 'suspected' | 'under_review' | 'rejected' | 'work_ordered' | 'repaired' | 'closed'
export type MarkerAction = 'review' | 'confirm' | 'reject' | 'repaired' | 'verify' | 'rework'

export interface OpsMarker {
  id: string
  kind: MarkerKind
  title: string
  dma?: string
  x: number
  y: number
  /** Asset it sits on or near. */
  gisRef?: string
  sensorId?: string
  origin: 'auto' | 'manual'
  state: MarkerState
  severity: 'low' | 'medium' | 'high'
  /** Estimated water lost (m³/day). */
  lossM3d?: number
  /** Readings that raised it: a sensor and a slot window. */
  evidence?: { sensorId: string; fromSlot: number; toSlot: number }
  assignee?: string
  workOrderRef?: string
  createdAt: string
  history: Array<{ state: MarkerState; at: string; by: string; note?: string }>
}

export interface OpsDmaBalance {
  id: string
  /** Hourly means (L/s), 24 values. inflow = use + storage. */
  inflowLps: number[]
  useLps: number[]
  storageLps: number[]
  /** Minimum night flow (02:00–04:00) and its baseline (L/s). */
  mnfLps: number
  mnfBaselineLps: number
  inflowM3d: number
  useM3d: number
  storageM3d: number
  minPressureM: number
}

export interface OpsPlanHour {
  hour: number
  flowM3h: number
  setpointBar: number
  pumpsOn: number
  reservoir: 'fill' | 'hold' | 'supply'
  /** Lowest critical-point pressure expected at this setpoint (bar). */
  criticalMinBar: number
}

export interface OpsProduction {
  /** The day the readings are from, and the day being planned. */
  date: string
  planDate: string
  serviceMinBar: number
  /** Spare kept above the service minimum when lowering the setpoint (bar). */
  marginBar: number
  pumpRatedM3h: number
  /** Today's demand (plant outflow less water put into storage), m³/h by hour. */
  demandM3h: number[]
  /** Tomorrow's forecast demand with its band, m³/h by hour. */
  forecastM3h: number[]
  forecastLoM3h: number[]
  forecastHiM3h: number[]
  /** The same weekday in recent weeks (faint lines), m³/h by hour. */
  history: Array<{ label: string; m3h: number[] }>
  /** Forecast error of recent days (mean absolute percentage error). */
  mapePct: number
  /** Recommended schedule for tomorrow. */
  plan: OpsPlanHour[]
  /** Today: what was planned and what happened. */
  today: {
    plannedFlowM3h: number[]
    actualFlowM3h: number[]
    plannedSetpointBar: number[]
    outletBar: number[]
    criticalMinBar: number[]
  }
  kpis: { productionM3d: number; consumptionM3d: number; leakageM3d: number; nrwPct: number; avgPressureBar: number }
}

/** The network at each hour of the day: node pressure (dm), pipe flow along the drawn line (0.1 L/s), velocity (cm/s). */
export interface OpsNetworkDay {
  nodes: string[]
  pipes: string[]
  pressureDm: number[][]
  flowDl: number[][]
  velocityCm: number[][]
}

export const SLOTS_PER_DAY = 96
export const slotLabel = (slot: number): string => {
  const m = Math.max(0, Math.min(SLOTS_PER_DAY, slot)) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
