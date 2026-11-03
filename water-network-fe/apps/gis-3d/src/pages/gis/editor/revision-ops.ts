/* Bridge between the CAD editor's local drafts (pixel plane, `Draft`) and the server-side design
   revision contract (`Edit` operations with WGS84 `Asset`s, see network-editor/model.ts).
   Pure functions: the editor keeps its fast local buffer + undo, and a revision save sends the
   whole buffer as the revision's operation list (PUT with `expectedVersion`). */
import type { Draft, DraftKind, Pt, RuleIssue } from './model'
import type { Asset, Edit, Issue, Kind, Point } from '../network-editor/model'

export interface Projector {
  toLonLat: (x: number, y: number) => Point
  toPixel: (lon: number, lat: number) => Point
}

/** Base-feature codes, so an Update/Delete carries the existing asset code. */
export type CodeLookup = (kind: DraftKind, id: string) => string | undefined

const KIND: Record<DraftKind, Kind> = { pipe: 'Pipe', node: 'Node', valve: 'Device', hydrant: 'Device' }
const PREFIX: Record<DraftKind, string> = { pipe: 'ONG', node: 'NUT', valve: 'VAN', hydrant: 'TRU' }
const ACTION = { add: 'Add', mod: 'Update', del: 'Delete' } as const

const round = (v: number) => Math.round(v * 1e8) / 1e8
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v))

function attributes(d: Draft): Record<string, string> {
  const raw: Record<string, unknown> = { dma: d.dma }
  if (d.kind === 'pipe') Object.assign(raw, { dn: d.dn, material: d.material, year: d.year, cond: d.cond, trunk: d.trunk })
  if (d.kind === 'valve') Object.assign(raw, { deviceType: 'valve', dn: d.dn, valveKind: d.vkind, state: d.state })
  if (d.kind === 'hydrant') Object.assign(raw, { deviceType: 'hydrant', hydrantType: d.htype })
  if (d.kind === 'node') Object.assign(raw, { nodeType: d.ntype, z: d.z, splitOf: d.splitOf })
  if (d.eam) Object.assign(raw, { eamCode: d.eam.code, eamName: d.eam.name, eamSerial: d.eam.serial, eamMaker: d.eam.maker, eamYear: d.eam.year })
  if (d.imported) raw.imported = true
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const s = str(v)
    if (s !== undefined) out[k] = s
  }
  return out
}

function geometry(d: Draft, p: Projector): Asset['geometry'] | null {
  const ll = (x: number, y: number): Point => {
    const [lon, lat] = p.toLonLat(x, y)
    return [round(lon), round(lat)]
  }
  if (d.geom === 'line') return d.pts && d.pts.length >= 2 ? { type: 'LineString', coordinates: d.pts.map(([x, y]) => ll(x, y)) } : null
  return d.x !== undefined && d.y !== undefined ? { type: 'Point', coordinates: [ll(d.x, d.y)] } : null
}

/** Local drafts → revision operations. `versions` holds the server version of each base asset. */
export function draftsToOperations(
  drafts: Draft[],
  p: Projector,
  versions: Record<string, number> = {},
  codeOf: CodeLookup = () => undefined
): Edit[] {
  return drafts.map(d => {
    const target = d.op === 'add' ? null : (d.baseId ?? null)
    if (d.op !== 'add' && !target) throw new Error(`Thay đổi ${d.id} thiếu đối tượng gốc.`)
    const key = target ?? d.id
    let after: Asset | null = null
    if (d.op !== 'del') {
      const geom = geometry(d, p)
      if (!geom) throw new Error(`Đối tượng ${d.id} chưa có hình học hợp lệ.`)
      after = {
        draftAssetId: key,
        clientRef: d.id,
        kind: KIND[d.kind],
        assetCode: (target && codeOf(d.kind, target)) || `${PREFIX[d.kind]}-${d.id}`,
        geometry: geom,
        attributes: attributes(d),
        fromRef: null,
        toRef: null,
        hostRef: d.kind === 'valve' || d.kind === 'hydrant' ? (d.onPipe ?? null) : null,
      }
    }
    return {
      id: d.id,
      action: ACTION[d.op],
      kind: KIND[d.kind],
      targetId: target,
      expectedVersion: target ? (versions[target] ?? null) : null,
      before: null,
      after,
    }
  })
}

const num = (v: string | undefined) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

function draftKind(e: Edit): DraftKind {
  if (e.kind === 'Pipe') return 'pipe'
  if (e.kind === 'Node') return 'node'
  return e.after?.attributes.deviceType === 'hydrant' ? 'hydrant' : 'valve'
}

/** Revision operations → local drafts (reopening a saved revision). Deletes need `kindOf` for devices. */
export function operationsToDrafts(
  edits: Edit[],
  p: Projector,
  kindOf: (id: string) => DraftKind | undefined = () => undefined
): Draft[] {
  return edits.map(e => {
    const kind = (e.action === 'Delete' && e.targetId && kindOf(e.targetId)) || draftKind(e)
    const a = e.after?.attributes ?? {}
    const op = e.action === 'Add' ? 'add' : e.action === 'Update' ? 'mod' : 'del'
    const d: Draft = { id: e.id, op, kind, geom: kind === 'pipe' ? 'line' : 'point', dma: a.dma ?? 'DMA-01' }
    if (e.targetId) d.baseId = e.targetId
    const px = (pt: Point): Pt => {
      const [x, y] = p.toPixel(pt[0], pt[1])
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
    }
    const g = e.after?.geometry
    if (g?.type === 'LineString') d.pts = g.coordinates.map(px)
    if (g?.type === 'Point' && g.coordinates[0]) [d.x, d.y] = px(g.coordinates[0])
    if (kind === 'pipe') Object.assign(d, { dn: num(a.dn), material: a.material, year: num(a.year), cond: a.cond, trunk: a.trunk === 'true' })
    if (kind === 'valve') Object.assign(d, { dn: num(a.dn), vkind: a.valveKind, state: a.state })
    if (kind === 'hydrant') d.htype = a.hydrantType
    if (kind === 'node') Object.assign(d, { ntype: a.nodeType, z: num(a.z), splitOf: a.splitOf })
    if (e.after && (kind === 'valve' || kind === 'hydrant')) d.onPipe = e.after?.hostRef ?? null
    if (e.after) d.eam = a.eamCode ? { code: a.eamCode, kind, name: a.eamName ?? a.eamCode, serial: a.eamSerial ?? '', maker: a.eamMaker ?? '', year: num(a.eamYear) ?? 0 } : null
    if (a.imported === 'true') d.imported = true
    for (const k of Object.keys(d) as (keyof Draft)[]) if (d[k] === undefined) delete d[k]
    return d
  })
}

/** Server validation issues → change-set pane rows (rule `server`). */
export function serverIssues(issues: Issue[] | undefined): RuleIssue[] {
  return (issues ?? []).map(i => ({
    sev: 'error',
    rule: 'server',
    msg: (i.operationId || i.draftAssetId ? `[${i.operationId ?? i.draftAssetId}] ` : '') + i.message,
  }))
}
