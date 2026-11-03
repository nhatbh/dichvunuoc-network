/* Mock of the design-revision service (`/api/gis/editor/*`) used by both editors.
   Single-user, in memory. Mirrors the server contract: optimistic concurrency on the revision
   (`expectedVersion`) and on every base asset, server-side validation, and the
   Draft → Validated → Submitted → Published | Rejected workflow. Published operations are
   replayed onto the `/full` payload so the map shows approved edits after a reload. */
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

const DN_RANGE: [number, number] = [25, 1200]
const MATERIALS = ['Gang dẻo', 'HDPE', 'uPVC', 'Thép', 'Gang xám']

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

/** Official network as revision assets (built once from the seed, then kept current by publishing). */
function assets(): Record<string, { asset: Asset; version: number }> {
  if (state) return state
  const seed = buildLegacyFullSeed() as Rec
  geo = seed.geo as Geo
  const g = geo
  const out: Record<string, { asset: Asset; version: number }> = {}
  const put = (id: string, kind: Kind, code: string, geometry: Asset['geometry'], attributes: Record<string, string>, hostRef: string | null = null) => {
    out[id] = { version: 1, asset: { draftAssetId: id, kind, assetCode: code, clientRef: null, geometry, attributes, fromRef: null, toRef: null, hostRef } }
  }
  for (const p of seed.pipes as Rec[])
    put(String(p.id), 'Pipe', String(p.code), { type: 'LineString', coordinates: (p.pts as Point[]).map(([x, y]) => toLonLat(g, x, y)) },
      clean({ dn: p.dn, material: p.material, year: p.year, cond: p.cond, trunk: p.trunk, status: p.status, dma: p.dma }))
  for (const v of seed.valves as Rec[])
    put(String(v.id), 'Device', String(v.code), { type: 'Point', coordinates: [toLonLat(g, v.x as number, v.y as number)] },
      clean({ deviceType: 'valve', dn: v.dn, valveKind: v.kind, state: v.state, year: v.year, dma: v.dma }), s(v.pipe) ?? null)
  for (const h of seed.hydrants as Rec[])
    put(String(h.id), 'Device', String(h.code), { type: 'Point', coordinates: [toLonLat(g, h.x as number, h.y as number)] },
      clean({ deviceType: 'hydrant', status: h.status, dma: h.dma }))
  for (const n of (seed.nodes as Rec[]) ?? [])
    put(String(n.id), 'Node', String(n.code), { type: 'Point', coordinates: [toLonLat(g, n.x as number, n.y as number)] }, clean({ nodeType: n.kind, z: n.z }))
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

/** Server-side validation (the same rules apply whatever client sent the operations). */
export function validateOperations(ops: Edit[]): Issue[] {
  const official = assets()
  const issues: Issue[] = []
  const add = (op: Edit, code: string, field: string, message: string) => issues.push({ code, operationId: op.id, draftAssetId: op.targetId ?? op.id, field, message })
  const deleted = new Set(ops.filter(o => o.action === 'Delete').map(o => o.targetId))
  const pipesAfter = new Set([...Object.keys(official).filter(id => official[id]!.asset.kind === 'Pipe' && !deleted.has(id)), ...ops.filter(o => o.after?.kind === 'Pipe').map(o => o.after!.draftAssetId)])
  const seen = new Set<string>()
  for (const op of ops) {
    if (seen.has(op.id)) add(op, 'operation.duplicate', 'id', 'Thao tác bị trùng mã.')
    seen.add(op.id)
    if (op.action !== 'Add') {
      const base = op.targetId ? official[op.targetId] : undefined
      if (!base) {
        add(op, 'target.missing', 'targetId', `Đối tượng ${op.targetId} không còn trong mạng chính thức.`)
        continue
      }
      if (op.expectedVersion !== null && op.expectedVersion !== base.version)
        add(op, 'target.conflict', 'expectedVersion', `${base.asset.assetCode} đã được người khác cập nhật (v${base.version}). Mở lại để lấy bản mới.`)
    }
    if (op.action === 'Delete') {
      if (op.kind === 'Pipe') {
        const hosted = Object.values(official).filter(x => x.asset.hostRef === op.targetId && !deleted.has(x.asset.draftAssetId))
        if (hosted.length) add(op, 'pipe.hosted', 'targetId', `Ống còn ${hosted.length} thiết bị gắn — xoá hoặc chuyển thiết bị trước.`)
      }
      continue
    }
    const a = op.after
    if (!a) {
      add(op, 'after.missing', 'after', 'Thiếu dữ liệu sau thay đổi.')
      continue
    }
    const coords = a.geometry.coordinates
    if (!coords.every(p => p.length === 2 && p[0] > 102 && p[0] < 110 && p[1] > 8 && p[1] < 24))
      add(op, 'geometry.extent', 'geometry', 'Toạ độ nằm ngoài phạm vi Việt Nam.')
    if (a.kind === 'Pipe') {
      if (a.geometry.type !== 'LineString' || coords.length < 2) add(op, 'pipe.geometry', 'geometry', 'Ống cần ít nhất 2 điểm.')
      else if (lengthM(coords) < 0.5) add(op, 'pipe.length', 'geometry', 'Ống quá ngắn (< 0,5 m).')
      const dn = Number(a.attributes.dn)
      if (!Number.isFinite(dn) || dn < DN_RANGE[0] || dn > DN_RANGE[1]) add(op, 'pipe.dn', 'dn', `DN ${a.attributes.dn ?? '—'} ngoài khoảng ${DN_RANGE[0]}–${DN_RANGE[1]}.`)
      if (!MATERIALS.includes(a.attributes.material ?? '')) add(op, 'pipe.material', 'material', `Vật liệu "${a.attributes.material ?? ''}" không có trong danh mục.`)
    } else if (a.geometry.type !== 'Point' || coords.length !== 1) add(op, 'point.geometry', 'geometry', 'Đối tượng điểm cần đúng một toạ độ.')
    if (a.hostRef && !pipesAfter.has(a.hostRef)) add(op, 'device.host', 'hostRef', `Thiết bị gắn vào ống ${a.hostRef} không tồn tại.`)
  }
  return issues
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
    a ? (a.kind === 'Pipe' ? pipes : a.kind === 'Node' ? nodes : a.attributes.deviceType === 'hydrant' ? hydrants : valves)
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
      rec = { id, code: a.assetCode, from: id + '-a', to: id + '-b', dn: Number(at.dn), trunk: at.trunk === 'true', material: at.material, year: Number(at.year) || 2026, cond: at.cond ?? 'good', status: at.status ?? 'active', lenM: Math.round(lengthM(a.geometry.coordinates)), pts: px, dma: at.dma ?? 'DMA-01' }
      pipeBy[id] = rec
    } else {
      const [x, y] = px[0]!
      rec = a.kind === 'Node'
        ? { id, code: a.assetCode, x, y, i: 0, j: 0, z: Number(at.z) || 0, kind: at.nodeType ?? 'junction' }
        : at.deviceType === 'hydrant'
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
    r.operations = body.operations ?? []
    r.version++
    r.status = 'Draft'
    r.updatedAt = now()
    // structural problems are reported on save; full rules run on validate
    const errors = validateOperations(r.operations).filter(i => i.code === 'operation.duplicate' || i.code === 'after.missing')
    return HttpResponse.json({ ...r, errors })
  }),
  http.post('*/editor/revisions/:id/:action', async ({ params, request }) => {
    const r = find(String(params.id))
    if (!r) return problem(404, 'Không tìm thấy bản nháp.')
    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    switch (params.action) {
      case 'validate': {
        const errors = validateOperations(r.operations)
        if (!r.operations.length) errors.push({ code: 'revision.empty', field: 'operations', message: 'Bản nháp chưa có thay đổi.' })
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
        r.status = 'Rejected'
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
