/** Demo `/api/ops/*`: the operations API served from the seeded network and its EPANET day. */
import { http, HttpResponse } from 'msw'
import { moveMarker } from '../ops-markers'
import hydraulics from './demo-hydraulics.json'
import { buildLegacyFullSeed } from './legacy-full-seed'
import { buildOpsDemo, type OpsDemo } from './ops-demo'
import type { DemoHydraulics, DemoNetworkHourly } from './demo-hydraulics'
import type { OpsMarker, OpsNetworkDay, OpsProduction } from '../ops-types'
import type {
  CreateMarkerRequest,
  OpsAlarmsResponse,
  OpsDmaBalanceResponse,
  OpsEventsResponse,
  OpsMarkersResponse,
  OpsReadingsResponse,
  OpsSensorsResponse,
  UpdateMarkerRequest,
} from '@wn/contracts/ops'
import type { z } from 'zod'

let demo: OpsDemo | null = null
const acceptedPlans = new Map<string, OpsProduction['plan']>()
let markers: Map<string, OpsMarker> | null = null
const ops = () => (demo ??= buildOpsDemo(buildLegacyFullSeed() as never, hydraulics as unknown as DemoHydraulics))
const markerStore = () => (markers ??= new Map(ops().markers.map(m => [m.id, m])))

/** Test hook: start again from the seeded markers. */
export function resetOpsDemo(): void {
  demo = null
  markers = null
}

let network: Promise<OpsNetworkDay> | null = null
// 400 kB: only fetched when the time slider needs it
const networkDay = () =>
  (network ??= import('./demo-network-hourly.json').then(m => {
    const d = (m.default ?? m) as unknown as DemoNetworkHourly
    return { nodes: d.nodes, pipes: d.pipes, pressureDm: d.pressureDm, flowDl: d.flowDl, velocityCm: d.velocityCm }
  }))

/** A JSON response typed by its contract schema. */
const json = <S extends z.ZodTypeAny>(body: z.infer<S>) => HttpResponse.json(body)
const day = () => ops().production.date

export const opsHandlers = [
  http.get('*/ops/sensors', () => json<typeof OpsSensorsResponse>({ date: day(), sensors: ops().sensors })),
  http.get('*/ops/readings', ({ request }) => {
    const id = new URL(request.url).searchParams.get('sensor')
    const all = ops().series
    if (id && !all[id]) return HttpResponse.json({ message: 'unknown sensor' }, { status: 404 })
    const series = id ? [all[id]!] : Object.values(all)
    return json<typeof OpsReadingsResponse>({ date: day(), series })
  }),
  http.get('*/ops/events', () => json<typeof OpsEventsResponse>({ events: ops().events })),
  http.get('*/ops/alarms', () => json<typeof OpsAlarmsResponse>({ alarms: ops().alarms })),
  http.get('*/ops/network-state', async () => HttpResponse.json(await networkDay())),
  http.get('*/ops/dma-balance', () => json<typeof OpsDmaBalanceResponse>({ date: day(), dmas: ops().dmaBalance })),
  http.get('*/ops/production', () => HttpResponse.json(ops().production)),
  http.put('*/ops/production/plan', async ({ request }) => {
    const body = (await request.json()) as { date: string; plan: OpsProduction['plan'] }
    acceptedPlans.set(body.date, body.plan)
    return HttpResponse.json({ date: body.date, accepted: true, hours: body.plan.length })
  }),
  http.get('*/ops/markers', () => json<typeof OpsMarkersResponse>({ markers: [...markerStore().values()] })),
  http.post('*/ops/markers', async ({ request }) => {
    const body = (await request.json()) as CreateMarkerRequest
    const id = `MK-U-${markerStore().size + 1}`
    const at = new Date().toISOString()
    const m: OpsMarker = {
      id,
      kind: body.kind ?? 'suspected_leak',
      title: body.title ?? 'Điểm đánh dấu',
      ...(body.dma ? { dma: body.dma } : {}),
      x: body.x ?? 0,
      y: body.y ?? 0,
      ...(body.sensorId ? { sensorId: body.sensorId } : {}),
      ...(body.gisRef ? { gisRef: body.gisRef } : {}),
      ...(body.evidence ? { evidence: body.evidence } : {}),
      origin: 'manual',
      state: body.kind === 'maintenance' ? 'work_ordered' : 'suspected',
      severity: body.severity ?? 'medium',
      createdAt: at,
      history: [{ state: body.kind === 'maintenance' ? 'work_ordered' : 'suspected', at, by: 'Điều độ viên', ...(body.note ? { note: body.note } : {}) }],
    }
    markerStore().set(id, m)
    return HttpResponse.json(m, { status: 201 })
  }),
  http.patch('*/ops/markers/:id', async ({ params, request }) => {
    const m = markerStore().get(String(params.id))
    if (!m) return HttpResponse.json({ message: 'unknown marker' }, { status: 404 })
    const body = (await request.json()) as UpdateMarkerRequest
    const next = body.action ? moveMarker(m, body.action, 'Điều độ viên', new Date().toISOString(), body.note) : { ...m }
    if (!next) return HttpResponse.json({ message: `not allowed from ${m.state}` }, { status: 409 })
    if (body.severity) next.severity = body.severity
    if (body.lossM3d !== undefined) next.lossM3d = body.lossM3d
    if (body.assignee) next.assignee = body.assignee
    markerStore().set(next.id, next)
    return HttpResponse.json(next)
  }),
]
