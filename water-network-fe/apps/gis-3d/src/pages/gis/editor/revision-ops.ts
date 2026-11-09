/* Bridge between the CAD editor's local drafts (pixel plane, `Draft`) and the design-revision
   contract (`Edit` operations with WGS84 `Asset`s; `@wn/contracts/network-edits`).
   Pure functions: the editor keeps its fast local buffer + undo, and a revision save sends the
   whole buffer as the revision's operation list (PUT with `expectedVersion`).

   The server (gis-be NetworkEditValidator) checks the resulting graph, so the operations are
   built in its terms:
   - pipes carry `diameterMm` and a material code, and end on nodes (`fromRef`/`toRef`): an end
     within SNAP_M of a node is moved onto it, otherwise a junction is added there;
   - a node dropped on a pipe (`splitOf`) splits it: the pipe keeps the first part and ends on
     the node, a new pipe takes the rest;
   - every asset names its catalog component (`componentCode`, decision 0028); the editor's
     valve kinds and fitting labels map to codes (VALVE_COMPONENT, FITTING_COMPONENT);
   - in-line devices (valves, meters) sit on a pipe; point devices (hydrants, air valves,
     washouts) on a node (the nearest one, or a new junction at the device);
   - every `after.draftAssetId` is the operation id, existing assets keep their code.
   Operations the editor did not draw itself carry `derived` and are dropped on reopen. */
import { findComponent, pipeMaterialCode, pipeMaterialLabel } from '@wn/contracts/catalog'
import { nearMetres, type EditState } from '@wn/contracts/network-edits'
import type { Draft, DraftKind, Pt, RuleIssue } from './model'
import type { Asset, Edit, Issue, Kind, Point } from './revision-model'

export interface Projector {
  toLonLat: (x: number, y: number) => Point
  toPixel: (lon: number, lat: number) => Point
}

/** Base-feature codes, so an Update/Delete carries the existing asset code. */
export type CodeLookup = (kind: DraftKind, id: string) => string | undefined

/** A pipe end this close to a node (metres) is connected to it. */
export const SNAP_M = 2
/** A hydrant this close to a node (metres) is hosted on it. */
export const HYDRANT_HOST_M = 3

const KIND: Record<DraftKind, Kind> = { pipe: 'Pipe', node: 'Node', valve: 'Device', hydrant: 'Device' }
const PREFIX: Record<DraftKind, string> = { pipe: 'ONG', node: 'NUT', valve: 'VAN', hydrant: 'TRU' }
const ACTION = { add: 'Add', mod: 'Update', del: 'Delete' } as const

const round = (v: number) => Math.round(v * 1e8) / 1e8
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v))
const code = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 64)

/** Editor valve kinds → catalog components. */
export const VALVE_COMPONENT: Record<string, string> = {
  gate: 'GateValve',
  boundary: 'GateValve',
  butterfly: 'ButterflyValve',
  ball: 'BallValve',
  check: 'CheckValve',
  prv: 'PRV',
  air: 'AirValve',
  washout: 'Washout',
}
/** Editor fitting labels → catalog components. */
export const FITTING_COMPONENT: Record<string, string> = {
  'Tê': 'Tee',
  'Tê thu': 'ReducingTee',
  'Chữ thập': 'Cross',
  'Cút': 'Bend',
  'Côn thu': 'Reducer',
  'Nắp bịt': 'Cap',
  'Mối nối': 'Coupling',
  'Nút tách': 'Junction',
}

/** The node component for a fitting label (or a catalog code). */
export function nodeComponent(label: string | undefined): string {
  const l = (label ?? '').trim()
  const direct = findComponent(l)
  if (direct?.kind === 'Node') return direct.code
  if (FITTING_COMPONENT[l]) return FITTING_COMPONENT[l]
  const low = l.toLowerCase()
  if (/^bể|reservoir|nhà máy/.test(low)) return 'Reservoir'
  if (/^đài|tank/.test(low)) return 'Tank'
  return 'Junction'
}

/** The device component of a valve or hydrant draft (`vkind` may also be a catalog code). */
export function deviceComponent(d: Pick<Draft, 'kind' | 'vkind'>): string {
  if (d.kind === 'hydrant') return 'Hydrant'
  const direct = findComponent(d.vkind)
  if (direct?.kind === 'Device') return direct.code
  return VALVE_COMPONENT[d.vkind ?? ''] ?? 'GateValve'
}
const onNode = (componentCode: string | undefined) => findComponent(componentCode)?.host === 'node'

function attributes(d: Draft): Record<string, string> {
  const raw: Record<string, unknown> = { dma: d.dma }
  if (d.kind === 'pipe')
    Object.assign(raw, {
      diameterMm: d.dn === undefined ? undefined : Math.round(d.dn),
      material: d.material === undefined ? undefined : (pipeMaterialCode(d.material) ?? d.material),
      year: d.year,
      cond: d.cond,
      trunk: d.trunk,
    })
  if (d.kind === 'valve') {
    const component = deviceComponent(d)
    const operable = findComponent(component)?.properties.some(p => p.key === 'state')
    Object.assign(raw, { componentCode: component, dn: d.dn, valveKind: d.vkind, state: operable ? d.state : undefined })
  }
  if (d.kind === 'hydrant') Object.assign(raw, { componentCode: 'Hydrant', hydrantType: d.htype })
  if (d.kind === 'node')
    Object.assign(raw, { componentCode: nodeComponent(d.ntype), fitting: d.ntype, z: d.z, elevationM: d.z, splitOf: d.splitOf })
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

/* ── geometry helpers (lon/lat, metres) ── */
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
const metres = (a: Point, b: Point) => Math.hypot((a[0] - b[0]) * kx(a[1]), (a[1] - b[1]) * 111_320)
/** Nearest point of a polyline: segment index, the point, and its distance (m). */
function nearestOnLine(line: Point[], pt: Point): { i: number; at: Point; d: number } {
  let best = { i: 0, at: line[0]!, d: Infinity }
  const k = kx(pt[1])
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!
    const ax = a[0] * k, ay = a[1] * 111_320, bx = b[0] * k, by = b[1] * 111_320
    const px = pt[0] * k, py = pt[1] * 111_320
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
    const at: Point = [round(a[0] + t * (b[0] - a[0])), round(a[1] + t * (b[1] - a[1]))]
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d < best.d) best = { i, at, d }
  }
  return best
}

/** Local drafts → revision operations, in the server's terms (see the header). `base` is the
 *  published network (`/editor/assets`): versions, codes, nodes to connect to, pipes to split. */
export function draftsToOperations(drafts: Draft[], p: Projector, base: EditState = {}, codeOf: CodeLookup = () => undefined): Edit[] {
  const ops: Edit[] = []
  const derived: Edit[] = []
  const byKey = new Map<string, Edit>()
  const usedIds = new Set(drafts.map(d => d.id))
  const freshId = (want: string) => {
    let id = code(want)
    for (let n = 2; usedIds.has(id) || base[id]; n++) id = code(`${want}-${n}`)
    usedIds.add(id)
    return id
  }

  for (const d of drafts) {
    const target = d.op === 'add' ? null : (d.baseId ?? null)
    if (d.op !== 'add' && !target) throw new Error(`Thay đổi ${d.id} thiếu đối tượng gốc.`)
    let after: Asset | null = null
    if (d.op !== 'del') {
      const geom = geometry(d, p)
      if (!geom) throw new Error(`Đối tượng ${d.id} chưa có hình học hợp lệ.`)
      const was = target ? base[target]?.asset : undefined
      after = {
        draftAssetId: d.id,
        clientRef: d.id,
        kind: KIND[d.kind],
        assetCode: (target && (was?.assetCode ?? codeOf(d.kind, target))) || code(`${PREFIX[d.kind]}-${d.id}`),
        geometry: geom,
        attributes: attributes(d),
        // an updated pipe keeps its ends until they move away from them (checked below)
        fromRef: was?.fromRef ?? null,
        toRef: was?.toRef ?? null,
        hostRef: d.kind === 'valve' ? (d.onPipe ?? null) : null,
      }
    }
    const op: Edit = {
      id: d.id,
      action: ACTION[d.op],
      kind: KIND[d.kind],
      targetId: target,
      expectedVersion: target ? (base[target]?.version ?? null) : null,
      before: null,
      after,
    }
    ops.push(op)
    byKey.set(target ?? d.id, op)
  }

  // nodes after the edits: published ones, moved, deleted or added
  const nodes = new Map<string, Point>()
  for (const [id, { asset }] of Object.entries(base)) if (asset.kind === 'Node' && asset.geometry.coordinates[0]) nodes.set(id, asset.geometry.coordinates[0])
  for (const op of ops) {
    if (op.kind !== 'Node') continue
    const key = op.targetId ?? op.id
    if (op.action === 'Delete') nodes.delete(key)
    else nodes.set(key, op.after!.geometry.coordinates[0]!)
  }
  const nearestNode = (pt: Point, within: number) => {
    let best: { key: string; d: number } | null = null
    for (const [key, at] of nodes) {
      const d = metres(at, pt)
      if (d <= within && (!best || d < best.d)) best = { key, d }
    }
    return best?.key
  }
  const addNode = (want: string, at: Point, type: string, why: string) => {
    const id = freshId(want)
    const op: Edit = {
      id,
      action: 'Add',
      kind: 'Node',
      targetId: null,
      expectedVersion: null,
      before: null,
      after: {
        draftAssetId: id,
        clientRef: id,
        kind: 'Node',
        assetCode: code(`NUT-${id}`),
        geometry: { type: 'Point', coordinates: [at] },
        attributes: { componentCode: type, derived: why },
        fromRef: null,
        toRef: null,
        hostRef: null,
      },
    }
    derived.push(op)
    byKey.set(id, op)
    nodes.set(id, at)
    return id
  }

  // the pipe asset a split or a valve works on: a drawn pipe, or the published one (made an Update)
  const deleted = new Set(ops.filter(o => o.action === 'Delete').map(o => o.targetId))
  const pipeOp = (key: string): Edit | null => {
    const own = byKey.get(key)
    if (own) return own.action === 'Delete' || own.kind !== 'Pipe' ? null : own
    const was = base[key]
    if (!was || was.asset.kind !== 'Pipe' || deleted.has(key)) return null
    const id = freshId(`${key}-U`)
    const op: Edit = {
      id,
      action: 'Update',
      kind: 'Pipe',
      targetId: key,
      expectedVersion: was.version,
      before: null,
      after: { ...was.asset, draftAssetId: id, clientRef: id, attributes: { ...was.asset.attributes, derived: 'split' } },
    }
    derived.push(op)
    byKey.set(key, op)
    return op
  }
  // a split pipe becomes several pieces; later splits and valves pick the nearest piece
  const pieces = new Map<string, string[]>()
  const nearestPiece = (key: string, pt: Point) => {
    const keys = pieces.get(key) ?? [key]
    let best: { key: string; d: number } | null = null
    for (const k of keys) {
      const op = pipeOp(k)
      if (!op?.after) continue
      const d = nearestOnLine(op.after.geometry.coordinates, pt).d
      if (!best || d < best.d) best = { key: k, d }
    }
    return best?.key ?? key
  }

  for (const op of ops) {
    const splitOf = op.kind === 'Node' && op.action === 'Add' ? op.after?.attributes.splitOf : undefined
    if (!splitOf) continue
    const nodeKey = op.id
    const at = op.after!.geometry.coordinates[0]!
    const pieceKey = nearestPiece(splitOf, at)
    const pipe = pipeOp(pieceKey)
    if (!pipe?.after) continue
    const line = pipe.after.geometry.coordinates
    const hit = nearestOnLine(line, at)
    if (metres(hit.at, line[0]!) < 0.5 || metres(hit.at, line[line.length - 1]!) < 0.5) continue // on an end: nothing to split
    op.after!.geometry = { type: 'Point', coordinates: [hit.at] }
    nodes.set(nodeKey, hit.at)
    const first = [...line.slice(0, hit.i), hit.at]
    const second = [hit.at, ...line.slice(hit.i)]
    if (!pipe.after.attributes.derived && !pipe.after.attributes.origGeometry)
      pipe.after.attributes = { ...pipe.after.attributes, origGeometry: JSON.stringify(line) }
    const oldTo = pipe.after.toRef
    pipe.after.geometry = { type: 'LineString', coordinates: first }
    pipe.after.toRef = nodeKey
    const id = freshId(`${nodeKey}-P`)
    const rest: Edit = {
      id,
      action: 'Add',
      kind: 'Pipe',
      targetId: null,
      expectedVersion: null,
      before: null,
      after: {
        ...pipe.after,
        draftAssetId: id,
        clientRef: id,
        assetCode: code(`${pipe.after.assetCode.slice(0, 50)}-${id.slice(-8)}`),
        geometry: { type: 'LineString', coordinates: second },
        attributes: { ...pipe.after.attributes, derived: 'split', splitPipe: splitOf },
        fromRef: nodeKey,
        toRef: oldTo,
      },
    }
    delete rest.after!.attributes.origGeometry
    derived.push(rest)
    byKey.set(id, rest)
    pieces.set(splitOf, [...(pieces.get(splitOf) ?? [splitOf]), id])
  }

  // pipe ends sit on nodes
  for (const op of [...ops, ...derived]) {
    const a = op.after
    if (!a || a.kind !== 'Pipe') continue
    const line = a.geometry.coordinates
    for (const end of ['from', 'to'] as const) {
      const i = end === 'from' ? 0 : line.length - 1
      const ref = end === 'from' ? a.fromRef : a.toRef
      const refAt = ref ? nodes.get(ref) : undefined
      let key = refAt && nearMetres(line[i]!, refAt, SNAP_M) ? ref! : nearestNode(line[i]!, SNAP_M)
      key ??= addNode(`${op.id}-${end === 'from' ? 'A' : 'B'}`, line[i]!, 'Junction', 'endpoint')
      line[i] = nodes.get(key)!
      if (end === 'from') a.fromRef = key
      else a.toRef = key
    }
  }

  // devices: in-line ones on the nearest piece of their pipe, point devices on a node
  for (const op of ops) {
    const a = op.after
    if (!a || a.kind !== 'Device') continue
    const at = a.geometry.coordinates[0]!
    if (onNode(a.attributes.componentCode))
      a.hostRef = nearestNode(at, HYDRANT_HOST_M) ?? addNode(`${op.id}-N`, at, 'Junction', 'host')
    else if (a.hostRef) a.hostRef = nearestPiece(a.hostRef, at)
  }

  return [...ops, ...derived]
}

const valveKindOf = (componentCode: string | undefined) =>
  Object.entries(VALVE_COMPONENT).find(([, c]) => c === componentCode)?.[0] ?? componentCode

const num = (v: string | undefined) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

function draftKind(e: Edit): DraftKind {
  if (e.kind === 'Pipe') return 'pipe'
  if (e.kind === 'Node') return 'node'
  return findComponent(e.after?.attributes.componentCode)?.code === 'Hydrant' ? 'hydrant' : 'valve'
}

/** Revision operations → local drafts (reopening a saved revision). Deletes need `kindOf` for devices.
 *  Operations the bridge derived (junctions at pipe ends, split pieces, hydrant nodes) are rebuilt
 *  on the next save, so they are not drafts. */
export function operationsToDrafts(edits: Edit[], p: Projector, kindOf: (id: string) => DraftKind | undefined = () => undefined): Draft[] {
  return edits
    .filter(e => !e.after?.attributes.derived)
    .map(e => {
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
      const orig = a.origGeometry ? (JSON.parse(a.origGeometry) as Point[]) : null
      if (g?.type === 'LineString') d.pts = (orig ?? g.coordinates).map(px)
      if (g?.type === 'Point' && g.coordinates[0]) [d.x, d.y] = px(g.coordinates[0])
      if (kind === 'pipe')
        Object.assign(d, {
          dn: num(a.diameterMm ?? a.dn),
          material: a.material === undefined ? undefined : pipeMaterialLabel(a.material),
          year: num(a.year),
          cond: a.cond,
          trunk: a.trunk === 'true',
        })
      if (kind === 'valve') Object.assign(d, { dn: num(a.dn), vkind: a.valveKind ?? valveKindOf(a.componentCode), state: a.state })
      if (kind === 'hydrant') d.htype = a.hydrantType
      if (kind === 'node') Object.assign(d, { ntype: a.fitting ?? a.componentCode, z: num(a.z ?? a.elevationM), splitOf: a.splitOf })
      if (e.after && kind === 'valve') d.onPipe = e.after.hostRef ?? null
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
