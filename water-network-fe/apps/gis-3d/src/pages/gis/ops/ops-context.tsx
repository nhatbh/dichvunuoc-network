/* Operations state shared by the map, the time bar and the ops panels: one time cursor (15-min slot),
   the /api/ops data, and what the map should show at the cursor (sensor status, flows, pressure). */
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js'
import { httpClient } from '@/shared/api/http-client'
import { statusAt } from '@/shared/api/ops-status'
import type {
  MarkerAction,
  OpsAlarm,
  OpsDmaBalance,
  OpsEvent,
  OpsMarker,
  OpsNetworkDay,
  OpsProduction,
  OpsSensor,
  OpsSeries,
  OpsStatus,
} from '@/shared/api/ops-types'
import type { PipeFlow } from '@/shared/lib/hydraulics/epanet-flow'

export const SLOTS = 96

const get = <T,>(url: string) => () => httpClient.get<T>(url)
const KEY = ['ops'] as const

export interface OpsCtx {
  /** Time cursor: 15-minute slot of the day (0–95). */
  slot: Accessor<number>
  setSlot: (s: number) => void
  hour: Accessor<number>
  playing: Accessor<boolean>
  setPlaying: (p: boolean) => void
  /** Slots advanced per second while playing. */
  speed: Accessor<number>
  setSpeed: (s: number) => void
  /** Last slot with data (the "now" of the demo day). */
  nowSlot: Accessor<number>
  sensors: Accessor<OpsSensor[]>
  sensorById: Accessor<Map<string, OpsSensor>>
  series: Accessor<Record<string, OpsSeries>>
  events: Accessor<OpsEvent[]>
  alarms: Accessor<OpsAlarm[]>
  markers: Accessor<OpsMarker[]>
  dmaBalance: Accessor<OpsDmaBalance[]>
  production: Accessor<OpsProduction | undefined>
  /** Sensor status at the cursor. */
  status: Accessor<Record<string, OpsStatus>>
  statusOf: (sensorId: string, slot?: number) => OpsStatus
  /** Network at the cursor's hour (null until loaded). */
  network: Accessor<OpsNetworkDay | null>
  flowsAt: Accessor<Map<string, PipeFlow> | null>
  pressureAt: Accessor<Map<string, number> | null>
  /** Paint pipes by pressure at the cursor. */
  paintPressure: Accessor<boolean>
  setPaintPressure: (on: boolean) => void
  moveMarker: (id: string, action: MarkerAction, note?: string) => Promise<void>
  addMarker: (m: Partial<OpsMarker>) => Promise<OpsMarker>
  loading: Accessor<boolean>
}

const Ctx = createContext<OpsCtx>()

export function OpsProvider(props: { children: JSX.Element }) {
  const qc = useQueryClient()
  const sensorsQ = createQuery(() => ({ queryKey: [...KEY, 'sensors'], queryFn: get<OpsSensor[]>('/ops/sensors'), staleTime: Infinity }))
  const seriesQ = createQuery(() => ({ queryKey: [...KEY, 'readings'], queryFn: get<Record<string, OpsSeries>>('/ops/readings'), staleTime: Infinity }))
  const eventsQ = createQuery(() => ({ queryKey: [...KEY, 'events'], queryFn: get<OpsEvent[]>('/ops/events'), staleTime: Infinity }))
  const alarmsQ = createQuery(() => ({ queryKey: [...KEY, 'alarms'], queryFn: get<OpsAlarm[]>('/ops/alarms'), staleTime: Infinity }))
  const markersQ = createQuery(() => ({ queryKey: [...KEY, 'markers'], queryFn: get<OpsMarker[]>('/ops/markers'), staleTime: 30_000 }))
  const dmaQ = createQuery(() => ({ queryKey: [...KEY, 'dma-balance'], queryFn: get<OpsDmaBalance[]>('/ops/dma-balance'), staleTime: Infinity }))
  const prodQ = createQuery(() => ({ queryKey: [...KEY, 'production'], queryFn: get<OpsProduction>('/ops/production'), staleTime: Infinity }))
  const netQ = createQuery(() => ({ queryKey: [...KEY, 'network-state'], queryFn: get<OpsNetworkDay>('/ops/network-state'), staleTime: Infinity }))

  const sensors = () => sensorsQ.data ?? []
  const series = () => seriesQ.data ?? {}
  const events = () => eventsQ.data ?? []
  const sensorById = createMemo(() => new Map(sensors().map(s => [s.id, s])))
  const nowSlot = createMemo(() => {
    let n = 0
    for (const s of Object.values(series())) n = Math.max(n, s.values.length - 1)
    return n || SLOTS - 1
  })

  // the cursor; a link can open a moment with ?t=HH:MM (not written back: the router owns the URL)
  const initial = (() => {
    const m = /[?&]t=(\d{1,2}):(\d{2})/.exec(window.location.search)
    return m ? Math.min(SLOTS - 1, Number(m[1]) * 4 + Math.floor(Number(m[2]) / 15)) : 60
  })()
  const [slot, setSlotRaw] = createSignal(initial)
  const setSlot = (s: number) => setSlotRaw(Math.max(0, Math.min(SLOTS - 1, Math.round(s))))
  const [playing, setPlaying] = createSignal(false)
  const [speed, setSpeed] = createSignal(4)
  createEffect(() => {
    if (!playing()) return
    const id = setInterval(() => {
      const next = slot() + 1
      if (next >= SLOTS) {
        setPlaying(false)
        return
      }
      setSlot(next)
    }, 1000 / speed())
    onCleanup(() => clearInterval(id))
  })

  const statusOf = (id: string, at = slot()): OpsStatus => {
    const s = series()[id]
    return s ? statusAt(s, at, events()) : 'offline'
  }
  const status = createMemo(() => {
    const at = slot()
    const out: Record<string, OpsStatus> = {}
    for (const id of Object.keys(series())) out[id] = statusOf(id, at)
    return out
  })

  const hour = createMemo(() => Math.floor(slot() / 4))
  const network = () => netQ.data ?? null
  const flowCache = new Map<number, Map<string, PipeFlow>>()
  const flowsAt = createMemo(() => {
    const n = network()
    if (!n) return null
    const h = hour()
    let m = flowCache.get(h)
    if (!m) {
      m = new Map()
      const q = n.flowDl[h]!
      const v = n.velocityCm[h]!
      n.pipes.forEach((id, i) => {
        const lps = q[i]! / 10
        if (Math.abs(lps) < 0.05) return
        m!.set(id, { flowDir: lps < 0 ? 'reverse' : 'forward', velocity: v[i]! / 100, flowLps: Math.abs(lps) })
      })
      flowCache.set(h, m)
    }
    return m
  })
  const pressureCache = new Map<number, Map<string, number>>()
  const pressureAt = createMemo(() => {
    const n = network()
    if (!n) return null
    const h = hour()
    let m = pressureCache.get(h)
    if (!m) {
      const p = n.pressureDm[h]!
      m = new Map(n.nodes.map((id, i) => [id, p[i]! / 10]))
      pressureCache.set(h, m)
    }
    return m
  })
  const [paintPressure, setPaintPressure] = createSignal(false)

  const move = createMutation(() => ({
    mutationFn: (v: { id: string; action: MarkerAction; note?: string }) =>
      httpClient.patch<OpsMarker>(`/ops/markers/${v.id}`, { action: v.action, note: v.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'markers'] }),
  }))
  const add = createMutation(() => ({
    mutationFn: (m: Partial<OpsMarker>) => httpClient.post<OpsMarker>('/ops/markers', m),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'markers'] }),
  }))

  const ctx: OpsCtx = {
    slot,
    setSlot,
    hour,
    playing,
    setPlaying,
    speed,
    setSpeed,
    nowSlot,
    sensors,
    sensorById,
    series,
    events,
    alarms: () => alarmsQ.data ?? [],
    markers: () => markersQ.data ?? [],
    dmaBalance: () => dmaQ.data ?? [],
    production: () => prodQ.data,
    status,
    statusOf,
    network,
    flowsAt,
    pressureAt,
    paintPressure,
    setPaintPressure,
    moveMarker: async (id, action, note) => {
      await move.mutateAsync({ id, action, ...(note ? { note } : {}) })
    },
    addMarker: m => add.mutateAsync(m),
    loading: () => sensorsQ.isLoading || seriesQ.isLoading,
  }
  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useOps(): OpsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOps outside OpsProvider')
  return c
}
export const useOpsMaybe = (): OpsCtx | undefined => useContext(Ctx)

/** Status colours (match the catalog's status ring). */
export const STATUS_COLOR: Record<OpsStatus, string> = {
  normal: '#2FB36B',
  warning: '#E5A00D',
  critical: '#E0453A',
  offline: '#7D838A',
}
export const STATUS_LABEL: Record<OpsStatus, string> = {
  normal: 'Bình thường',
  warning: 'Lệch đường nền',
  critical: 'Vượt ngưỡng',
  offline: 'Mất dữ liệu',
}

/** Pressure ramp (m head): red below the service minimum, amber when low, green in the normal range, blue when high. */
export function pressureColor(m: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [8, [192, 57, 43]],
    [12, [229, 160, 13]],
    [18, [47, 160, 107]],
    [30, [58, 120, 194]],
    [50, [31, 63, 120]],
  ]
  if (m <= stops[0]![0]) return rgb(stops[0]![1])
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]!
    const [a, ca] = stops[i - 1]!
    if (m <= b) {
      const t = (m - a) / (b - a)
      return rgb(ca.map((c, k) => c + (cb[k]! - c) * t) as [number, number, number])
    }
  }
  return rgb(stops[stops.length - 1]![1])
}
const rgb = (c: [number, number, number]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

export const slotTime = (slot: number) =>
  `${String(Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}`
