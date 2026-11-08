/* Mock of the design-revision service (`/api/gis/editor/*`) used by both editors.
   Single-user, in memory. Mirrors the server contract: optimistic concurrency on the revision
   (`expectedVersion`) and on every base asset, server-side validation, and the
   Draft → Validated → Submitted → Published | Rejected workflow. Published operations are
   replayed onto the `/full` payload so the map shows approved edits after a reload.
   The network is held in the server's terms (diameterMm, material codes, node types, devices on
   their hosts, pipes ending on nodes) and checked with the port of gis-be's validator, so what
   passes here passes on the real service. */
import { findComponent, pipeMaterialCode, pipeMaterialLabel } from '@wn/contracts/catalog'
import { inspectNetworkEdits } from '@wn/contracts/network-edits'
import { http, HttpResponse } from 'msw'
import { buildLegacyFullSeed } from './legacy-full-seed'

type Point = [number, number]
type Kind = 'Node' | 'Pipe' | 'Device'
interface Asset {
  draftAssetId: string
  kind: Kind
  assetCode: string
  clientRef: string | null
  geometry: { type: 'Point' | 'LineString'; coordinates: Point[] }
  attributes: Record<string, string>
  fromRef: string | null
  toRef: string | null
  hostRef: string | null
}
interface Edit {
  id: string
  action: 'Add' | 'Update' | 'Delete'
  kind: Kind
  targetId: string | null
  expectedVersion: number | null
  after: Asset | null
  before: Asset | null
}
interface Issue {
  code: string
  operationId?: string
  draftAssetId?: string
  field: string
  message: string
}
type Status = 'Draft' | 'Validated' | 'Submitted' | 'Published' | 'Rejected'
interface Revision {
  id: string
  projectId: string
  name: string
  version: number
  status: Status
  operations: Edit[]
  updatedAt: string
  reason?: string
  results?: { draftAssetId: string; gisAssetId?: string; status?: string; reason?: string }[]
}
interface Geo {
  bbox: [number, number, number, number]
  inset: number
  unitsToMeters: number
  metersPerDegreeLon: number
  metersPerDegreeLat: number
}
type Rec = Record<string, unknown>

let seq = 0
let projects: { id: string; name: string }[] = []
let revisions = new Map<string, Revision>()
let published: Edit[] = []
let state: Record<string, { asset: Asset; version: number }> | null = null
let geo: Geo | null = null

export function resetEditorStore(): void {
  seq = 0
  projects = []
  revisions = new Map()
  published = []
  state = null
  geo = null
}

const toLonLat = (g: Geo, x: number, y: number): Point => [
  g.bbox[0] + ((x - g.inset) * g.unitsToMeters) / g.metersPerDegreeLon,
  g.bbox[3] - ((y - g.inset) * g.unitsToMeters) / g.metersPerDegreeLat,
]
const toPixel = (g: Geo, [lon, lat]: Point): Point => [
  Math.round((g.inset + ((lon - g.bbox[0]) * g.metersPerDegreeLon) / g.unitsToMeters) * 100) / 100,
  Math.round((g.inset + ((g.bbox[3] - lat) * g.metersPerDegreeLat) / g.unitsToMeters) * 100) / 100,
]
const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
const clean = (o: Record<string, unknown>) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (s(v) !== undefined) out[k] = s(v)!
  return out
}

/** gis-be asset codes are [A-Za-z0-9_-]; the seed's dotted codes are mapped once. */
const gisCode = (c: unknown) => String(c).replace(/[^A-Za-z0-9_-]+/g, '-')
/** Seed fittings and valve kinds → catalog components (decision 0028), as the editor maps them. */
const SEED_FITTING: Record<string, string> = { 'Tê': 'Tee', 'Tê thu': 'ReducingTee', 'Chữ thập': 'Cross', 'Cút': 'Bend', 'Côn thu': 'Reducer', 'Nắp bịt': 'Cap' }
const SEED_VALVE: Record<string, string> = { butterfly: 'ButterflyValve', ball: 'BallValve', check: 'CheckValve', prv: 'PRV', air: 'AirValve', washout: 'Washout' }
const nodeComponent = (kind: unknown) => {
  const k = String(kind ?? '')
  const direct = findComponent(k)
  return direct?.kind === 'Node' ? direct.code : (SEED_FITTING[k] ?? 'Junction')
}
const valveComponent = (kind: unknown) => {
  const k = String(kind ?? '')
  const direct = findComponent(k)
  return direct?.kind === 'Device' ? direct.code : (SEED_VALVE[k] ?? 'GateValve')
}
const isHydrant = (a: Asset) => findComponent(a.attributes.componentCode)?.code === 'Hydrant'

/** Official network as revision assets, in the server's terms (built once from the seed, then
 *  kept current by publishing). */
function assets(): Record<string, { asset: Asset; version: number }> {
  if (state) return state
  const seed = buildLegacyFullSeed() as Rec
  geo = seed.geo as Geo
  const g = geo
  const out: Record<string, { asset: Asset; version: number }> = {}
  // gis-be codes are unique; the seed reuses type codes (ONG_HD_DN150 …), so repeats get the id
  const codes = new Set<string>()
  const unique = (c: string, id: string) => {
    const v = codes.has(c) ? gisCode(`${c}-${id}`) : c
    codes.add(v)
    return v
  }
  const put = (id: string, kind: Kind, code: string, geometry: Asset['geometry'], attributes: Record<string, string>, refs: Partial<Pick<Asset, 'fromRef' | 'toRef' | 'hostRef'>> = {}) => {
    out[id] = { version: 1, asset: { draftAssetId: id, kind, assetCode: unique(gisCode(code), id), clientRef: null, geometry, attributes, fromRef: refs.fromRef ?? null, toRef: refs.toRef ?? null, hostRef: refs.hostRef ?? null } }
  }
  const nodes = (seed.nodes as Rec[]) ?? []
  const nodeAt = new Map<string, Point>()
  for (const n of nodes) {
    const at = toLonLat(g, n.x as number, n.y as number)
    nodeAt.set(String(n.id), at)
    put(String(n.id), 'Node', String(n.code), { type: 'Point', coordinates: [at] }, clean({ componentCode: nodeComponent(n.kind), fitting: n.kind, z: n.z }))
  }
  for (const p of seed.pipes as Rec[]) {
    const coords = (p.pts as Point[]).map(([x, y]) => toLonLat(g, x, y))
    // ends sit exactly on their nodes, as gis-be stores them
    const from = nodeAt.get(String(p.from)), to = nodeAt.get(String(p.to))
    if (from) coords[0] = from
    if (to) coords[coords.length - 1] = to
    put(String(p.id), 'Pipe', String(p.code), { type: 'LineString', coordinates: coords },
      clean({ diameterMm: Math.round(Number(p.dn)), material: pipeMaterialCode(String(p.material)) ?? p.material, year: p.year, cond: p.cond, trunk: p.trunk, status: p.status, dma: p.dma }),
      { fromRef: from ? String(p.from) : null, toRef: to ? String(p.to) : null })
  }
  for (const v of seed.valves as Rec[])
    put(String(v.id), 'Device', String(v.code), { type: 'Point', coordinates: [toLonLat(g, v.x as number, v.y as number)] },
      clean({ componentCode: valveComponent(v.kind), dn: v.dn, valveKind: v.kind, state: v.state, year: v.year, dma: v.dma }), { hostRef: s(v.pipe) ?? null })
  for (const h of seed.hydrants as Rec[]) {
    const at = toLonLat(g, h.x as number, h.y as number)
    let host: string | null = null, best = Infinity
    for (const [id, n] of nodeAt) {
      const d = (n[0] - at[0]) ** 2 + (n[1] - at[1]) ** 2
      if (d < best) [best, host] = [d, id]
    }
    put(String(h.id), 'Device', String(h.code), { type: 'Point', coordinates: [at] }, clean({ componentCode: 'Hydrant', status: h.status, dma: h.dma }), { hostRef: host })
  }
  state = out
  return out
}

function lengthM(coords: Point[]): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1]!, coords[i]!]
    const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
    m += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110_574)
  }
  return m
}

/** Server-side validation: the port of gis-be's NetworkEditValidator (same rules, same codes). */
export function validateOperations(ops: Edit[]): Issue[] {
  return inspectNetworkEdits(assets(), ops).errors
}

/** Apply approved operations to the official assets (versions +1). */
function publish(rev: Revision): void {
  const official = assets()
  rev.results = []
  for (const op of rev.operations) {
    const id = op.targetId ?? op.after?.draftAssetId ?? op.id
    if (op.action === 'Delete') delete official[id]
    else official[id] = { asset: { ...op.after!, draftAssetId: id }, version: (official[id]?.version ?? 0) + 1 }
    rev.results.push({ draftAssetId: op.after?.draftAssetId ?? id, gisAssetId: id, status: 'Published' })
    published.push({ ...op, after: op.after ? { ...op.after, draftAssetId: id } : null })
  }
  rev.status = 'Published'
}

/** Replay published operations onto a `/full` payload (pixel plane). */
export function applyPublishedEdits(seed: Record<string, unknown>): Record<string, unknown> {
  if (!published.length) return seed
  const g = seed.geo as Geo
  const pipes = seed.pipes as Rec[]
  const pipeBy = seed.pipeBy as Record<string, Rec>
  const valves = seed.valves as Rec[]
  const hydrants = seed.hydrants as Rec[]
  const nodes = seed.nodes as Rec[]
  const listFor = (a: Asset | null, id: string): Rec[] =>
    a ? (a.kind === 'Pipe' ? pipes : a.kind === 'Node' ? nodes : isHydrant(a) ? hydrants : valves)
      : [pipes, valves, hydrants, nodes].find(l => l.some(x => x.id === id)) ?? []
  for (const op of published) {
    const id = op.targetId ?? op.after!.draftAssetId
    const list = listFor(op.after, id)
    const i = list.findIndex(x => x.id === id)
    if (i >= 0) list.splice(i, 1)
    if (op.kind === 'Pipe') delete pipeBy[id]
    const a = op.after
    if (!a) continue
    const at = a.attributes
    const px = a.geometry.coordinates.map(p => toPixel(g, p))
    let rec: Rec
    if (a.kind === 'Pipe') {
      rec = { id, code: a.assetCode, from: a.fromRef ?? id + '-a', to: a.toRef ?? id + '-b', dn: Number(at.diameterMm ?? at.dn), trunk: at.trunk === 'true', material: pipeMaterialLabel(at.material ?? ''), year: Number(at.year) || 2026, cond: at.cond ?? 'good', status: at.status ?? 'active', lenM: Math.round(lengthM(a.geometry.coordinates)), pts: px, dma: at.dma ?? 'DMA-01' }
      pipeBy[id] = rec
    } else {
      const [x, y] = px[0]!
      rec = a.kind === 'Node'
        ? { id, code: a.assetCode, x, y, i: 0, j: 0, z: Number(at.z) || 0, kind: at.fitting ?? at.componentCode ?? 'Junction' }
        : isHydrant(a)
          ? { id, code: a.assetCode, x, y, dma: at.dma ?? 'DMA-01', status: at.status ?? 'ok' }
          : { id, code: a.assetCode, x, y, pipe: a.hostRef ?? '', dn: Number(at.dn) || 0, kind: at.valveKind ?? 'isolation', state: at.state ?? 'open', dma: at.dma ?? 'DMA-01', year: Number(at.year) || 2026 }
    }
    list.push(rec)
  }
  return seed
}

const now = () => new Date().toISOString()
const problem = (status: number, detail: string) => HttpResponse.json({ detail }, { status })
const find = (id: string) => revisions.get(id)

export const editorHandlers = [
  http.get('*/editor/assets', () => HttpResponse.json(assets())),
  http.get('*/editor/revisions', () => HttpResponse.json([...revisions.values()])),
  http.post('*/editor/projects', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string }
    const p = { id: `PRJ-${++seq}`, name: body.name?.trim() || 'Thiết kế' }
    projects.push(p)
    return HttpResponse.json(p, { status: 201 })
  }),
  http.post('*/editor/projects/:pid/revisions', ({ params }) => {
    const p = projects.find(x => x.id === params.pid)
    if (!p) return problem(404, 'Không tìm thấy dự án.')
    const r: Revision = { id: `REV-${++seq}`, projectId: p.id, name: p.name, version: 1, status: 'Draft', operations: [], updatedAt: now() }
    revisions.set(r.id, r)
    return HttpResponse.json({ id: r.id }, { status: 201 })
  }),
  http.get('*/editor/revisions/:id', ({ params }) => {
    const r = find(String(params.id))
    return r ? HttpResponse.json(r) : problem(404, 'Không tìm thấy bản nháp.')
  }),
  http.put('*/editor/revisions/:id', async ({ params, request }) => {
    const r = find(String(params.id))
    if (!r) return problem(404, 'Không tìm thấy bản nháp.')
    const body = (await request.json()) as { expectedVersion: number; operations: Edit[] }
    if (body.expectedVersion !== r.version) return problem(409, 'Bản nháp đã thay đổi ở nơi khác.')
    if (!['Draft', 'Validated', 'Rejected'].includes(r.status)) return problem(409, 'Bản nháp đã gửi duyệt — không thể sửa.')
    if (!Array.isArray(body.operations) || body.operations.length > 2000) return problem(400, 'Tối đa 2000 thay đổi trong một bản nháp.')
    // as design-be: the server's own before image; conflicts refuse the save, other issues come back with it
    const inspection = inspectNetworkEdits(assets(), body.operations.map(o => ({ ...o, before: null })))
    const conflicts = inspection.errors.filter(e => e.code === 'TARGET_CONFLICT' || e.code === 'INVALID_OPERATION')
    if (conflicts.length) return HttpResponse.json({ errors: conflicts }, { status: 409 })
    r.operations = inspection.operations
    r.version++
    r.status = 'Draft'
    r.updatedAt = now()
    return HttpResponse.json({ ...r, errors: inspection.errors })
  }),
  http.post('*/editor/revisions/:id/:action', async ({ params, request }) => {
    const r = find(String(params.id))
    if (!r) return problem(404, 'Không tìm thấy bản nháp.')
    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    switch (params.action) {
      case 'validate': {
        const errors = validateOperations(r.operations)
        if (!['Draft', 'Validated'].includes(r.status)) return problem(409, 'Bản nháp không ở trạng thái nháp.')
        r.status = errors.length ? 'Draft' : 'Validated'
        r.updatedAt = now()
        return HttpResponse.json({ isValid: !errors.length, errors })
      }
      case 'submit':
        if (r.status !== 'Validated') return problem(409, 'Cần kiểm tra dữ liệu hợp lệ trước khi gửi duyệt.')
        r.status = 'Submitted'
        r.updatedAt = now()
        return HttpResponse.json({ isValid: true })
      case 'approve': {
        if (r.status !== 'Submitted') return problem(409, 'Chỉ duyệt được bản đã gửi.')
        const errors = validateOperations(r.operations)
        if (errors.length) return HttpResponse.json({ errors }, { status: 409 })
        publish(r)
        r.updatedAt = now()
        return HttpResponse.json({ isValid: true })
      }
      case 'reject':
        if (r.status !== 'Submitted') return problem(409, 'Chỉ trả lại được bản đã gửi.')
        if (!body.reason?.trim()) return problem(400, 'Cần nêu lý do trả lại.')
        // as design-be: a returned revision goes back to Draft, with the reason
        r.status = 'Draft'
        r.reason = body.reason.trim()
        r.updatedAt = now()
        return HttpResponse.json({ isValid: true })
      default:
        return problem(404, 'Thao tác không hỗ trợ.')
    }
  }),
  http.get('*/editor/revisions/:id/publish-result', ({ params }) => {
    const r = find(String(params.id))
    return r ? HttpResponse.json(r.results ?? []) : problem(404, 'Không tìm thấy bản nháp.')
  }),
]
