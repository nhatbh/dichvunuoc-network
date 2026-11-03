/* Bản đồ mạng lưới GIS — shared dataset store for the ported rich screens.
   Canonical GeoJSON is adapted once at the route boundary, then exposed through
   this context so the existing screens can share one tenant-scoped snapshot. */
import { createContext, useContext, type JSX } from 'solid-js'

/* ── Shape (only the members the ported screens touch are typed precisely;
   the rest stay loose to keep the 1:1 port cheap). ── */
export interface XY {
  x: number
  y: number
}
export interface Pipe {
  id: string
  code: string
  from: string
  to: string
  dn: number
  trunk: boolean
  material: string
  year: number
  cond: string
  status: string
  lenM: number
  /** Operating pressure (bar); drives the flow animation speed. */
  pressure?: number
  /** Closed boundary valve: the pipe is isolated and nothing flows. */
  noFlow?: boolean
  /** Water travels start→end of the line (`forward`, default) or end→start (`reverse`). */
  flowDir?: 'forward' | 'reverse'
  pts: [[number, number], [number, number]]
  /** Full canonical LineString. `pts` keeps the legacy endpoint tuple contract. */
  vertices?: [number, number][]
  dma: string
}
export interface Valve extends XY {
  id: string
  code: string
  pipe: string
  dn: number
  kind: string
  state: string
  dma: string
  year: number
}
export interface Hydrant extends XY {
  id: string
  code: string
  dma: string
  status: string
}
export interface Node extends XY {
  id: string
  code: string
  i: number
  j: number
  z: number
  kind: string
}
export interface Dma {
  id: string
  name: string
  col: string
  poly: [number, number][]
}
export interface Block {
  x: number
  y: number
  w: number
  h: number
  t: number
}
export interface Park {
  id: string
  name: string
  poly: [number, number][]
}
export interface ConnDot {
  x: number
  y: number
  dma: string
}
export interface Reservoir extends XY {
  id: string
  name: string
  cap: number
  level: number
  dma: string
}
export interface Pump extends XY {
  id: string
  name: string
  pumps: number
  run: number
  dma: string
}
export interface SourceDevice extends XY {
  id: string
  code: string
  name: string
  deviceType: string
  status: string
  hostPipeId?: string
  hostNodeId?: string
}
export interface Plant extends XY {
  id: string
  name: string
  flow: number
}
export interface Layer {
  id: string
  label: string
  grp: string
  on: boolean
  lock?: boolean
  count?: number
}
export interface AssetType {
  label: string
  geom: 'line' | 'point' | 'polygon'
  icon: string
  col: string
}
export interface Asset {
  id: string
  code: string
  type: string
  geom: 'line' | 'point' | 'polygon'
  name: string
  dma: string
  cond: string
  status: string
  attrs: Record<string, string | number>
  geomRef: Pipe | Valve | Hydrant | Node | Pump | Reservoir | SourceDevice | Dma
}
export interface Dash {
  pipeKm: number
  pipeCount: number
  valveCount: number
  hydrantCount: number
  connCount: number
  dmaCount: number
  topoOpen: number
  csPending: number
  importPending: number
  fieldPending: number
  geocodedPct: number
  rtkPct: number
  condMix: { k: string; label: string; col: string; n: number }[]
  matMix: { label: string; n: number }[]
}
export interface Role {
  id: string
  label: string
  n: number
}
export interface Dataflow {
  inputs: { src: string; label: string }[]
  outputs: string[]
}

export interface TopoKind {
  label: string
  sev: 'error' | 'warn' | 'info'
  col: string
  hint: string
}
export interface TopoIssue {
  id: string
  kind: string
  dma: string
  x: number
  y: number
  ref: string
  status: 'open' | 'fixed' | 'ignored'
  auto: boolean
}
export interface ServiceLink {
  id: string
  status: string
  detail: string
}
export interface ServiceDef {
  id: string
  label: string
  sub: string
  icon: string
  col: string
}
export interface LinkStateDef {
  label: string
  col: string
}
export interface Isolation {
  target: string
  targetMid: [number, number]
  valves: string[]
  affectedPipes: string[]
  affectedConns: number
  estPop: number
}
export interface Connection {
  id: string
  name: string
  danhbo: string
  addr: string
  dma: string
  type: string
  x: number
  y: number
  meter: string
  dn: number
  status: string
  geocoded?: boolean
  gpsRtk?: boolean
}

export interface ImportJob {
  id: string
  file: string
  fmt: string
  src: string
  rows: number
  ok: number
  err: number
  status: string
  at: string
  by: string
}

export interface ImportError {
  row: number
  field: string
  msg: string
}

export interface GisData {
  TODAY: string
  SRID: string
  world: { w: number; h: number }
  nodes: Node[]
  pipes: Pipe[]
  pipeBy: Record<string, Pipe>
  valves: Valve[]
  hydrants: Hydrant[]
  plant: Plant
  reservoirs: Reservoir[]
  pumps: Pump[]
  sourceDevices: SourceDevice[]
  dmas: Dma[]
  blocks: Block[]
  parks: Park[]
  river: string
  lake: [number, number][]
  connDots: ConnDot[]
  connections: Connection[]
  LAYERS: Layer[]
  assets: Asset[]
  ASSET_TYPES: Record<string, AssetType>
  COND: Record<string, { label: string; col: string }>
  PSTATUS: Record<string, { label: string; col: string }>
  MATERIALS: string[]
  CTYPE: Record<string, { label: string; col: string }>
  TOPO_KINDS: Record<string, TopoKind>
  topoIssues: TopoIssue[]
  isolation: Isolation
  importJobs: ImportJob[]
  importErrors: ImportError[]
  changeSets: {
    id: string
    title: string
    author: string
    at: string
    status: string
    adds: number
    mods: number
    dels: number
    dma: string
    reviewer: string | null
  }[]
  fieldObs: unknown[]
  offlinePkgs: unknown[]
  ROLES: Role[]
  DATAFLOW: Dataflow
  DASH: Dash
  SERVICES: Record<string, ServiceDef>
  LINK_STATE: Record<string, LinkStateDef>
  canonical?: boolean
  geo?: GisGeoMetadata
  network?: GisNetworkState
  assetLinks: (asset: Asset | null) => ServiceLink[]
}

export interface GisGeoMetadata {
  bbox: [number, number, number, number]
  center: [number, number]
  source: 'data_extent' | 'tenant_override'
  inset: number
  unitsToMeters: number
  metersPerDegreeLon: number
  metersPerDegreeLat: number
}

export interface GisNetworkState {
  featureCount: number
  limit: number
  truncated: boolean
  initialExtentPartial?: boolean
}

/** Recompute the dropped `midOf` helper client-side. */
export const midOf = (p: Pipe): [number, number] => [
  ((p.pts[0]?.[0] ?? 0) + (p.pts[p.pts.length - 1]?.[0] ?? 0)) / 2,
  ((p.pts[0]?.[1] ?? 0) + (p.pts[p.pts.length - 1]?.[1] ?? 0)) / 2,
]

/** Convert the rich app's retained pixel coordinate to canonical WGS84. */
export function gisPixelToLonLat(data: GisData, x: number, y: number): [number, number] | null {
  const geo = data.geo
  if (!geo) return null
  const [minLon, , , maxLat] = geo.bbox
  return [
    minLon + ((x - geo.inset) * geo.unitsToMeters) / geo.metersPerDegreeLon,
    maxLat - ((y - geo.inset) * geo.unitsToMeters) / geo.metersPerDegreeLat,
  ]
}

/** Convert a WGS84 point to the internal pixel plane used by the ported screens. */
export function gisLonLatToPixel(data: GisData, lon: number, lat: number): [number, number] | null {
  const geo = data.geo
  if (!geo) return null
  const [minLon, , , maxLat] = geo.bbox
  return [
    geo.inset + ((lon - minLon) * geo.metersPerDegreeLon) / geo.unitsToMeters,
    geo.inset + ((maxLat - lat) * geo.metersPerDegreeLat) / geo.unitsToMeters,
  ]
}

export function gisPixelBboxToExtent(
  data: GisData,
  box: { x: number; y: number; w: number; h: number }
): [number, number, number, number] | null {
  const topLeft = gisPixelToLonLat(data, box.x, box.y)
  const bottomRight = gisPixelToLonLat(data, box.x + box.w, box.y + box.h)
  if (!topLeft || !bottomRight) return null
  return [
    Math.min(topLeft[0], bottomRight[0]),
    Math.min(topLeft[1], bottomRight[1]),
    Math.max(topLeft[0], bottomRight[0]),
    Math.max(topLeft[1], bottomRight[1]),
  ]
}

export function gisPixelDistanceM(
  data: GisData,
  from: [number, number],
  to: [number, number]
): number {
  if (!data.geo) return Math.hypot(to[0] - from[0], to[1] - from[1]) * 1.15
  const dx = (to[0] - from[0]) * data.geo.unitsToMeters
  const dy = (to[1] - from[1]) * data.geo.unitsToMeters
  return Math.hypot(dx, dy)
}

function hashNum(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Legacy design-data service-link helper. Canonical datasets deliberately return
    no inferred links until the owning services expose authoritative relations. */
export function computeAssetLinks(asset: Asset | null): ServiceLink[] {
  if (!asset) return []
  const a = asset
  const h = hashNum(a.id)
  const g = (a.geomRef ?? {}) as { trunk?: boolean; status?: string; cond?: string; kind?: string }
  const out: ServiceLink[] = []
  if (a.type === 'pipe') {
    out.push({ id: 'eam', status: 'linked', detail: 'Lý lịch ống · ' + a.code })
    out.push({ id: 'hydraulic', status: 'linked', detail: 'Link mô hình thuỷ lực' })
    if (g.trunk)
      out.push({
        id: 'scada',
        status: h % 3 === 0 ? 'linked' : 'push',
        detail: h % 3 === 0 ? 'Cảm biến lưu lượng đầu tuyến' : 'Chưa gắn cảm biến',
      })
    out.push({ id: 'dmamgmt', status: 'linked', detail: 'Thuộc ' + a.dma })
    if (g.status === 'leak')
      out.push({ id: 'cmms', status: 'open', detail: 'Phiếu sửa rò rỉ đang mở' })
    else if (g.cond === 'poor')
      out.push({ id: 'cmms', status: 'push', detail: 'Đề xuất kiểm tra định kỳ' })
  } else if (a.type === 'valve') {
    out.push({ id: 'eam', status: 'linked', detail: 'Lý lịch van · ' + a.code })
    out.push({ id: 'hydraulic', status: 'linked', detail: 'Phần tử van mô hình' })
    if (g.kind === 'boundary') {
      out.push({ id: 'dmamgmt', status: 'linked', detail: 'Van biên ' + a.dma })
      out.push({ id: 'nrw', status: 'linked', detail: 'Ranh cân bằng nước DMA' })
    }
    if (h % 4 === 0) out.push({ id: 'scada', status: 'linked', detail: 'Cảm biến đóng/mở van' })
    out.push({
      id: 'cmms',
      status: h % 5 === 0 ? 'open' : 'push',
      detail: h % 5 === 0 ? 'Phiếu vận hành van đang mở' : 'Lịch vận hành van định kỳ',
    })
  } else if (a.type === 'hydrant') {
    out.push({ id: 'eam', status: 'linked', detail: 'Lý lịch trụ · ' + a.code })
    out.push({
      id: 'cmms',
      status: a.status === 'leak' ? 'open' : 'push',
      detail: a.status === 'leak' ? 'Phiếu kiểm tra trụ' : 'Lịch xúc xả định kỳ',
    })
  } else if (a.type === 'pump') {
    out.push({ id: 'scada', status: 'linked', detail: 'Realtime: bơm chạy · áp đẩy' })
    out.push({ id: 'pma', status: 'linked', detail: 'Điểm điều áp PMA' })
    out.push({ id: 'eam', status: 'linked', detail: 'Lý lịch trạm bơm' })
    out.push({ id: 'hydraulic', status: 'linked', detail: 'Phần tử bơm mô hình' })
    out.push({ id: 'cmms', status: 'push', detail: 'Bảo trì dự đoán bơm' })
  } else if (a.type === 'reservoir') {
    out.push({ id: 'scada', status: 'linked', detail: 'Realtime: mực nước · lưu lượng' })
    out.push({ id: 'eam', status: 'linked', detail: 'Lý lịch bể / đài nước' })
    out.push({ id: 'hydraulic', status: 'linked', detail: 'Nút áp lực mô hình' })
    out.push({ id: 'dmamgmt', status: 'linked', detail: 'Cấp cho ' + a.dma })
  } else if (a.type === 'dma') {
    out.push({ id: 'dmamgmt', status: 'linked', detail: 'Hồ sơ vùng DMA' })
    out.push({ id: 'nrw', status: 'linked', detail: 'Cân bằng nước & %NRW' })
    out.push({ id: 'pma', status: 'linked', detail: 'Quản lý áp lực vùng' })
    out.push({ id: 'scada', status: 'linked', detail: 'Đồng hồ tổng đầu vào' })
  } else if (a.type === 'node') {
    out.push({
      id: 'hydraulic',
      status: 'linked',
      detail: 'Nút giao mô hình · ' + (a.code || a.id),
    })
  }
  return out
}

/** Attach the appropriate service-link resolver for the dataset source. */
export function enrichGisData(raw: GisData): GisData {
  return { ...raw, assetLinks: raw.canonical ? () => [] : computeAssetLinks }
}

const Ctx = createContext<GisData>()

export function GisProvider(props: { data: GisData; children: JSX.Element }) {
  return <Ctx.Provider value={props.data}>{props.children}</Ctx.Provider>
}

export function useGis(): GisData {
  const c = useContext(Ctx)
  if (!c) throw new Error('useGis must be used within GisProvider')
  return c
}

/** Shell chrome can render before network data is available. */
export function useOptionalGis(): GisData | undefined {
  return useContext(Ctx)
}
