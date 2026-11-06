/** Demo `/api/ops/*`: the operations API served from the seeded network and its EPANET day. */
import { http, HttpResponse } from 'msw'
import { moveMarker } from '../ops-markers'
import hydraulics from './demo-hydraulics.json'
import { buildLegacyFullSeed } from './legacy-full-seed'
import { buildOpsDemo, type OpsDemo } from './ops-demo'
import type { DemoHydraulics, DemoNetworkHourly } from './demo-hydraulics'
import type { MarkerAction, OpsMarker, OpsNetworkDay, OpsProduction } from '../ops-types'

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

export const opsHandlers = [
  http.get('*/ops/sensors', () => HttpResponse.json(ops().sensors)),
  http.get('*/ops/readings', ({ request }) => {
    const id = new URL(request.url).searchParams.get('sensor')
    const all = ops().series
    if (!id) return HttpResponse.json(all)
    return all[id] ? HttpResponse.json(all[id]) : HttpResponse.json({ message: 'unknown sensor' }, { status: 404 })
  }),
  http.get('*/ops/events', () => HttpResponse.json(ops().events)),
  http.get('*/ops/alarms', () => HttpResponse.json(ops().alarms)),
  http.get('*/ops/network-state', async () => HttpResponse.json(await networkDay())),
  http.get('*/ops/dma-balance', () => HttpResponse.json(ops().dmaBalance)),
  http.get('*/ops/production', () => HttpResponse.json(ops().production)),
  http.put('*/ops/production/plan', async ({ request }) => {
    const body = (await request.json()) as { date: string; plan: OpsProduction['plan'] }
    acceptedPlans.set(body.date, body.plan)
    return HttpResponse.json({ date: body.date, accepted: true, hours: body.plan.length })
  }),
  http.get('*/ops/markers', () => HttpResponse.json([...markerStore().values()])),
  http.post('*/ops/markers', async ({ request }) => {
    const body = (await request.json()) as Partial<OpsMarker>
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
      ...(body.evidence ? { evidence: body.evidence } : {}),
      origin: 'manual',
      state: body.kind === 'maintenance' ? 'work_ordered' : 'suspected',
      severity: body.severity ?? 'medium',
      createdAt: at,
      history: [{ state: body.kind === 'maintenance' ? 'work_ordered' : 'suspected', at, by: 'Điều độ viên' }],
    }
    markerStore().set(id, m)
    return HttpResponse.json(m, { status: 201 })
  }),
  http.patch('*/ops/markers/:id', async ({ params, request }) => {
    const m = markerStore().get(String(params.id))
    if (!m) return HttpResponse.json({ message: 'unknown marker' }, { status: 404 })
    const body = (await request.json()) as { action: MarkerAction; note?: string; assignee?: string }
    const next = moveMarker(m, body.action, 'Điều độ viên', new Date().toISOString(), body.note)
    if (!next) return HttpResponse.json({ message: `not allowed from ${m.state}` }, { status: 409 })
    if (body.assignee) next.assignee = body.assignee
    markerStore().set(next.id, next)
    return HttpResponse.json(next)
  }),
]
