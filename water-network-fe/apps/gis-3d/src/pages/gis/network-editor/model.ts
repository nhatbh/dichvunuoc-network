import { LINE_TOLERANCE_M, normalizeLine, splitLine, toMapPoint } from './geometry'
export type Point = [number, number]
export type Kind = 'Node' | 'Pipe' | 'Device'
export interface Asset {
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
export interface Edit {
  id: string
  action: 'Add' | 'Update' | 'Delete'
  kind: Kind
  targetId: string | null
  expectedVersion: number | null
  after: Asset | null
  before: Asset | null
}
export type State = Record<string, { asset: Asset; version: number }>
export interface Revision {
  id: string
  version: number
  status: string
  operations: Edit[] | null
}
export interface Issue {
  code: string
  operationId?: string
  draftAssetId?: string
  field: string
  message: string
}
export const newId = () => crypto.randomUUID()
export function visibleAssets(state: State, edits: Edit[]): State {
  const result = { ...state }
  for (const edit of edits) {
    const key = edit.targetId ?? edit.id
    if (edit.action === 'Delete') delete result[key]
    else if (edit.after) result[key] = { asset: edit.after, version: edit.expectedVersion ?? 0 }
  }
  return result
}
export function editAsset(state: State, edits: Edit[], key: string, after: Asset | null): Edit[] {
  const previous = edits.find(e => (e.targetId ?? e.id) === key)
  const base = state[key]
  const id = previous?.id ?? (base ? newId() : key)
  const rest = edits.filter(e => e !== previous)
  if (!base && !after) return rest
  return [
    ...rest,
    {
      id,
      action: after ? (base ? 'Update' : 'Add') : 'Delete',
      kind: (after ?? base!.asset).kind,
      targetId: base ? key : null,
      expectedVersion: previous?.expectedVersion ?? base?.version ?? null,
      before: previous?.before ?? base?.asset ?? null,
      after: after ? { ...after, draftAssetId: id, clientRef: id } : null,
    },
  ]
}
function pointGeometry(geometry: Asset['geometry']): Point {
  if (geometry.type !== 'Point' || geometry.coordinates.length !== 1)
    throw new Error('Hình học điểm phải có đúng một tọa độ hợp lệ.')
  const point = geometry.coordinates[0]!
  toMapPoint(point)
  return point
}
function endpointNodes(visible: State, pipe: Asset): { index: number; point: Point }[] {
  if (pipe.geometry.type !== 'LineString') throw new Error('Ống phải có hình học tuyến.')
  normalizeLine(pipe.geometry.coordinates)
  const result: { index: number; point: Point }[] = []
  for (const [ref, index] of [
    [pipe.fromRef, 0],
    [pipe.toRef, pipe.geometry.coordinates.length - 1],
  ] as const) {
    if (ref === null) continue
    const node = visible[ref]?.asset
    if (!node || node.kind !== 'Node')
      throw new Error(
        'Tham chiếu đầu ống không trỏ đến nút hợp lệ. Sửa kết nối trước khi sửa hình học.'
      )
    result.push({ index, point: pointGeometry(node.geometry) })
  }
  return result
}
export function pipeEndpointLocks(state: State, edits: Edit[], key: string): number[] {
  const visible = visibleAssets(state, edits)
  const pipe = visible[key]?.asset
  if (!pipe || pipe.kind !== 'Pipe') throw new Error('Chọn một ống để sửa.')
  return endpointNodes(visible, pipe).map(endpoint => endpoint.index)
}
function sameGeometry(a: Asset['geometry'], b: Asset['geometry']): boolean {
  return (
    a.type === b.type &&
    a.coordinates.length === b.coordinates.length &&
    a.coordinates.every(
      (point, i) => point[0] === b.coordinates[i]![0] && point[1] === b.coordinates[i]![1]
    )
  )
}
export function modifyAssetGeometry(
  state: State,
  edits: Edit[],
  key: string,
  geometry: Asset['geometry']
): Edit[] {
  const visible = visibleAssets(state, edits)
  const asset = visible[key]?.asset
  if (!asset) throw new Error('Không tìm thấy tài sản để sửa.')
  let coordinates: Point[]
  if (asset.kind === 'Pipe') {
    if (geometry.type !== 'LineString') throw new Error('Ống phải có hình học tuyến.')
    const endpoints = endpointNodes(visible, asset)
    coordinates = geometry.coordinates.map(point => [...point] as Point)
    // Validate the submitted line before normalization can alter its endpoint indices.
    normalizeLine(coordinates)
    for (const endpoint of endpoints) {
      const index = endpoint.index === 0 ? 0 : coordinates.length - 1
      const proposed = toMapPoint(coordinates[index]!)
      const locked = toMapPoint(endpoint.point)
      if (Math.hypot(proposed[0] - locked[0], proposed[1] - locked[1]) > LINE_TOLERANCE_M)
        throw new Error('Đầu ống đã nối phải giữ nguyên tại nút tham chiếu.')
      coordinates[index] = [...endpoint.point]
    }
    coordinates = normalizeLine(coordinates)
  } else {
    coordinates = [[...pointGeometry(geometry)]]
  }
  const nextGeometry: Asset['geometry'] = { type: geometry.type, coordinates }
  if (sameGeometry(asset.geometry, nextGeometry)) return edits
  let next = editAsset(state, edits, key, { ...asset, geometry: nextGeometry })
  if (asset.kind === 'Node') {
    for (const [pipeKey, entry] of Object.entries(visible)) {
      const pipe = entry.asset
      if (pipe.kind !== 'Pipe' || (pipe.fromRef !== key && pipe.toRef !== key)) continue
      if (pipe.geometry.type !== 'LineString') throw new Error('Ống phải có hình học tuyến.')
      normalizeLine(pipe.geometry.coordinates)
      const points = pipe.geometry.coordinates.map(point => [...point] as Point)
      if (pipe.fromRef === key) points[0] = [...coordinates[0]!]
      if (pipe.toRef === key) points[points.length - 1] = [...coordinates[0]!]
      normalizeLine(points)
      next = editAsset(state, next, pipeKey, {
        ...pipe,
        geometry: { type: 'LineString', coordinates: points },
      })
    }
  }
  return next
}
export function splitPipe(state: State, edits: Edit[], key: string, point: Point): Edit[] {
  const visible = visibleAssets(state, edits)
  const pipe = visible[key]?.asset
  if (!pipe || pipe.kind !== 'Pipe') throw new Error('Chọn một ống để tách.')
  if (Object.values(visible).some(x => x.asset.kind === 'Device' && x.asset.hostRef === key))
    throw new Error(
      'Ống có thiết bị gắn. Chuyển thiết bị sang ống khác trước khi tách để tránh gán nhầm đoạn.'
    )
  const split = splitLine(pipe.geometry.coordinates, point)
  const nodeId = newId(),
    pipeId = newId()
  const node: Asset = {
    draftAssetId: nodeId,
    clientRef: nodeId,
    kind: 'Node',
    assetCode: `N-${nodeId.slice(0, 8)}`,
    geometry: { type: 'Point', coordinates: [split.point] },
    attributes: { nodeType: 'Junction' },
    fromRef: null,
    toRef: null,
    hostRef: null,
  }
  let next = editAsset(state, edits, nodeId, node)
  next = editAsset(state, next, key, {
    ...pipe,
    toRef: nodeId,
    geometry: { type: 'LineString', coordinates: split.first },
  })
  return editAsset(state, next, pipeId, {
    ...pipe,
    draftAssetId: pipeId,
    clientRef: pipeId,
    assetCode: `${pipe.assetCode}-T-${pipeId.slice(0, 4)}`,
    fromRef: nodeId,
    geometry: { type: 'LineString', coordinates: split.second },
  })
}
export function extent(assets: Asset[]): [number, number, number, number] | null {
  const points = assets
    .flatMap(a => a.geometry.coordinates)
    .filter(p => p.length === 2 && p.every(Number.isFinite))
  if (!points.length) return null
  return points.reduce<[number, number, number, number]>(
    (b, p) => [
      Math.min(b[0], p[0]),
      Math.min(b[1], p[1]),
      Math.max(b[2], p[0]),
      Math.max(b[3], p[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  )
}
